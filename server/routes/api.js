const express = require('express');
const router = express.Router();
const db = require('../../database/campaignDb');
const AudienceService = require('../../services/audienceService');
const CampaignService = require('../../services/campaignService');
const MessageBuilder = require('../../services/messageBuilder');
const { CampaignWorker } = require('../../services/campaignWorker');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isSnowflake, parseSnowflakeList } = require('../../utils/runtime');

// Input helper validator
function validateCampaignInput(req, res, next) {
    const { name, messageConfig, campaignSettings } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
        return res.status(400).json({ error: 'Invalid campaign name (1-100 characters required)' });
    }

    if (!messageConfig || typeof messageConfig !== 'object') {
        return res.status(400).json({ error: 'Message configuration object is required' });
    }

    const { content, embed, buttons } = messageConfig;

    if (content && content.length > 2000) {
        return res.status(400).json({ error: 'Content is too long (max 2000 characters)' });
    }

    if (embed) {
        if (embed.title && embed.title.length > 256) {
            return res.status(400).json({ error: 'Embed title is too long (max 256 characters)' });
        }
        if (embed.description && embed.description.length > 4096) {
            return res.status(400).json({ error: 'Embed description is too long (max 4096 characters)' });
        }
        if (embed.footer && embed.footer.length > 2048) {
            return res.status(400).json({ error: 'Embed footer is too long (max 2048 characters)' });
        }
        if (embed.image && !/^https?:\/\//i.test(embed.image)) {
            return res.status(400).json({ error: 'Embed image must be a valid HTTP/HTTPS URL' });
        }
        if (embed.thumbnail && !/^https?:\/\//i.test(embed.thumbnail)) {
            return res.status(400).json({ error: 'Embed thumbnail must be a valid HTTP/HTTPS URL' });
        }
    }

    if (buttons && Array.isArray(buttons)) {
        if (buttons.length > 5) {
            return res.status(400).json({ error: 'Maximum 5 link buttons allowed' });
        }
        for (const btn of buttons) {
            if (!btn.label || btn.label.trim().length === 0 || btn.label.length > 80) {
                return res.status(400).json({ error: 'Button label is required (max 80 characters)' });
            }
            if (!btn.url || !/^https?:\/\//i.test(btn.url)) {
                return res.status(400).json({ error: 'Button URL must be a valid HTTP/HTTPS link' });
            }
        }
    }

    if (campaignSettings && typeof campaignSettings === 'object') {
        const { delayMs, waveSize, isContinuous } = campaignSettings;
        if (delayMs !== undefined) {
            const delay = Number(delayMs);
            if (!Number.isInteger(delay) || delay < 500 || delay > 30000) {
                return res.status(400).json({ error: 'Delay must be an integer between 500ms and 30000ms' });
            }
        }
        if (waveSize !== undefined) {
            const wave = Number(waveSize);
            if (!Number.isInteger(wave) || wave < 1 || wave > 1000) {
                return res.status(400).json({ error: 'Wave size must be an integer between 1 and 1000' });
            }
        }
    }

    next();
}

// -------------------------------------------------------------
// AUTH ENDPOINTS
// -------------------------------------------------------------
router.get('/auth/me', (req, res) => {
    if (req.session && req.session.user) {
        return res.json({ loggedIn: true, user: req.session.user });
    }
    return res.json({ loggedIn: false });
});

router.post('/auth/logout', (req, res) => {
    if (req.session) {
        const adminId = req.session.user?.id || 'unknown';
        db.logAudit(adminId, 'logout', null, { ip: req.ip });
        req.session.destroy((err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to clear session' });
            }
            res.clearCookie('sid');
            return res.json({ success: true });
        });
    } else {
        return res.json({ success: true });
    }
});

