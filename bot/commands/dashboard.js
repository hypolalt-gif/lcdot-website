const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open a department dashboard')
        .addSubcommand(sub => sub.setName('directory').setDescription('Open the Directory/Director panel'))
        .addSubcommand(sub => sub.setName('management').setDescription('Open the Management panel'))
        .addSubcommand(sub => sub.setName('operations').setDescription('Open the Operations panel')),
    
    async execute(interaction, db) {
        const sub = interaction.options.getSubcommand();
        const dbUser = await db.collection('users').findOne({ id: interaction.user.id });
        const rankLevel = dbUser ? dbUser.rank_level : 0;

        if (sub === 'directory') {
            if (rankLevel < 7) return interaction.reply({ content: '❌ Access Denied. Management+ Only.', ephemeral: true });
            
            const embed = new EmbedBuilder().setColor('#d4af37').setTitle('🏛️ Directory Command Center')
                .setDescription('Welcome to the Directory panel. Manage personnel, dockets, and department standards.')
                .setTimestamp();
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('dash_personnel').setLabel('Manage Personnel').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('dash_dockets').setLabel('View Dockets').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('dash_bans').setLabel('Bans / Blacklists').setStyle(ButtonStyle.Danger)
            );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }

        if (sub === 'management') {
            if (rankLevel < 7) return interaction.reply({ content: '❌ Access Denied. Management+ Only.', ephemeral: true });
            
            const embed = new EmbedBuilder().setColor('#3b82f6').setTitle('📋 Management Command Center')
                .setDescription('Review applications, manage FTOs, and oversee discipline.')
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('dash_apps').setLabel('Applications').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('dash_fto').setLabel('FTO Training').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('dash_discipline').setLabel('Discipline').setStyle(ButtonStyle.Danger)
            );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
        
        if (sub === 'operations') {
            if (rankLevel < 5) return interaction.reply({ content: '❌ Access Denied. Supervisory+ Only.', ephemeral: true });
            
            const embed = new EmbedBuilder().setColor('#16a34a').setTitle('🚦 Operations Center')
                .setDescription('Manage active shifts, dispatch reports, and supervisory agreements.')
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('dash_shifts').setLabel('Active Shifts').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('dash_report').setLabel('Dispatch Report').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('dash_agreement').setLabel('Supervisory TOS').setStyle(ButtonStyle.Secondary)
            );
            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
    }
};