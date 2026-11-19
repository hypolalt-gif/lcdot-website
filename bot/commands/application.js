const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Manage department applications')
        .addSubcommand(sub => sub.setName('submit').setDescription('Submit a new DOT application'))
        .addSubcommand(sub => sub.setName('review').setDescription('Review pending applications (Mgmt+ Only)')),
    
    async execute(interaction, db) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'submit') {
            const modal = new ModalBuilder()
                .setCustomId('app_submit_modal')
                .setTitle('DOT Application');

            const robloxInput = new TextInputBuilder().setCustomId('roblox_user').setLabel('Roblox Username').setStyle(TextInputStyle.Short).setRequired(true);
            const experienceInput = new TextInputBuilder().setCustomId('experience').setLabel('Previous Experience').setStyle(TextInputStyle.Paragraph).setRequired(true);
            const whyInput = new TextInputBuilder().setCustomId('why_join').setLabel('Why should we accept you?').setStyle(TextInputStyle.Paragraph).setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(robloxInput),
                new ActionRowBuilder().addComponents(experienceInput),
                new ActionRowBuilder().addComponents(whyInput)
            );

            await interaction.showModal(modal);
        }

        if (sub === 'review') {
            const dbUser = await db.collection('users').findOne({ id: interaction.user.id });
            if (!dbUser || dbUser.rank_level < 7) return interaction.reply({ content: '❌ Access Denied. Management+ Only.', ephemeral: true });

            const apps = await db.collection('applications').find({ status: 'Pending' }).toArray();
            if (apps.length === 0) return interaction.reply({ content: '✅ No pending applications.', ephemeral: true });

            // Show the oldest pending application
            const app = apps[0];
            const embed = new EmbedBuilder().setColor('#18181b').setTitle('📝 Application Review')
                .addFields(
                    { name: 'Applicant', value: `<@${app.userId}> (${app.robloxUser})`, inline: true },
                    { name: 'Status', value: 'Pending', inline: true },
                    { name: 'Previous Experience', value: app.experience },
                    { name: 'Why Join?', value: app.whyJoin }
                ).setFooter({ text: `App ID: ${app.appId}` }).setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`app_approve_${app.appId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`app_deny_${app.appId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({ embeds: [embed], components: [row] });
        }
    }
};