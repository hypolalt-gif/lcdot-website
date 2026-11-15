const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roster')
        .setDescription('View the full department roster'),
    
    async execute(interaction, db) {
        await interaction.deferReply();

        const users = await db.collection('users').find({ status: 'Active' }).sort({ rank_level: -1, username: 1 }).toArray();

        if (users.length === 0) return interaction.editReply({ content: '❌ The roster is currently empty.' });

        const ranks = {
            8: 'Executive Board', 7: 'Management Team', 6: 'Field Supervisor', 5: 'Crew Supervisor',
            4: 'Specialist', 3: 'Senior Operator', 2: 'Operator', 1: 'Junior Operator', 0: 'Probationary'
        };

        const embed = new EmbedBuilder()
            .setColor('#18181b')
            .setTitle('📋 Lakeview DOT Roster')
            .setDescription(`Total Active Personnel: **${users.length}**`)
            .setTimestamp();

        for (const [level, rankName] of Object.entries(ranks).reverse()) {
            const membersInRank = users.filter(u => u.rank_level === parseInt(level));
            if (membersInRank.length > 0) {
                embed.addFields({ name: `${rankName} (${membersInRank.length})`, value: membersInRank.map(u => `<@${u.id}>`).join(', ') });
            }
        }

        await interaction.editReply({ embeds: [embed] });
    }
};