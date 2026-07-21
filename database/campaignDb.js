const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.TEST_DB === 'true' ? ':memory:' : path.join(DATA_DIR, 'campaigns.db');
let dbInstance = null;

function getDb() {
    if (dbInstance) return dbInstance;

    dbInstance = new Database(DB_PATH);
    // Enable WAL mode for better concurrency
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');

    // Initialize schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    dbInstance.exec(schemaSql);

    return dbInstance;
}

// Helper to run operations in transaction
function transaction(fn) {
    const db = getDb();
    return db.transaction(fn);
}

module.exports = {
    getDb,
    transaction,

    // CAMPAIGNS
    createCampaign: (name, messageConfig, campaignSettings, createdBy) => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO campaigns (name, status, guild_id, message_config, campaign_settings, created_by, created_at)
            VALUES (?, 'DRAFT', ?, ?, ?, ?, ?)
        `);
        const guildId = process.env.GUILD_ID || '';
        const now = Date.now();
        const info = stmt.run(
            name,
            guildId,
            JSON.stringify(messageConfig),
            JSON.stringify(campaignSettings),
            createdBy,
            now
        );
        return info.lastInsertRowid;
    },

    getCampaign: (id) => {
        const db = getDb();
        const stmt = db.prepare(`SELECT * FROM campaigns WHERE id = ?`);
        const campaign = stmt.get(id);
        if (!campaign) return null;

        campaign.message_config = JSON.parse(campaign.message_config);
        campaign.campaign_settings = JSON.parse(campaign.campaign_settings);
        return campaign;
    },

    listCampaigns: () => {
        const db = getDb();
        const stmt = db.prepare(`
            SELECT c.*, 
                   COUNT(r.discord_user_id) as total_recipients,
                   SUM(CASE WHEN r.status = 'SENT' THEN 1 ELSE 0 END) as sent_count,
                   SUM(CASE WHEN r.status = 'DM_CLOSED' THEN 1 ELSE 0 END) as dm_closed_count,
                   SUM(CASE WHEN r.status = 'FAILED_PERMANENT' THEN 1 ELSE 0 END) as failed_permanent_count,
                   SUM(CASE WHEN r.status = 'FAILED_TEMPORARY' THEN 1 ELSE 0 END) as failed_temporary_count,
                   SUM(CASE WHEN r.status = 'PENDING' THEN 1 ELSE 0 END) as pending_count,
                   SUM(CASE WHEN r.status = 'PROCESSING' THEN 1 ELSE 0 END) as processing_count,
                   SUM(CASE WHEN r.status = 'EXCLUDED' THEN 1 ELSE 0 END) as excluded_count
            FROM campaigns c
            LEFT JOIN campaign_recipients r ON c.id = r.campaign_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `);
        const list = stmt.all();
        return list.map(c => {
            c.message_config = JSON.parse(c.message_config);
            c.campaign_settings = JSON.parse(c.campaign_settings);
            return c;
        });
    },

    updateCampaign: (id, updates) => {
        const db = getDb();
        const allowedKeys = ['name', 'status', 'message_config', 'campaign_settings', 'started_at', 'paused_at', 'completed_at', 'stopped_at'];
        const sets = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            if (!allowedKeys.includes(key)) continue;
            sets.push(`${key} = ?`);
            if (key === 'message_config' || key === 'campaign_settings') {
                values.push(JSON.stringify(value));
            } else {
                values.push(value);
            }
        }

        if (sets.length === 0) return false;

        values.push(id);
        const stmt = db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`);
        const info = stmt.run(...values);
        return info.changes > 0;
    },

    deleteCampaign: (id) => {
        const db = getDb();
        const stmt = db.prepare(`DELETE FROM campaigns WHERE id = ?`);
        const info = stmt.run(id);
        return info.changes > 0;
    },

    // RECIPIENTS
    insertRecipients: (campaignId, recipients) => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO campaign_recipients (
                campaign_id, discord_user_id, username_snapshot, display_name_snapshot, status, attempts
            ) VALUES (?, ?, ?, ?, ?, 0)
        `);

        const insertMany = db.transaction((rows) => {
            for (const row of rows) {
                stmt.run(campaignId, row.id, row.username, row.displayName, row.status);
            }
        });

        insertMany(recipients);
    },

    getRecipients: (campaignId) => {
        const db = getDb();
        const stmt = db.prepare(`SELECT * FROM campaign_recipients WHERE campaign_id = ?`);
        return stmt.all(campaignId);
    },

    getEligibleRecipients: (campaignId, limit = 100) => {
        const db = getDb();
        const now = Date.now();
        // Eligible are PENDING or FAILED_TEMPORARY with next_retry_at <= now
        const stmt = db.prepare(`
            SELECT * FROM campaign_recipients 
            WHERE campaign_id = ? 
              AND (status = 'PENDING' OR (status = 'FAILED_TEMPORARY' AND (next_retry_at IS NULL OR next_retry_at <= ?)))
            LIMIT ?
        `);
        return stmt.all(campaignId, now, limit);
    },

    updateRecipientStatus: (campaignId, userId, status, details = {}) => {
        const db = getDb();
        const allowedKeys = ['status', 'attempts', 'last_error_code', 'last_error_message', 'next_retry_at', 'sent_at', 'processed_at'];
        const sets = [];
        const values = [];

        sets.push('status = ?');
        values.push(status);

        if (status === 'SENT' || status === 'DM_CLOSED' || status === 'FAILED_PERMANENT' || status === 'FAILED_TEMPORARY') {
            sets.push('processed_at = ?');
            values.push(Date.now());
        }

        for (const [key, value] of Object.entries(details)) {
            if (!allowedKeys.includes(key)) continue;
            sets.push(`${key} = ?`);
            values.push(value);
        }

        values.push(campaignId, userId);
        const stmt = db.prepare(`
            UPDATE campaign_recipients 
            SET ${sets.join(', ')} 
            WHERE campaign_id = ? AND discord_user_id = ?
        `);
        const info = stmt.run(...values);
        return info.changes > 0;
    },

    resetProcessingRecipients: (campaignId) => {
        const db = getDb();
        const stmt = db.prepare(`
            UPDATE campaign_recipients 
            SET status = 'PENDING' 
            WHERE campaign_id = ? AND status = 'PROCESSING'
        `);
        const info = stmt.run(campaignId);
        return info.changes;
    },

    resetAllProcessingRecipients: () => {
        const db = getDb();
        const stmt = db.prepare(`
            UPDATE campaign_recipients 
            SET status = 'PENDING' 
            WHERE status = 'PROCESSING'
        `);
        const info = stmt.run();
        return info.changes;
    },

    // EXCLUSIONS
    getExcludedUsers: () => {
        const db = getDb();
        const stmt = db.prepare(`SELECT * FROM excluded_users ORDER BY added_at DESC`);
        return stmt.all();
    },

    addExcludedUser: (userId, username, addedBy) => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO excluded_users (discord_user_id, username, added_at, added_by)
            VALUES (?, ?, ?, ?)
        `);
        const info = stmt.run(userId, username, Date.now(), addedBy);
        return info.changes > 0;
    },

    removeExcludedUser: (userId) => {
        const db = getDb();
        const stmt = db.prepare(`DELETE FROM excluded_users WHERE discord_user_id = ?`);
        const info = stmt.run(userId);
        return info.changes > 0;
    },

    getExcludedRoles: () => {
        const db = getDb();
        const stmt = db.prepare(`SELECT * FROM excluded_roles ORDER BY added_at DESC`);
        return stmt.all();
    },

    addExcludedRole: (roleId, roleName, addedBy) => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO excluded_roles (role_id, role_name, added_at, added_by)
            VALUES (?, ?, ?, ?)
        `);
        const info = stmt.run(roleId, roleName, Date.now(), addedBy);
        return info.changes > 0;
    },

    removeExcludedRole: (roleId) => {
        const db = getDb();
        const stmt = db.prepare(`DELETE FROM excluded_roles WHERE role_id = ?`);
        const info = stmt.run(roleId);
        return info.changes > 0;
    },

    // EVENTS & AUDIT
    logCampaignEvent: (campaignId, eventType, message) => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO campaign_events (campaign_id, event_type, message, created_at)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(campaignId, eventType, message, Date.now());
    },

    getCampaignEvents: (campaignId) => {
        const db = getDb();
        const stmt = db.prepare(`SELECT * FROM campaign_events WHERE campaign_id = ? ORDER BY created_at DESC`);
        return stmt.all(campaignId);
    },

    logAudit: (adminDiscordId, action, target = null, metadata = null) => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO admin_audit_logs (admin_discord_id, action, target, metadata, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(adminDiscordId, action, target, metadata ? JSON.stringify(metadata) : null, Date.now());
    },

    getAuditLogs: (limit = 200) => {
        const db = getDb();
        const stmt = db.prepare(`SELECT * FROM admin_audit_logs ORDER BY timestamp DESC LIMIT ?`);
        const logs = stmt.all(limit);
        return logs.map(l => {
            if (l.metadata) l.metadata = JSON.parse(l.metadata);
            return l;
        });
    }
};
