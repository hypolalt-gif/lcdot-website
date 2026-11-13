const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ObjectId } = require('mongodb');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View an employee profile')
        .addUserOption(opt => opt.setName('user').setDescription('The user to view').setRequired(false)),
    
    async execute(interaction, db) {
        // 1. Determine Target User
        const targetUser = interaction.options.getUser('user') || interaction.user;
        
        // 2. Fetch Data from MongoDB
        const dbUser = await db.collection('users').findOne({ id: targetUser.id });
        
        if (!dbUser) {
            return interaction.reply({ 
                content: "❌ This user does not have a registered DOT profile. They must log into the website first.", 
                ephemeral: true 
            });
        }

        // 3. Calculate Points (2 points per hour) - From your previous message
        const totalHours = (dbUser.total_minutes || 0) / 60;
        const totalPoints = Math.floor(totalHours * 2); 

        // 4. Build the ECC-Style Embed
        const embed = new EmbedBuilder()
            .setColor('#1e2124') // ECC Dark Slate
            .setAuthor({ 
                name: 'Department of Transportation', 
                iconURL: 'https://cdn.discordapp.com/attachments/1533196538048942110/1570179443874336818/lkdot.png' 
            })
            .setTitle(`Employee Profile: ${dbUser.username}`)
            .setThumbnail(dbUser.avatar_url || targetUser.displayAvatarURL())
            .addFields(
                { name: 'Rank', value: `\`${dbUser.rank || 'Unranked'}\``, inline: true },
                { name: 'Status', value: `\`${dbUser.status || 'Active'}\``, inline: true },
                { name: 'Employee ID', value: `\`DOT-${targetUser.id.slice(-4)}\``, inline: true },
                { name: 'Verified Hours', value: `\`${totalHours.toFixed(1)} Hours\``, inline: true },
                { name: 'Activity Points', value: `\`${totalPoints} PTS\``, inline: true },
                { name: 'Weekly Hours', value: `\`${((dbUser.weekly_minutes || 0) / 60).toFixed(1)} Hours\``, inline: true }
            )
            .setFooter({ text: 'Lakeview City DOT | Internal Affairs' })
            .setTimestamp();

        // 5. Send Response
        await interaction.reply({ embeds: [embed] });
    }
};