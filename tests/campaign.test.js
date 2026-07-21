const test = require('node:test');
const assert = require('node:assert/strict');

// Set TEST_DB to true before importing campaignDb
process.env.TEST_DB = 'true';
process.env.GUILD_ID = '123456789012345678';
process.env.CAMPAIGN_MAX_ATTEMPTS = '2';

const db = require('../database/campaignDb');
const AudienceService = require('../services/audienceService');
const MessageBuilder = require('../services/messageBuilder');
const { CampaignWorker, activeCampaigns } = require('../services/campaignWorker');
const CampaignService = require('../services/campaignService');

// Helper to mock a Discord Guild Member
function createMockMember(id, username, displayName, isBot, roleIds = []) {
    return {
        user: { id, username, bot: isBot, globalName: displayName },
        displayName: displayName || username,
        roles: {
            cache: new Map(roleIds.map(r => [r, { id: r, name: `Role-${r}` }]))
        }
    };
}

// -------------------------------------------------------------
// 1. AUDIENCE FILTERING TESTS
// -------------------------------------------------------------
test('AudienceService filters bots, owner, blacklist, roles, and manual user IDs correctly', async () => {
    // Initialize clean DB schema in-memory
    const sqlDb = db.getDb();
    sqlDb.exec(`DELETE FROM excluded_users; DELETE FROM excluded_roles; DELETE FROM campaigns;`);

    // Setup global blacklist in DB
    db.addExcludedUser('555555555555555555', 'BlacklistedUser', 'system');
    db.addExcludedRole('999999999999999999', 'BlacklistedRole', 'system');

    const mockMembers = new Map([
        ['111111111111111111', createMockMember('111111111111111111', 'owner_user', 'Server Owner', false)],
        ['222222222222222222', createMockMember('222222222222222222', 'normal_user', 'Normal User', false)],
        ['333333333333333333', createMockMember('333333333333333333', 'bot_user', 'My Bot', true)],
        ['444444444444444444', createMockMember('444444444444444444', 'manual_exclude', 'Manual Excluded', false)],
        ['555555555555555555', createMockMember('555555555555555555', 'blacklisted_user', 'Blacklist User', false)],
        ['666666666666666666', createMockMember('666666666666666666', 'role_exclude', 'Role Excluded User', false, ['999999999999999999'])],
        ['777777777777777777', createMockMember('777777777777777777', 'camp_role_exclude', 'Camp Role Excluded', false, ['888888888888888888'])]
    ]);

    // Mock Discord Client & Guild
    const mockGuild = {
        id: process.env.GUILD_ID,
        ownerId: '111111111111111111',
        members: {
            fetch: async () => mockMembers
        }
    };
    const mockClient = {
        guilds: {
            cache: new Map([[process.env.GUILD_ID, mockGuild]]),
            fetch: async () => mockGuild
        }
    };

    const filters = {
        excludeOwner: true
    };

    // Manual exclusions for campaign
    const campaignExcludeUserIds = ['444444444444444444'];
    const campaignExcludeRoleIds = ['888888888888888888'];

    const result = await AudienceService.getAudience(mockClient, filters, campaignExcludeUserIds, campaignExcludeRoleIds);

    // Verify stats counts
    assert.equal(result.totalMembers, 7);
    assert.equal(result.botsExcluded, 1);
    assert.equal(result.ownerExcluded, 1);
    assert.equal(result.blacklistExcluded, 1);
    assert.equal(result.manualExcluded, 1); // User 444444 is manually excluded
    assert.equal(result.rolesExcluded, 2);  // User 666666 (global role 999999) & User 777777 (camp role 888888)

    // Verify final recipients (should only contain User 222222)
    assert.equal(result.finalRecipients.length, 1);
    assert.equal(result.finalRecipients[0].id, '222222222222222222');
    assert.equal(result.finalRecipients[0].username, 'normal_user');
});

// -------------------------------------------------------------
// 2. MESSAGE PERSONALIZATION TESTS
// -------------------------------------------------------------
test('MessageBuilder personalizes content safely without Javascript execution', () => {
    const user = { username: 'john_doe', displayName: 'John Doe' };

    const text = 'Hello {displayName} ({username})! Enjoy your day.';
    const personalized = MessageBuilder.personalizeString(text, user);
    assert.equal(personalized, 'Hello John Doe (john_doe)! Enjoy your day.');

    // Malicious JS attempt in placeholders should remain text
    const maliciousText = 'Test {username}';
    const evilUser = { username: '<script>alert(1)</script>', displayName: 'Evil' };
    const parsedMalicious = MessageBuilder.personalizeString(maliciousText, evilUser);
    assert.equal(parsedMalicious, 'Test <script>alert(1)</script>');
});

// -------------------------------------------------------------
// 3. RECIPIENT UNIQUE CONSTRAINT TESTS
// -------------------------------------------------------------
test('DB campaign_recipients enforces unique constraint per campaign', () => {
    const sqlDb = db.getDb();
    sqlDb.exec(`DELETE FROM campaign_recipients; DELETE FROM campaigns;`);

    const campaignId = db.createCampaign('Test Camp Unique', {}, {}, 'admin');
    
    // Insert initial recipient list
    db.insertRecipients(campaignId, [
        { id: '111', username: 'user1', displayName: 'User One', status: 'PENDING' }
    ]);

    // Attempt to insert duplicate recipient - should not double insert due to INSERT OR REPLACE logic
    db.insertRecipients(campaignId, [
        { id: '111', username: 'user1_updated', displayName: 'User One Updated', status: 'PENDING' }
    ]);

    const recipients = db.getRecipients(campaignId);
    assert.equal(recipients.length, 1);
    assert.equal(recipients[0].username_snapshot, 'user1_updated'); // Verify it replaced/updated rather than duplicate
});

