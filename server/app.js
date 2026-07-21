const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const db = require('../database/campaignDb');
const apiRoutes = require('./routes/api');
const { parseSnowflakeList } = require('../utils/helpers');
const { PermissionFlagsBits } = require('discord.js');

function startAdminServer(client) {
    const app = express();
    const port = Number(process.env.PORT) || 1784;
    const host = process.env.HOST || '0.0.0.0';
    const sessionSecret = process.env.SESSION_SECRET || 'troxill-session-fallback-secret-key-321';

    app.set('discordClient', client);

    // Security Headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
                connectSrc: ["'self'"],
            }
        }
    }));

    // CORS Config
    app.use(cors({
        origin: process.env.ADMIN_BASE_URL || `http://localhost:${port}`,
        credentials: true
    }));

    // Rate Limiting for general API
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 500, // Limit each IP to 500 requests per window
        message: { error: 'Too many requests from this IP, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/', apiLimiter);

    // JSON body parsing
    app.use(express.json());

    // Session configurations
    app.use(session({
        name: 'sid',
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production', // true in production
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
    }));

    // -------------------------------------------------------------
    // DISCORD OAUTH2 FLOW
    // -------------------------------------------------------------
    app.get('/api/auth/login', (req, res) => {
        const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
        const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;

        if (!clientId || !redirectUri) {
            return res.status(500).json({ error: 'OAuth client configuration is missing in environment variables' });
        }

        // Generate state token for CSRF protection
        const state = crypto.randomBytes(16).toString('hex');
        req.session.oauthState = state;

        const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify&state=${state}`;
        res.redirect(authUrl);
    });

    app.get('/api/auth/callback', async (req, res) => {
        const { code, state, error } = req.query;

        if (error) {
            console.error('OAuth callback error:', error);
            return res.redirect('/?error=oauth_failed');
        }

        if (!code || !state) {
            return res.status(400).send('Bad Request. Missing code or state.');
        }

        // Validate state token to prevent CSRF
        if (!req.session.oauthState || state !== req.session.oauthState) {
            return res.status(400).send('Invalid OAuth state. Potential CSRF attack.');
        }
        delete req.session.oauthState;

        const clientId = process.env.DISCORD_OAUTH_CLIENT_ID;
        const clientSecret = process.env.DISCORD_OAUTH_CLIENT_SECRET;
        const redirectUri = process.env.DISCORD_OAUTH_REDIRECT_URI;

        try {
            // 1. Exchange OAuth code for Access Token
            const tokenParams = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri
            });

            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: tokenParams.toString()
            });

            if (!tokenResponse.ok) {
                const errData = await tokenResponse.json();
                console.error('Token exchange failed:', errData);
                throw new Error('Failed to exchange authorization code for token');
            }

            const tokenData = await tokenResponse.json();
            const accessToken = tokenData.access_token;

            // 2. Fetch User Profile
            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (!userResponse.ok) {
                throw new Error('Failed to fetch Discord user profile');
            }

            const userData = await userResponse.json();
            const userId = userData.id;

            // 3. Authorization check
            let isAdminUser = false;

            // A. Check explicit whitelist
            const whitelist = new Set(parseSnowflakeList(process.env.ADMIN_DISCORD_IDS || ''));
            if (whitelist.has(userId)) {
                isAdminUser = true;
            }

            // B. Check Guild Permissions (Administrator / Curator)
            const guildId = process.env.GUILD_ID;
            if (!isAdminUser && guildId && client) {
                const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
                if (guild) {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        const hasAdminPerm = member.permissions.has(PermissionFlagsBits.Administrator);
                        const curatorRoleId = String(process.env.CURATOR_ROLE_ID || '').trim();
                        const hasCuratorRole = curatorRoleId && member.roles.cache.has(curatorRoleId);

                        if (hasAdminPerm || hasCuratorRole) {
                            isAdminUser = true;
                        }
                    }
                }
            }

            if (!isAdminUser) {
                db.logAudit(userId, 'unauthorized_login_attempt', null, { tag: userData.username });
                return res.redirect('/?error=unauthorized');
            }

            // Establish session
            req.session.user = {
                id: userId,
                username: userData.username,
                globalName: userData.global_name || userData.username,
                avatar: userData.avatar,
                isAdmin: true
            };

            db.logAudit(userId, 'login', null, { username: userData.username });
            return res.redirect('/');
        } catch (err) {
            console.error('OAuth processing failed:', err);
            return res.redirect('/?error=server_error');
        }
    });

    // API Routes integration
    app.use('/api', apiRoutes);

    // Serve Frontend build folder statically in production
    const frontendDist = path.join(__dirname, '../frontend/dist');
    app.use(express.static(frontendDist));

    // Fallback page router for SPA history mode (React Router)
    app.get('/*all', (req, res) => {
        const indexHtml = path.join(frontendDist, 'index.html');
        if (fs.existsSync(indexHtml)) {
            res.sendFile(indexHtml);
        } else {
            // Default placeholder if frontend build doesn't exist yet
            res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Troxill Web Admin</title><style>body{font-family:sans-serif;background:#1e1f22;color:#f2f3f5;text-align:center;padding:50px;}</style></head>
                <body>
                    <h1>Troxill Support Bot - Admin API</h1>
                    <p>Web Panel Frontend is loading or needs to be built. API is running successfully.</p>
                    <a href="/api/auth/login" style="background:#5865f2;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;margin-top:20px;">Login with Discord</a>
                </body>
                </html>
            `);
        }
    });

    // Global Error Handler
    app.use((err, req, res, next) => {
        console.error('Server Internal Error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    });

    const server = app.listen(port, host, () => {
        console.log(`🚀 Web Admin HTTP Server is running on http://${host}:${port}`);
    });

    return server;
}

module.exports = startAdminServer;
