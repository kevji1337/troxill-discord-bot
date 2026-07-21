const db = require('../database/campaignDb');
const MessageBuilder = require('./messageBuilder');

// Map of active campaigns currently running. key: campaignId, value: { timeout, paused }
const activeCampaigns = new Map();
let globalKillSwitch = false;

class CampaignWorker {
    /**
     * Start or resume a campaign.
     * @param {Client} client Discord Client
     * @param {number} campaignId ID of the campaign
     * @returns {boolean} Whether the campaign worker started successfully
     */
    static start(client, campaignId) {
        if (globalKillSwitch) {
            console.warn('Global kill switch is active. Cannot start campaign.');
            return false;
        }

        if (activeCampaigns.has(campaignId)) {
            // Already running
            return true;
        }

        const campaign = db.getCampaign(campaignId);
        if (!campaign) {
            console.error(`Campaign ${campaignId} not found in database`);
            return false;
        }

        // Reset any recipient status left in 'PROCESSING' to 'PENDING'
        db.resetProcessingRecipients(campaignId);

        activeCampaigns.set(campaignId, { timeout: null, paused: false });
        db.logCampaignEvent(campaignId, 'STARTED', 'Campaign worker started');

        // Start processing loop
        this.processNext(client, campaignId);
        return true;
    }

    /**
     * Pause a campaign.
     * @param {number} campaignId
     */
    static pause(campaignId) {
        const active = activeCampaigns.get(campaignId);
        if (active) {
            active.paused = true;
            if (active.timeout) {
                clearTimeout(active.timeout);
            }
            activeCampaigns.delete(campaignId);
            db.updateCampaign(campaignId, { status: 'PAUSED', paused_at: Date.now() });
            db.logCampaignEvent(campaignId, 'PAUSED', 'Campaign worker paused by administrator');
            return true;
        }
        return false;
    }

    /**
     * Stop a campaign.
     * @param {number} campaignId
     */
    static stop(campaignId) {
        const active = activeCampaigns.get(campaignId);
        if (active) {
            if (active.timeout) {
                clearTimeout(active.timeout);
            }
            activeCampaigns.delete(campaignId);
        }
        db.updateCampaign(campaignId, { status: 'STOPPED', stopped_at: Date.now() });
        db.logCampaignEvent(campaignId, 'STOPPED', 'Campaign worker stopped by administrator');
        return true;
    }

    /**
     * Set global kill switch to stop all worker loops.
     * @param {boolean} value
     */
    static setGlobalKillSwitch(value) {
        globalKillSwitch = value;
        if (value) {
            for (const [campaignId, active] of activeCampaigns.entries()) {
                if (active.timeout) {
                    clearTimeout(active.timeout);
                }
                db.updateCampaign(campaignId, { status: 'PAUSED', paused_at: Date.now() });
                db.logCampaignEvent(campaignId, 'KILLED', 'Campaign worker paused due to global kill switch activation');
            }
            activeCampaigns.clear();
        }
    }

    static isGlobalKillSwitchActive() {
        return globalKillSwitch;
    }

