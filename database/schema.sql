-- Campaigns configuration and status
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'READY', 'RUNNING', 'PAUSED', 'AWAITING_CONFIRMATION', 'STOPPED', 'COMPLETED', 'FAILED')),
    guild_id TEXT NOT NULL,
    message_config TEXT NOT NULL,       -- JSON string containing embed, content, button configs
    campaign_settings TEXT NOT NULL,    -- JSON string for wave size, delays, continuous flags
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    paused_at INTEGER,
    completed_at INTEGER,
    stopped_at INTEGER
);

-- Recipient snapshots and individual delivery states
CREATE TABLE IF NOT EXISTS campaign_recipients (
    campaign_id INTEGER NOT NULL,
    discord_user_id TEXT NOT NULL,
    username_snapshot TEXT NOT NULL,
    display_name_snapshot TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'DM_CLOSED', 'FAILED_TEMPORARY', 'FAILED_PERMANENT', 'EXCLUDED')),
    attempts INTEGER DEFAULT 0,
    last_error_code TEXT,
    last_error_message TEXT,
    next_retry_at INTEGER,
    sent_at INTEGER,
    processed_at INTEGER,
    PRIMARY KEY (campaign_id, discord_user_id),
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Global blacklist exclusions
CREATE TABLE IF NOT EXISTS excluded_users (
    discord_user_id TEXT PRIMARY KEY,
    username TEXT,
    added_at INTEGER NOT NULL,
    added_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS excluded_roles (
    role_id TEXT PRIMARY KEY,
    role_name TEXT,
    added_at INTEGER NOT NULL,
    added_by TEXT NOT NULL
);

-- Audit and event trails
CREATE TABLE IF NOT EXISTS campaign_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    event_type TEXT NOT NULL,
    message TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_discord_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    metadata TEXT,                      -- JSON string of context information
    timestamp INTEGER NOT NULL
);

-- Indices for faster lookup
CREATE INDEX IF NOT EXISTS idx_recipients_status ON campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_recipients_retry ON campaign_recipients(campaign_id, status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON campaign_events(campaign_id);
