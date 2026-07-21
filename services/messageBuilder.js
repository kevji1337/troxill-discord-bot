const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { allowedMentionsNone } = require('../utils/helpers');

/**
 * Service to build and personalize Discord DM payloads.
 */
class MessageBuilder {
    /**
     * Safely replaces placeholders in a string.
     * @param {string} text Target text
     * @param {Object} user User data ({ username, displayName })
     * @returns {string} Personalized text
     */
    static personalizeString(text, user = {}) {
        if (!text || typeof text !== 'string') return '';
        const username = user.username || 'User';
        const displayName = user.displayName || username;

        return text
            .replace(/{username}/g, username)
            .replace(/{displayName}/g, displayName);
    }

    /**
     * Builds payload for sending a Discord message.
     * @param {Object} config Message configuration
     * @param {Object} user User data ({ username, displayName })
     * @returns {Object} Discord message payload
     */
    static build(config = {}, user = {}) {
        const payload = {
            allowedMentions: allowedMentionsNone()
        };

        // 1. Content (Personalized)
        if (config.content) {
            payload.content = this.personalizeString(config.content, user);
        }

        // 2. Embed
        if (config.embed && (config.embed.title || config.embed.description)) {
            const embedData = config.embed;
            const embed = new EmbedBuilder();

            if (embedData.title) {
                embed.setTitle(this.personalizeString(embedData.title, user));
            }

            if (embedData.description) {
                embed.setDescription(this.personalizeString(embedData.description, user));
            }

            if (embedData.color) {
                // Ensure color is a number or parse hex string
                let color = embedData.color;
                if (typeof color === 'string') {
                    color = parseInt(color.replace('#', ''), 16);
                }
                if (Number.isFinite(color)) {
                    embed.setColor(color);
                }
            } else {
                embed.setColor(0x2b2d31); // Default dark theme color
            }

            if (embedData.image) {
                embed.setImage(embedData.image);
            }

            if (embedData.thumbnail) {
                embed.setThumbnail(embedData.thumbnail);
            }

            if (embedData.footer) {
                embed.setFooter({ text: this.personalizeString(embedData.footer, user) });
            }

            payload.embeds = [embed];
        }

        // 3. Link Buttons (Action Row)
        if (config.buttons && Array.isArray(config.buttons) && config.buttons.length > 0) {
            const row = new ActionRowBuilder();
            const buttonsAdded = [];

            // Discord allows max 5 buttons in an action row
            const buttons = config.buttons.slice(0, 5);

            for (const btn of buttons) {
                if (!btn.label || !btn.url) continue;

                // Validate URL format simply
                if (!/^https?:\/\//i.test(btn.url)) {
                    console.warn(`Skipping button with invalid URL: ${btn.url}`);
                    continue;
                }

                buttonsAdded.push(
                    new ButtonBuilder()
                        .setLabel(btn.label.slice(0, 80)) // Discord limits button label length to 80 chars
                        .setURL(btn.url)
                        .setStyle(ButtonStyle.Link)
                );
            }

            if (buttonsAdded.length > 0) {
                row.addComponents(buttonsAdded);
                payload.components = [row];
            }
        }

        return payload;
    }
}

module.exports = MessageBuilder;