    /**
     * Process next recipient in the queue.
     * @param {Client} client Discord Client
     * @param {number} campaignId Campaign ID
     */
    static async processNext(client, campaignId) {
        const active = activeCampaigns.get(campaignId);
        if (!active || active.paused || globalKillSwitch) {
            return;
        }

        // Get campaign config and stats
        const campaign = db.getCampaign(campaignId);
        if (!campaign || campaign.status !== 'RUNNING') {
            activeCampaigns.delete(campaignId);
            return;
        }

        const settings = campaign.campaign_settings || {};
        const defaultDelay = Number(process.env.CAMPAIGN_DEFAULT_DELAY_MS) || 2000;
        const delayMs = Number.isFinite(settings.delayMs) ? Math.max(500, settings.delayMs) : defaultDelay;

        // Check wave limit
        const waveSize = Number(settings.waveSize) || 50;
        const isContinuous = !!settings.isContinuous;

        // Count how many recipients have been processed in the current wave
        // A wave consists of recipients sent since the last campaign started_at or resumed_at
        // Let's count how many sent/processed recipients there are in the database.
        // Actually, we can count the number of recipients that are SENT or processed after the last start/resume
        // However, a simpler wave tracker is: count recipients that have been processed since started_at or paused_at/resumed_at.
        // Or count how many recipients in the database have processed_at >= started_at (excluding EXCLUDED).
        // Let's check how many recipients have processed_at >= started_at and status in ('SENT', 'DM_CLOSED', 'FAILED_PERMANENT')
        const dbInstance = db.getDb();
        const refTime = campaign.started_at || 0;
        const processedInCurrentWaveStmt = dbInstance.prepare(`
            SELECT COUNT(*) as count FROM campaign_recipients
            WHERE campaign_id = ? 
              AND processed_at >= ? 
              AND status IN ('SENT', 'DM_CLOSED', 'FAILED_PERMANENT', 'FAILED_TEMPORARY')
        `);
        const waveProgress = processedInCurrentWaveStmt.get(campaignId, refTime).count;

        if (!isContinuous && waveProgress >= waveSize) {
            // Wave limit reached! Change campaign status to AWAITING_CONFIRMATION
            activeCampaigns.delete(campaignId);
            db.updateCampaign(campaignId, { status: 'AWAITING_CONFIRMATION' });
            db.logCampaignEvent(campaignId, 'WAVE_COMPLETED', `Wave of size ${waveSize} completed. Awaiting admin confirmation.`);
            return;
        }

        // Fetch eligible recipients (PENDING or FAILED_TEMPORARY due for retry)
        const eligible = db.getEligibleRecipients(campaignId, 1);
        if (eligible.length === 0) {
            // No more eligible recipients!
            // Check if there are any FAILED_TEMPORARY recipients that are waiting for backoff
            const pendingRetryStmt = dbInstance.prepare(`
                SELECT COUNT(*) as count FROM campaign_recipients
                WHERE campaign_id = ? AND status = 'FAILED_TEMPORARY'
            `);
            const retryCount = pendingRetryStmt.get(campaignId).count;

            if (retryCount > 0) {
                // Wait and check again later (backoff polling)
                active.timeout = setTimeout(() => this.processNext(client, campaignId), 5000);
                return;
            }

            // No pending retries either. The campaign is completed!
            activeCampaigns.delete(campaignId);
            db.updateCampaign(campaignId, { status: 'COMPLETED', completed_at: Date.now() });
            db.logCampaignEvent(campaignId, 'COMPLETED', 'Campaign completed successfully.');
            return;
        }

        const recipient = eligible[0];

        // Atomic lock: update status to PROCESSING
        db.updateRecipientStatus(campaignId, recipient.discord_user_id, 'PROCESSING', {
            attempts: recipient.attempts + 1
        });

        let sendSuccess = false;
        let lastError = null;

        try {
            // 1. Fetch user from Discord API
            const user = await client.users.fetch(recipient.discord_user_id);
            if (!user) {
                throw { code: 10013, message: 'Unknown User' }; // Discord Code for Unknown User
            }

            // 2. Build personalized message payload
            const payload = MessageBuilder.build(campaign.message_config, {
                username: recipient.username_snapshot,
                displayName: recipient.display_name_snapshot
            });

            // 3. Send message
            await user.send(payload);
            sendSuccess = true;
        } catch (error) {
            lastError = error;
        }

        if (sendSuccess) {
            db.updateRecipientStatus(campaignId, recipient.discord_user_id, 'SENT', {
                sent_at: Date.now()
            });
        } else {
            const errorCode = lastError?.code;
            const errorMessage = lastError?.message || String(lastError);

            // Error Classification
            let nextStatus = 'FAILED_TEMPORARY';
            const maxAttempts = Number(process.env.CAMPAIGN_MAX_ATTEMPTS) || 3;

            if (errorCode === 50007) {
                // Cannot send messages to this user (DM closed)
                nextStatus = 'DM_CLOSED';
            } else if (
                errorCode === 10013 || // Unknown User
                errorCode === 50013 || // Missing Permissions / Forbidden
                errorCode === 50035 || // Invalid Form Body
                (lastError?.status === 403) // Forbidden access (e.g. user blocked bot)
            ) {
                nextStatus = 'FAILED_PERMANENT';
            } else {
                // Transient error, check max attempts
                const currentAttempts = recipient.attempts + 1;
                if (currentAttempts >= maxAttempts) {
                    nextStatus = 'FAILED_PERMANENT';
                }
            }

            const details = {
                last_error_code: errorCode ? String(errorCode) : 'UNKNOWN',
                last_error_message: errorMessage
            };

            if (nextStatus === 'FAILED_TEMPORARY') {
                // Apply simple exponential backoff for retry: 2^attempts * 1 minute
                const nextAttempt = recipient.attempts + 1;
                const backoffMs = Math.pow(2, nextAttempt) * 60 * 1000;
                details.next_retry_at = Date.now() + backoffMs;
            }

            db.updateRecipientStatus(campaignId, recipient.discord_user_id, nextStatus, details);
        }

        // Schedule next execution with delay
        active.timeout = setTimeout(() => this.processNext(client, campaignId), delayMs);
    }
}

module.exports = {
    CampaignWorker,
    activeCampaigns
};