// -------------------------------------------------------------
// 4. CAMPAIGN STATE MACHINE TRANSITIONS
// -------------------------------------------------------------
test('CampaignService processes valid state transitions and rejects invalid ones', () => {
    const sqlDb = db.getDb();
    sqlDb.exec(`DELETE FROM campaigns;`);

    const id = CampaignService.createDraft('State Transition Campaign', {}, {}, 'admin');
    let campaign = db.getCampaign(id);
    assert.equal(campaign.status, 'DRAFT');

    // Trying to start DRAFT campaign directly should fail
    assert.throws(() => {
        CampaignService.startCampaign(id, {});
    }, /Can only start campaigns that are in READY status/);

    // Mock finalize transitioning status to READY
    db.updateCampaign(id, { status: 'READY' });
    db.insertRecipients(id, [{ id: '999', username: 'dummy', displayName: 'Dummy', status: 'PENDING' }]);
    campaign = db.getCampaign(id);
    assert.equal(campaign.status, 'READY');

    // Starting campaign moves status to RUNNING
    const mockClient = {
        users: {
            fetch: async () => null // Make fetch return null to stop immediately without success
        }
    };
    CampaignService.startCampaign(id, mockClient);
    campaign = db.getCampaign(id);
    assert.equal(campaign.status, 'RUNNING');

    // Pause transitions to PAUSED
    CampaignService.pauseCampaign(id);
    campaign = db.getCampaign(id);
    assert.equal(campaign.status, 'PAUSED');

    // Resume transitions to RUNNING
    CampaignService.resumeCampaign(id, mockClient);
    campaign = db.getCampaign(id);
    assert.equal(campaign.status, 'RUNNING');

    // Stop transitions to STOPPED
    CampaignService.stopCampaign(id);
    campaign = db.getCampaign(id);
    assert.equal(campaign.status, 'STOPPED');
});

// -------------------------------------------------------------
// 5. ERROR CLASSIFICATION AND RETRY LIMITS
// -------------------------------------------------------------
test('CampaignWorker classifies DM_CLOSED and retries temporary errors up to limit', async () => {
    const sqlDb = db.getDb();
    sqlDb.exec(`DELETE FROM campaign_recipients; DELETE FROM campaigns;`);

    const campaignId = db.createCampaign('Error Classification Campaign', {}, {}, 'admin');
    db.updateCampaign(campaignId, { status: 'RUNNING' });
    activeCampaigns.set(campaignId, { timeout: null, paused: false });

    // Setup recipients
    db.insertRecipients(campaignId, [
        { id: '555', username: 'user_dm_closed', displayName: 'User Closed', status: 'PENDING' },
        { id: '777', username: 'user_temp_error', displayName: 'User Temp', status: 'PENDING' }
    ]);

    // Mock client with error behaviors
    const mockClient = {
        users: {
            fetch: async (id) => {
                if (id === '555') {
                    // Mocks a user with DMs closed
                    return {
                        id,
                        username: 'user_dm_closed',
                        tag: 'user_dm_closed#0000',
                        send: async () => {
                            const err = new Error('Cannot send messages to this user');
                            err.code = 50007; // Discord Closed DM Code
                            throw err;
                        }
                    };
                }
                if (id === '777') {
                    // Mocks a temporary rate limit or server error
                    return {
                        id,
                        username: 'user_temp_error',
                        tag: 'user_temp_error#0000',
                        send: async () => {
                            throw new Error('Internal Server Error');
                        }
                    };
                }
            }
        }
    };

    // Run worker loops explicitly
    // 1. Process User 555 (DM_CLOSED)
    await CampaignWorker.processNext(mockClient, campaignId);
    let r555 = db.getRecipients(campaignId).find(r => r.discord_user_id === '555');
    assert.equal(r555.status, 'DM_CLOSED');
    assert.equal(r555.attempts, 1);

    // 2. Process User 777 (FAILED_TEMPORARY)
    await CampaignWorker.processNext(mockClient, campaignId);
    let r777 = db.getRecipients(campaignId).find(r => r.discord_user_id === '777');
    assert.equal(r777.status, 'FAILED_TEMPORARY');
    assert.equal(r777.attempts, 1);
    assert.ok(r777.next_retry_at > Date.now()); // Verify backoff was scheduled

    // Mock time to allow retry of User 777
    sqlDb.prepare(`UPDATE campaign_recipients SET next_retry_at = 0 WHERE discord_user_id = '777'`).run();

    // 3. Process User 777 again (should hit max attempts = 2 and become FAILED_PERMANENT)
    await CampaignWorker.processNext(mockClient, campaignId);
    r777 = db.getRecipients(campaignId).find(r => r.discord_user_id === '777');
    assert.equal(r777.status, 'FAILED_PERMANENT');
    assert.equal(r777.attempts, 2);
    activeCampaigns.delete(campaignId);
});
