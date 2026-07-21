require("dotenv").config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, Routes, REST } = require("discord.js");
const { failFastOnInvalidEnv, normalizeEnvValue } = require('./utils/runtime');

/* ===== ENV ===== */
failFastOnInvalidEnv(process.env);

const DISCORD_TOKEN = normalizeEnvValue(process.env.DISCORD_TOKEN);
const CLIENT_ID = normalizeEnvValue(process.env.CLIENT_ID);
const GUILD_ID = normalizeEnvValue(process.env.GUILD_ID);

/* ===== CLIENT ===== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

/* ===== CAMPAIGN SUBSYSTEM ===== */
const startAdminServer = require('./server/app');
const db = require('./database/campaignDb');

client.once('ready', async () => {
  try {
    // 1. Initialize SQLite Database
    db.getDb();
    console.log('✅ SQLite campaign database initialized.');

    // 2. Recovery logic: reset recipients stuck in PROCESSING to PENDING
    const resetCount = db.resetAllProcessingRecipients();
    if (resetCount > 0) {
      console.log(`🔄 Recovered ${resetCount} processing campaign recipients back to PENDING.`);
    }

    // 3. Recovery logic: Auto-paused recovery: any campaign that was RUNNING when bot stopped should be paused
    const campaigns = db.listCampaigns();
    for (const c of campaigns) {
      if (c.status === 'RUNNING') {
        db.updateCampaign(c.id, { status: 'PAUSED', paused_at: Date.now() });
        db.logCampaignEvent(c.id, 'RECOVERED_PAUSED', 'Campaign automatically paused on startup due to previous crash/restart. Please resume manually.');
        console.log(`🔄 Campaign ${c.id} ("${c.name}") recovered and auto-paused on startup.`);
      }
    }

    // 4. Start Web Admin Express Server
    startAdminServer(client);
  } catch (err) {
    console.error('❌ Failed to initialize campaign subsystem on startup:', err);
  }
});

client.commands = new Collection();

/* ===== LOAD COMMANDS ===== */
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const commandsToRegister = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    commandsToRegister.push(command.data.toJSON());
  } else {
    console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
  }
}

/* ===== LOAD EVENTS ===== */
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

/* ===== REGISTER COMMANDS ===== */
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Started refreshing ${commandsToRegister.length} application (/) commands.`);

    const data = await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commandsToRegister },
    );

    console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    if (error?.status === 401 || error?.code === 0) {
      console.error("❌ Discord REST returned 401 Unauthorized. Проверьте DISCORD_TOKEN/CLIENT_ID/GUILD_ID в Coolify и затем сделайте redeploy.");
    }
    console.error(error);
  }
})();

/* ===== LOGIN ===== */
client.login(DISCORD_TOKEN).catch((error) => {
  if (error?.code === 'TokenInvalid') {
    console.error("❌ Discord token rejected. Вставьте новый Bot Token без кавычек и пробелов, затем redeploy в Coolify.");
  }
  throw error;
});
