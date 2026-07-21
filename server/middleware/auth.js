const { PermissionFlagsBits } = require('discord.js');
const { parseSnowflakeList } = require('../../utils/helpers');

/**
 * Verifies if user is authenticated.
 */
function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }
    next();
}

/**
 * Verifies if authenticated user has admin privileges.
 */
async function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Unauthorized. Please login first.' });
    }

    const userId = req.session.user.id;
    const client = req.app.get('discordClient');
    const guildId = process.env.GUILD_ID;

    // 1. Explicit admin whitelist from ENV
    const adminWhitelist = new Set(parseSnowflakeList(process.env.ADMIN_DISCORD_IDS || ''));
    if (adminWhitelist.has(userId)) {
        req.session.user.isAdmin = true;
        return next();
    }

    // 2. Dynamic check in the Discord guild
    if (guildId && client) {
        try {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    const hasAdminPerm = member.permissions.has(PermissionFlagsBits.Administrator);
                    
                    // Fetch curator role ID
                    const curatorRoleId = String(process.env.CURATOR_ROLE_ID || '').trim();
                    const hasCuratorRole = curatorRoleId && member.roles.cache.has(curatorRoleId);

                    if (hasAdminPerm || hasCuratorRole) {
                        req.session.user.isAdmin = true;
                        return next();
                    }
                }
            }
        } catch (err) {
            console.error('Failed to verify user permissions dynamically:', err);
        }
    }

    // If session says they are already verified admin, allow
    if (req.session.user.isAdmin) {
        return next();
    }

    return res.status(403).json({ error: 'Forbidden. Admin access required.' });
}

module.exports = {
    requireAuth,
    requireAdmin
};
