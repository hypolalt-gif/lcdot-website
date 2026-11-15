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
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member.roles.cache.has(process.env.ROLE_MGMT) && !interaction.member.roles.cache.has(process.env.ROLE_EXEC)) {
            return interaction.editReply({ content: '❌ You do not have permission to promote members.' });
        }

        const targetUser = interaction.options.getUser('user');
        const newRank = interaction.options.getString('rank');

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
        const targetData = await db.collection('users').findOne({ id: targetUser.id });
        
        if (!targetData) return interaction.editReply({ content: '❌ This user does not have a registered DOT profile.' });

        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            const oldRankConfig = Object.values(rankConfig).find(r => r.level === targetData.rank_level);
            
            if (oldRankConfig && oldRankConfig.role) await member.roles.remove(oldRankConfig.role).catch(() => {});
            if (newConfig.role) await member.roles.add(newConfig.role);
        } catch (error) { console.error("Discord sync failed", error); }

        await db.collection('users').updateOne(
            { id: targetUser.id },
            { $set: { rank: newRank, rank_level: newConfig.level } }
        );

        const embed = new EmbedBuilder()
            .setColor('#22c55e')
            .setTitle('🎖️ Personnel Promotion')
            .setDescription(`**${targetUser.username}** has been promoted to **${newRank}**.`)
            .addFields({ name: 'Promoted By', value: `<@${interaction.user.id}>` })
            .setTimestamp();

        await interaction.editReply({ content: `✅ Successfully promoted ${targetUser.username}.`, embeds: [] });
        
        // Send the fancy embed to the channel
        await interaction.channel.send({ embeds: [embed] });
    }
};