const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shift')
        .setDescription('Manage your shifts and view data')
        .addSubcommand(subcommand =>
            subcommand
                .setName('manage')
                .setDescription('Manage your shift: start it, go on break, end it')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('The shift type to use')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Regular', value: 'Regular' },
                            { name: 'Supervisory', value: 'Supervisory' },
                            { name: 'FTO', value: 'FTO' },
                            { name: 'HOD', value: 'HOD' },
                            { name: 'COD', value: 'COD' },
                            { name: 'CCD', value: 'CCD' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('View the shift leaderboard')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Filter by shift type')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All Types', value: 'All' },
                            { name: 'Regular', value: 'Regular' },
                            { name: 'Supervisory', value: 'Supervisory' },
                            { name: 'FTO', value: 'FTO' },
                            { name: 'HOD', value: 'HOD' },
                            { name: 'COD', value: 'COD' },
                            { name: 'CCD', value: 'CCD' }
                        ))),

    async execute(interaction, db) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        if (subcommand === 'manage') {
            const type = interaction.options.getString('type');
            
            // Check for active shift
            const activeShift = await db.collection('active_shifts').findOne({ userId });
            if (activeShift) {
                return interaction.reply({ content: '❌ You already have an active shift running!', ephemeral: true });
            }

            // Calculate stats
            const pastShifts = await db.collection('completed_shifts').find({ userId, type }).toArray();
            const totalMs = pastShifts.reduce((acc, shift) => acc + shift.durationMs, 0);
            const totalMins = Math.floor(totalMs / 60000);
            const avgMins = pastShifts.length > 0 ? Math.floor(totalMins / pastShifts.length) : 0;

            const embed = new EmbedBuilder()
                .setColor('#18181b')
                .setTitle('⏱️ Shift Management')
                .addFields(
                    { name: '📄 All Time Information', value: '\u200B' },
                    { name: 'Shift Count', value: `\`${pastShifts.length}\``, inline: false },
                    { name: 'Total Duration', value: `\`${totalMins} minutes\``, inline: false },
                    { name: 'Average Duration', value: `\`${avgMins} minutes\``, inline: false },
                    { name: 'Shift Type', value: `\`${type}\``, inline: false }
                )
                .setThumbnail(interaction.user.displayAvatarURL());

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`shift_start_${type}`).setLabel('Start').setStyle(ButtonStyle.Success).setEmoji('⏱️'),
                new ButtonBuilder().setCustomId(`shift_pause`).setLabel('Pause').setStyle(ButtonStyle.Primary).setEmoji('⏸️').setDisabled(true),
                new ButtonBuilder().setCustomId(`shift_end`).setLabel('End').setStyle(ButtonStyle.Danger).setEmoji('⏹️').setDisabled(true)
            );

            await interaction.reply({ embeds: [embed], components: [row] });
        }

        if (subcommand === 'leaderboard') {
            const typeFilter = interaction.options.getString('type');
            let query = { status: 'Completed' };
            if (typeFilter && typeFilter !== 'All') query.type = typeFilter;

            const topShifts = await db.collection('completed_shifts').aggregate([
                { $match: query },
                { $group: { _id: '$userId', totalMs: { $sum: '$durationMs' }, username: { $first: '$username' } } },
                { $sort: { totalMs: -1 } },
                { $limit: 10 }
            ]).toArray();

            if (topShifts.length === 0) return interaction.reply({ content: 'No shifts logged yet.', ephemeral: true });

            const embed = new EmbedBuilder()
                .setColor('#d4af37')
                .setTitle(`🏆 Shift Leaderboard ${typeFilter && typeFilter !== 'All' ? `(${typeFilter})` : '(All Types)'}`)
                .setDescription(topShifts.map((s, index) => `**${index + 1}.** ${s.username} - \`${Math.floor(s.totalMs / 3600000)}h ${Math.floor((s.totalMs % 3600000) / 60000)}m\``).join('\n'));

            await interaction.reply({ embeds: [embed] });
        }
    }
};