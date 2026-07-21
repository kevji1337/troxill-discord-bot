const db = require('../database/campaignDb');
const { parseSnowflakeList } = require('../utils/helpers');

/**
 * Service to manage audience assembly, filtering, and previewing.
 */
class AudienceService {
    /**
     * Fetches all members from the guild and applies filters.
     * @param {Client} client Discord Client
     * @param {Object} filters Campaign filters
     * @param {Array<string>} [campaignExcludeUserIds=[]] Campaign-specific excluded user IDs
     * @param {Array<string>} [campaignExcludeRoleIds=[]] Campaign-specific excluded role IDs
     */
    static async getAudience(client, filters = {}, campaignExcludeUserIds = [], campaignExcludeRoleIds = []) {
        const guildId = process.env.GUILD_ID;
        if (!guildId) {
            throw new Error('GUILD_ID is not configured in environment variables');
        }

        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) {
            throw new Error(`Guild with ID ${guildId} not found`);
        }

        // Fetch all members from Discord API
        const membersCollection = await guild.members.fetch().catch((err) => {
            console.error('Failed to fetch guild members:', err);
            throw new Error('Failed to fetch guild members. Ensure Guild Members Intent is enabled.');
        });

        const members = Array.from(membersCollection.values());

        // Get global exclusions
        const globalExcludedUsers = new Set(db.getExcludedUsers().map(u => u.discord_user_id));
        const globalExcludedRoles = new Set(db.getExcludedRoles().map(r => r.role_id));

        // Campaign exclusions
        const campExcludedUsers = new Set(campaignExcludeUserIds);
        const campExcludedRoles = new Set(campaignExcludeRoleIds);

        // Explicit user IDs to exclude from filters input
        const filterExcludeUsers = new Set(parseSnowflakeList(filters.excludeUserIds || ''));
        const filterExcludeRoles = new Set(parseSnowflakeList(filters.excludeRoleIds || ''));

        // Stats counters
        let totalMembers = members.length;
        let botsExcluded = 0;
        let ownerExcluded = 0;
        let rolesExcluded = 0;
        let manualExcluded = 0;
        let blacklistExcluded = 0;

        const finalRecipients = [];

        const guildOwnerId = guild.ownerId;

        for (const member of members) {
            const userId = member.user.id;
            const isBot = member.user.bot;
            const isOwner = userId === guildOwnerId;

            // 1. Exclude bots (Requirement: exclude bots)
            if (isBot) {
                botsExcluded++;
                continue;
            }

            // 2. Exclude owner (Requirement: exclude server owner)
            if (isOwner && filters.excludeOwner !== false) {
                ownerExcluded++;
                continue;
            }

            // 3. Exclude global blacklist users
            if (globalExcludedUsers.has(userId)) {
                blacklistExcluded++;
                continue;
            }

            // 4. Exclude campaign-specific or explicit filter user IDs (manual exclusions)
            if (campExcludedUsers.has(userId) || filterExcludeUsers.has(userId)) {
                manualExcluded++;
                continue;
            }

            // 5. Exclude by roles (global + campaign + filter roles)
            const memberRoles = member.roles.cache;
            let hasExcludedRole = false;
            for (const roleId of memberRoles.keys()) {
                if (globalExcludedRoles.has(roleId) || campExcludedRoles.has(roleId) || filterExcludeRoles.has(roleId)) {
                    hasExcludedRole = true;
                    break;
                }
            }

            if (hasExcludedRole) {
                rolesExcluded++;
                continue;
            }

            // If passes all checks, add to recipient list
            finalRecipients.push({
                id: userId,
                username: member.user.username,
                displayName: member.displayName || member.user.globalName || member.user.username,
                status: 'PENDING'
            });
        }

        return {
            totalMembers,
            botsExcluded,
            ownerExcluded,
            rolesExcluded,
            manualExcluded,
            blacklistExcluded,
            finalRecipients
        };
    }

    /**
     * Returns stats preview of the campaign audience without writing to DB.
     */
    static async preview(client, filters, campaignExcludeUserIds, campaignExcludeRoleIds) {
        const result = await this.getAudience(client, filters, campaignExcludeUserIds, campaignExcludeRoleIds);
        return {
            totalMembers: result.totalMembers,
            botsExcluded: result.botsExcluded,
            ownerExcluded: result.ownerExcluded,
            rolesExcluded: result.rolesExcluded,
            manualExcluded: result.manualExcluded,
            blacklistExcluded: result.blacklistExcluded,
            finalRecipientsCount: result.finalRecipients.length
        };
    }
}

module.exports = AudienceService;
