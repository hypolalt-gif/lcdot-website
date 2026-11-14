const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a department member')
        .addUserOption(opt => opt.setName('user').setDescription('The user to promote').setRequired(true))
        .addStringOption(opt => opt.setName('rank').setDescription('The new rank').setRequired(true).addChoices(
            { name: 'Junior Operator', value: 'Junior Operator' }, { name: 'Operator', value: 'Operator' },
            { name: 'Senior Operator', value: 'Senior Operator' }, { name: 'Specialist', value: 'Specialist' },
            { name: 'Crew Supervisor', value: 'Crew Supervisor' }, { name: 'Field Supervisor', value: 'Field Supervisor' },
            { name: 'Management Team', value: 'Management Team' }, { name: 'Executive Board', value: 'Executive Board' }
        )),
    
    async execute(interaction, db) {
        // 1. Check Permissions (Management+)
        if (interaction.member.roles.cache.has(process.env.ROLE_MGMT) === false && interaction.member.roles.cache.has(process.env.ROLE_EXEC) === false) {
            return interaction.reply({ content: '❌ You do not have permission to promote members.', ephemeral: true });
        }

        const targetUser = interaction.options.getUser('user');
        const newRank = interaction.options.getString('rank');

        // Map string rank to role ID and level
        const rankConfig = {
            "Junior Operator": { level: 1, role: process.env.ROLE_JUNIOR },
            "Operator": { level: 2, role: process.env.ROLE_OPERATOR },
            "Senior Operator": { level: 3, role: process.env.ROLE_SENIOR },
            "Specialist": { level: 4, role: process.env.ROLE_SPECIALIST },
            "Crew Supervisor": { level: 5, role: process.env.ROLE_CREW },
            "Field Supervisor": { level: 6, role: process.env.ROLE_FIELD },
            "Management Team": { level: 7, role: process.env.ROLE_MGMT },
            "Executive Board": { level: 8, role: process.env.ROLE_EXEC }
        };

        const newConfig = rankConfig[newRank];

        // 2. Fetch current DB record to get old rank
        const targetData = await db.collection('users').findOne({ id: targetUser.id });
        if (!targetData) {
            return interaction.reply({ content: '❌ This user does not have a registered DOT profile.', ephemeral: true });
        }

        // 3. Update Discord Roles
        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            
            // Remove old rank role if it exists
            const oldRankConfig = Object.values(rankConfig).find(r => r.level === targetData.rank_level);
            if (oldRankConfig && oldRankConfig.role) {
                await member.roles.remove(oldRankConfig.role).catch(() => {});
            }

            // Add new rank role
            if (newConfig.role) {
                await member.roles.add(newConfig.role);
            }
        } catch (error) {
            console.error("Failed to update Discord roles:", error);
            // We continue anyway to update the DB, per spec: "If Discord synchronization fails, preserve the database change"
        }

        // 4. Update Database
        await db.collection('users').updateOne(
            { id: targetUser.id },
            { 
                $set: { 
                    rank: newRank, 
                    rank_level: newConfig.level,
                    last_promotion: new Date()
                },
                $push: { 
                    promotion_history: { 
                        old_rank: targetData.rank, 
                        new_rank: newRank, 
                        promoted_by: interaction.user.username, 
                        date: new Date() 
                    } 
                }
            }
        );

        // 5. Build Response Embed
        const embed = new EmbedBuilder()
            .setColor('#22c55e')
            .setAuthor({ name: 'Department of Transportation', iconURL: 'https://cdn.discordapp.com/attachments/1533196538048942110/1570179443874336818/lkdot.png' })
            .setTitle('🎖️ Personnel Promotion')
            .setDescription(`**${targetUser.username}** has been promoted to **${newRank}**.`)
            .addFields(
                { name: 'Promoted By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Previous Rank', value: targetData.rank || 'None', inline: true }
            )
            .setFooter({ text: 'Lakeview City DOT | Personnel Action' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};