// -------------------------------------------------------------
// EXCLUSIONS ENDPOINTS (Auth and Admin required)
// -------------------------------------------------------------
router.get('/exclusions/users', requireAuth, requireAdmin, (req, res) => {
    try {
        const users = db.getExcludedUsers();
        return res.json(users);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/exclusions/users', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!isSnowflake(userId)) {
        return res.status(400).json({ error: 'Invalid Discord User ID' });
    }

    try {
        const client = req.app.get('discordClient');
        const guildId = process.env.GUILD_ID;
        let username = 'Unknown User';

        if (client && guildId) {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    username = member.user.tag;
                }
            }
        }

        db.addExcludedUser(userId, username, req.session.user.id);
        db.logAudit(req.session.user.id, 'exclusion_add_user', userId, { username });
        return res.json({ success: true, userId, username });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.delete('/exclusions/users/:id', requireAuth, requireAdmin, (req, res) => {
    const userId = req.params.id;
    if (!isSnowflake(userId)) {
        return res.status(400).json({ error: 'Invalid Discord User ID' });
    }

    try {
        db.removeExcludedUser(userId);
        db.logAudit(req.session.user.id, 'exclusion_remove_user', userId);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/exclusions/roles', requireAuth, requireAdmin, (req, res) => {
    try {
        const roles = db.getExcludedRoles();
        return res.json(roles);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/exclusions/roles', requireAuth, requireAdmin, async (req, res) => {
    const { roleId } = req.body;
    if (!isSnowflake(roleId)) {
        return res.status(400).json({ error: 'Invalid Discord Role ID' });
    }

    try {
        const client = req.app.get('discordClient');
        const guildId = process.env.GUILD_ID;
        let roleName = 'Unknown Role';

        if (client && guildId) {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
                if (role) {
                    roleName = role.name;
                }
            }
        }

        db.addExcludedRole(roleId, roleName, req.session.user.id);
        db.logAudit(req.session.user.id, 'exclusion_add_role', roleId, { roleName });
        return res.json({ success: true, roleId, roleName });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.delete('/exclusions/roles/:id', requireAuth, requireAdmin, (req, res) => {
    const roleId = req.params.id;
    if (!isSnowflake(roleId)) {
        return res.status(400).json({ error: 'Invalid Discord Role ID' });
    }

    try {
        db.removeExcludedRole(roleId);
        db.logAudit(req.session.user.id, 'exclusion_remove_role', roleId);
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// -------------------------------------------------------------
// CAMPAIGNS ENDPOINTS (Auth and Admin required)
// -------------------------------------------------------------
router.get('/campaigns', requireAuth, requireAdmin, (req, res) => {
    try {
        const list = CampaignService.listCampaigns();
        return res.json(list);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/campaigns', requireAuth, requireAdmin, validateCampaignInput, (req, res) => {
    const { name, messageConfig, campaignSettings } = req.body;
    try {
        const id = CampaignService.createDraft(name, messageConfig, campaignSettings, req.session.user.id);
        db.logAudit(req.session.user.id, 'campaign_create', String(id), { name });
        return res.json({ success: true, id });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/campaigns/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        const data = CampaignService.getStats(id);
        if (!data) return res.status(404).json({ error: 'Campaign not found' });
        return res.json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.put('/campaigns/:id', requireAuth, requireAdmin, validateCampaignInput, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    const { name, messageConfig, campaignSettings } = req.body;
    try {
        CampaignService.updateDraft(id, name, messageConfig, campaignSettings);
        db.logAudit(req.session.user.id, 'campaign_edit', String(id), { name });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.delete('/campaigns/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        const campaign = db.getCampaign(id);
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        if (campaign.status === 'RUNNING') {
            return res.status(400).json({ error: 'Cannot delete running campaigns. Pause or Stop them first.' });
        }

        db.deleteCampaign(id);
        db.logAudit(req.session.user.id, 'campaign_delete', String(id), { name: campaign.name });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/campaigns/:id/finalize', requireAuth, requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        const client = req.app.get('discordClient');
        const count = await CampaignService.finalizeCampaign(id, client);
        db.logAudit(req.session.user.id, 'campaign_finalize', String(id), { audienceSize: count });
        return res.json({ success: true, count });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/campaigns/:id/start', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        const client = req.app.get('discordClient');
        CampaignService.startCampaign(id, client);
        db.logAudit(req.session.user.id, 'campaign_start', String(id));
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/campaigns/:id/pause', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        CampaignService.pauseCampaign(id);
        db.logAudit(req.session.user.id, 'campaign_pause', String(id));
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/campaigns/:id/resume', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        const client = req.app.get('discordClient');
        CampaignService.resumeCampaign(id, client);
        db.logAudit(req.session.user.id, 'campaign_resume', String(id));
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/campaigns/:id/stop', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        CampaignService.stopCampaign(id);
        db.logAudit(req.session.user.id, 'campaign_stop', String(id));
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/campaigns/:id/continue-wave', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        const client = req.app.get('discordClient');
        CampaignService.continueWave(id, client);
        db.logAudit(req.session.user.id, 'campaign_continue_wave', String(id));
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/campaigns/:id/export', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid campaign ID' });
    }

    try {
        const csv = CampaignService.exportCSV(id);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=campaign_${id}_results.csv`);
        db.logAudit(req.session.user.id, 'campaign_export', String(id));
        return res.send(csv);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// -------------------------------------------------------------
// GENERAL ENDPOINTS (Auth and Admin required)
// -------------------------------------------------------------
router.get('/dashboard', requireAuth, requireAdmin, async (req, res) => {
    try {
        const client = req.app.get('discordClient');
        const guildId = process.env.GUILD_ID;
        let guildInfo = { name: 'Unknown Guild', id: guildId, memberCount: 0 };

        if (client && guildId) {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                guildInfo = {
                    name: guild.name,
                    id: guild.id,
                    memberCount: guild.memberCount
                };
            }
        }

        const campaigns = CampaignService.listCampaigns();
        const activeCount = campaigns.filter(c => c.status === 'RUNNING').length;
        const totalCount = campaigns.length;

        // Fetch latest audit logs
        const auditLogs = db.getAuditLogs(10);

        return res.json({
            botStatus: client ? 'Online' : 'Offline',
            guild: guildInfo,
            campaigns: {
                total: totalCount,
                active: activeCount
            },
            killSwitchActive: CampaignWorker.isGlobalKillSwitchActive(),
            auditLogs
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/guild/members/search', requireAuth, requireAdmin, async (req, res) => {
    const query = String(req.query.q || '').trim().toLowerCase();
    if (query.length < 2) {
        return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    try {
        const client = req.app.get('discordClient');
        const guildId = process.env.GUILD_ID;
        if (!client || !guildId) return res.json([]);

        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return res.json([]);

        // Try to search members from cache/API
        const fetched = await guild.members.fetch({ query, limit: 25 }).catch(() => new Map());
        const results = Array.from(fetched.values()).map(m => ({
            id: m.user.id,
            username: m.user.username,
            displayName: m.displayName || m.user.globalName || m.user.username,
            bot: m.user.bot
        }));

        return res.json(results);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/audience/preview', requireAuth, requireAdmin, async (req, res) => {
    const { filters, campaignExcludeUserIds, campaignExcludeRoleIds } = req.body;
    try {
        const client = req.app.get('discordClient');
        const preview = await AudienceService.preview(client, filters || {}, campaignExcludeUserIds || [], campaignExcludeRoleIds || []);
        return res.json(preview);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/test-send', requireAuth, requireAdmin, async (req, res) => {
    const { messageConfig, testUserIds } = req.body;

    if (!testUserIds || !Array.isArray(testUserIds) || testUserIds.length === 0) {
        return res.status(400).json({ error: 'testUserIds array with at least one target is required' });
    }

    const invalidIds = testUserIds.filter(id => !isSnowflake(id));
    if (invalidIds.length > 0) {
        return res.status(400).json({ error: `Invalid Discord User IDs: ${invalidIds.join(', ')}` });
    }

    try {
        const client = req.app.get('discordClient');
        if (!client) return res.status(500).json({ error: 'Discord client not connected' });

        const results = [];

        for (const userId of testUserIds) {
            try {
                const user = await client.users.fetch(userId);
                if (!user) {
                    results.push({ userId, success: false, error: 'User not found' });
                    continue;
                }

                // Compile mock user details for personalization
                const payload = MessageBuilder.build(messageConfig, {
                    username: user.username,
                    displayName: user.displayName || user.globalName || user.username
                });

                await user.send(payload);
                results.push({ userId, success: true, username: user.tag });
            } catch (err) {
                results.push({ userId, success: false, error: err.message || String(err) });
            }
        }

        db.logAudit(req.session.user.id, 'test_send', null, { targets: testUserIds, results });
        return res.json(results);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.get('/audit', requireAuth, requireAdmin, (req, res) => {
    try {
        const logs = db.getAuditLogs(100);
        return res.json(logs);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/killswitch', requireAuth, requireAdmin, (req, res) => {
    const { active } = req.body;
    if (active === undefined) {
        return res.status(400).json({ error: 'active boolean field is required' });
    }

    try {
        CampaignWorker.setGlobalKillSwitch(!!active);
        db.logAudit(req.session.user.id, active ? 'killswitch_activate' : 'killswitch_deactivate');
        return res.json({ success: true, killSwitchActive: !!active });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

module.exports = router;
