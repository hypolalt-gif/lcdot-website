const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your DOT employee profile'),
    
    async execute(interaction, db) {
        // 1. Tell Discord to wait (prevents "Application did not respond" error)
        await interaction.deferReply();

        // 2. Fetch data
        const dbUser = await db.collection('users').findOne({ id: interaction.user.id });

        if (!dbUser) {
            return interaction.editReply({ content: '❌ You do not have a registered DOT profile. Please log into the website first.' });
        }

        const totalHours = (dbUser.total_minutes || 0) / 60;

        const embed = new EmbedBuilder()
            .setColor('#18181b')
            .setTitle(`👤 Employee Profile: ${dbUser.username}`)
            .setThumbnail(dbUser.avatar_url || interaction.user.displayAvatarURL())
            .addFields(
                { name: 'Rank', value: `\`${dbUser.rank || 'Unranked'}\``, inline: true },
                { name: 'Status', value: `\`${dbUser.status || 'Active'}\``, inline: true },
                { name: 'Total Hours', value: `\`${totalHours.toFixed(1)} hrs\``, inline: true }
            )
            .setFooter({ text: 'Lakeview City DOT | Personnel System' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
};