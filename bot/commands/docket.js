const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('docket')
        .setDescription('View department policies and dockets'),
    
    async execute(interaction, db) {
        const dockets = await db.collection('dockets').find().toArray();
        
        if (dockets.length === 0) {
            // Seed initial docket if none exist
            await db.collection('dockets').insertOne({
                title: 'Code of Conduct',
                content: 'All members must maintain professionalism, respect chain of command, and follow shift protocols.'
            });
            return interaction.reply({ content: '📖 **Code of Conduct**\nAll members must maintain professionalism, respect chain of command, and follow shift protocols.' });
        }

        const embed = new EmbedBuilder().setColor('#18181b').setTitle('📚 Department Dockets')
            .setDescription('Below is a list of active department rules and policies.')
            .setTimestamp();

        dockets.forEach(d => {
            embed.addFields({ name: d.title, value: d.content });
        });

        await interaction.reply({ embeds: [embed] });
    }
};