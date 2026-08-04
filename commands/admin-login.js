const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createPasscode } = require('../services/passcodeStore');
const { isModerator, isCurator, isAdmin } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin-login')
        .setDescription('Получить одноразовый код для входа в веб-панель управления'),
    async execute(interaction) {
        const member = interaction.member;
        const userId = interaction.user.id;
        const adminWhitelist = new Set((process.env.ADMIN_DISCORD_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

        const isAllowed = adminWhitelist.has(userId) || (member && (isAdmin(member) || isModerator(member) || isCurator(member)));

        if (!isAllowed) {
            return interaction.reply({
                content: '❌ У вас нет прав для доступа к веб-панели управления.',
                flags: MessageFlags.Ephemeral
            });
        }

        const userObj = {
            id: userId,
            username: interaction.user.username,
            globalName: interaction.user.globalName || interaction.user.username,
            avatar: interaction.user.avatar,
            isAdmin: true
        };

        const code = createPasscode(userObj);

        return interaction.reply({
            content: `🔑 Ваш одноразовый код для входа в веб-панель: **\`${code}\`**\n⏱️ Код действителен 10 минут.\n🌐 Введите этот код на странице авторизации в веб-панели.`,
            flags: MessageFlags.Ephemeral
        });
    }
};
