const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roster')
        .setDescription('View the full department roster'),
    
    async execute(interaction, db) {
        await interaction.deferReply();

        // Fetch all active users, sorted by rank level (highest first)
        const users = await db.collection('users').find({ status: 'Active' }).sort({ rank_level: -1, username: 1 }).toArray();

        if (users.length === 0) {
            return interaction.editReply({ content: '❌ The roster is currently empty.' });
        }

        // Group users by rank
        const ranks = {
            8: 'Executive Board', 7: 'Management Team', 6: 'Field Supervisor', 5: 'Crew Supervisor',
            4: 'Specialist', 3: 'Senior Operator', 2: 'Operator', 1: 'Junior Operator', 0: 'Probationary'
        };

        const embed = new EmbedBuilder()
            .setColor('#1e2124')
            .setAuthor({ name: 'Lakeview City DOT', iconURL: 'https://cdn.discordapp.com/attachments/1533196538048942110/1570179443874336818/lkdot.png' })
            .setTitle('📋 Department Roster')
            .setDescription(`Total Active Personnel: **${users.length}**`)
            .setFooter({ text: 'Lakeview City DOT | Personnel Directory' })
            .setTimestamp();

        // Build the fields based on rank
        for (const [level, rankName] of Object.entries(ranks).reverse()) {
            const membersInRank = users.filter(u => u.rank_level === parseInt(level));
            if (membersInRank.length > 0) {
                const memberList = membersInRank.map(u => `<@${u.id}> (${u.username})`).join('\n');
                embed.addFields({ name: `${rankName} (${membersInRank.length})`, value: memberList });
            }
        }

        await interaction.editReply({ embeds: [embed] });
    }
};