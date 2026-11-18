const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('oos')
        .setDescription('Office of Operator Standards Commands')
        .addSubcommand(sub =>
            sub.setName('panel')
                .setDescription('Open the OOS punishment panel')
                .addUserOption(opt => opt.setName('user').setDescription('The user to manage').setRequired(true))),
    
    async execute(interaction, db) {
        // 1. Check Database for OOS Access (Granted via Website)
        const dbUser = await db.collection('users').findOne({ id: interaction.user.id });
        
        // 2. Also check Discord Roles just in case
        const hasDiscordRole = interaction.member.roles.cache.has(process.env.OOS_ROLE_AGENT) || 
                               interaction.member.roles.cache.has(process.env.OOS_ROLE_LEAD) || 
                               interaction.member.roles.cache.has(process.env.OOS_ROLE_OVERSIGHT);

        // 3. Deny if they have neither
        if (!hasDiscordRole && (!dbUser || !dbUser.isOOS)) {
            return interaction.reply({ content: '❌ You do not have OOS access.', ephemeral: true });
        }

        const target = interaction.options.getUser('user');
        const refCode = Math.random().toString(36).substring(2, 8).toUpperCase(); // e.g. C6I4OW

        const embed = new EmbedBuilder()
            .setColor('#18181b')
            .setTitle('Office of Operator Standards Panel')
            .setDescription('Welcome to the OOS panel. Below is a list of options. All actions are logged.')
            .addFields(
                { name: 'Target User', value: `<@${target.id}>`, inline: false },
                { name: 'Reference Code', value: refCode, inline: false }
            )
            .setThumbnail('https://cdn.discordapp.com/attachments/1477138457821446216/1514637975374397571/LCDOT_OOS_1.png');

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`oos_btn_Verbal_${target.id}_${refCode}`).setLabel('Verbal Warning').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`oos_btn_Written_${target.id}_${refCode}`).setLabel('Written Warning').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`oos_btn_Final_${target.id}_${refCode}`).setLabel('Final Warning').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`oos_btn_Suspension_${target.id}_${refCode}`).setLabel('Suspension').setStyle(ButtonStyle.Secondary)
        );
        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`oos_btn_Demotion_${target.id}_${refCode}`).setLabel('Demotion').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`oos_btn_Termination_${target.id}_${refCode}`).setLabel('Termination').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`oos_btn_Divisional_${target.id}_${refCode}`).setLabel('Divisional Punishment').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`oos_btn_Message_${target.id}_${refCode}`).setLabel('Message').setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
    }
};