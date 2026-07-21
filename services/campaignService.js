const db = require('../database/campaignDb');
const AudienceService = require('./audienceService');
const { CampaignWorker } = require('./campaignWorker');

class CampaignService {
    static createDraft(name, messageConfig, campaignSettings, createdBy) {
        const id = db.createCampaign(name, messageConfig, campaignSettings, createdBy);
        db.logCampaignEvent(id, 'CREATED', `Draft campaign created by admin ${createdBy}`);
        return id;
    }

    static updateDraft(id, name, messageConfig, campaignSettings) {
        const campaign = db.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');
        if (campaign.status !== 'DRAFT' && campaign.status !== 'READY') {
            throw new Error('Can only edit campaigns in DRAFT or READY status');
        }

        const updates = { name, message_config: messageConfig, campaign_settings: campaignSettings };
        db.updateCampaign(id, updates);
        db.logCampaignEvent(id, 'UPDATED', 'Campaign configuration updated');
        return true;
    }

    static async finalizeCampaign(id, client) {
        const campaign = db.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');
        if (campaign.status !== 'DRAFT') {
            throw new Error('Can only finalize DRAFT campaigns');
        }

        const filters = campaign.campaign_settings.filters || {};
        const excludeUsers = campaign.campaign_settings.excludeUserIds || [];
        const excludeRoles = campaign.campaign_settings.excludeRoleIds || [];

        // Build recipient snapshot
        const { finalRecipients } = await AudienceService.getAudience(client, filters, excludeUsers, excludeRoles);

        if (finalRecipients.length === 0) {
            throw new Error('No recipients matching filters were found. Cannot finalize empty campaign.');
        }

        // Save recipient snapshot to database in a single transaction
        db.insertRecipients(id, finalRecipients);

        db.updateCampaign(id, { status: 'READY' });
        db.logCampaignEvent(id, 'FINALIZED', `Recipient snapshot built. Audience size: ${finalRecipients.length}`);
        return finalRecipients.length;
    }

    static startCampaign(id, client) {
        const campaign = db.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');
        if (campaign.status !== 'READY') {
            throw new Error('Can only start campaigns that are in READY status');
        }

        db.updateCampaign(id, {
            status: 'RUNNING',
            started_at: Date.now()
        });

        const success = CampaignWorker.start(client, id);
        if (!success) {
            db.updateCampaign(id, { status: 'READY' });
            throw new Error('Failed to start campaign worker loop');
        }
        return true;
    }

    static pauseCampaign(id) {
        const success = CampaignWorker.pause(id);
        if (!success) {
            throw new Error('Failed to pause campaign. Worker might not be running.');
        }
        return true;
    }

    static resumeCampaign(id, client) {
        const campaign = db.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');
        if (campaign.status !== 'PAUSED' && campaign.status !== 'AWAITING_CONFIRMATION') {
            throw new Error('Can only resume campaigns that are PAUSED or AWAITING_CONFIRMATION');
        }

        db.updateCampaign(id, { status: 'RUNNING' });
        const success = CampaignWorker.start(client, id);
        if (!success) {
            db.updateCampaign(id, { status: 'PAUSED' });
            throw new Error('Failed to start campaign worker loop');
        }
        return true;
    }

    static stopCampaign(id) {
        const success = CampaignWorker.stop(id);
        if (!success) {
            throw new Error('Failed to stop campaign.');
        }
        return true;
    }

    static continueWave(id, client) {
        const campaign = db.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');
        if (campaign.status !== 'AWAITING_CONFIRMATION') {
            throw new Error('Can only continue next wave for campaigns in AWAITING_CONFIRMATION status');
        }

        // Set started_at to now to reset wave tracking progress window
        db.updateCampaign(id, {
            status: 'RUNNING',
            started_at: Date.now()
        });

        db.logCampaignEvent(id, 'WAVE_CONTINUED', 'Next wave confirmed by administrator');

        const success = CampaignWorker.start(client, id);
        if (!success) {
            db.updateCampaign(id, { status: 'AWAITING_CONFIRMATION' });
            throw new Error('Failed to start campaign worker loop');
        }
        return true;
    }

    static getStats(id) {
        const campaign = db.getCampaign(id);
        if (!campaign) return null;

        const dbInstance = db.getDb();
        const counts = dbInstance.prepare(`
            SELECT 
                status, 
                COUNT(*) as count 
            FROM campaign_recipients 
            WHERE campaign_id = ? 
            GROUP BY status
        `).all(id);

        const stats = {
            PENDING: 0,
            PROCESSING: 0,
            SENT: 0,
            DM_CLOSED: 0,
            FAILED_TEMPORARY: 0,
            FAILED_PERMANENT: 0,
            EXCLUDED: 0
        };

        for (const row of counts) {
            if (stats[row.status] !== undefined) {
                stats[row.status] = row.count;
            }
        }

        const events = db.getCampaignEvents(id);
        return {
            campaign,
            stats,
            events
        };
    }

    static exportCSV(id) {
        const campaign = db.getCampaign(id);
        if (!campaign) throw new Error('Campaign not found');

        const recipients = db.getRecipients(id);
        const headers = 'discord_user_id,username,display_name,status,attempts,last_error_code,last_error_message,sent_at,processed_at\n';
        
        const rows = recipients.map(r => {
            const escape = (val) => {
                if (val === null || val === undefined) return '';
                const str = String(val);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            return [
                r.discord_user_id,
                r.username_snapshot,
                r.display_name_snapshot,
                r.status,
                r.attempts,
                r.last_error_code || '',
                r.last_error_message || '',
                r.sent_at ? new Date(r.sent_at).toISOString() : '',
                r.processed_at ? new Date(r.processed_at).toISOString() : ''
            ].map(escape).join(',');
        }).join('\n');

        return headers + rows;
    }
}

module.exports = CampaignService;
