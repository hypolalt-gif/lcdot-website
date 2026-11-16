const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Submit a promotion request for an operator')
        .addUserOption(opt => opt.setName('user').setDescription('The user to promote').setRequired(true))
        .addStringOption(opt => opt.setName('new_rank').setDescription('The new rank').setRequired(true).addChoices(
            { name: 'Junior Operator', value: 'Junior Operator' }, { name: 'Operator', value: 'Operator' },
            { name: 'Senior Operator', value: 'Senior Operator' }, { name: 'Specialist', value: 'Specialist' },
            { name: 'Crew Supervisor', value: 'Crew Supervisor' }, { name: 'Field Supervisor', value: 'Field Supervisor' },
            { name: 'Management Team', value: 'Management Team' }, { name: 'Executive Board', value: 'Executive Board' }
        ))
        .addStringOption(opt => opt.setName('old_rank').setDescription('The previous rank').setRequired(true).addChoices(
            { name: 'Junior Operator', value: 'Junior Operator' }, { name: 'Operator', value: 'Operator' },
            { name: 'Senior Operator', value: 'Senior Operator' }, { name: 'Specialist', value: 'Specialist' },
            { name: 'Crew Supervisor', value: 'Crew Supervisor' }, { name: 'Field Supervisor', value: 'Field Supervisor' },
            { name: 'Management Team', value: 'Management Team' }, { name: 'Executive Board', value: 'Executive Board' }
        ))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for promotion').setRequired(true)),
    
    async execute(interaction, db) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.member.roles.cache.has(process.env.ROLE_MGMT) && !interaction.member.roles.cache.has(process.env.ROLE_EXEC)) {
            return interaction.editReply({ content: '❌ You do not have permission to request promotions.' });
        }

        const targetUser = interaction.options.getUser('user');
        const newRank = interaction.options.getString('new_rank');
        const oldRank = interaction.options.getString('old_rank');
        const reason = interaction.options.getString('reason');

        // Save request to DB to generate a unique ID
        const requestData = {
            targetId: targetUser.id,
            targetName: targetUser.username,
            requesterId: interaction.user.id,
            requesterName: interaction.user.username,
            newRank: newRank,
            oldRank: oldRank,
            reason: reason,
            status: 'Pending',
            createdAt: new Date()
        };

        const result = await db.collection('promotion_requests').insertOne(requestData);
        const requestId = result.insertedId.toString();

        // Build the request embed (Pic 2)
        const embed = new EmbedBuilder()
            .setColor('#18181b')
            .setTitle('Promotion Request')
            .addFields(
                { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: false },
                { name: 'User', value: `<@${targetUser.id}>`, inline: false },
                { name: 'New Rank', value: newRank, inline: false },
                { name: 'Old Rank', value: oldRank, inline: false },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp();

        // Buttons
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_promo_${requestId}`).setLabel('Promote').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`deny_promo_${requestId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        // Send to the Promotion Request Channel
        try {
            const requestChannel = await interaction.guild.channels.fetch('1525267491314602255');
            await requestChannel.send({ embeds: [embed], components: [row] });
            await interaction.editReply({ content: `✅ Promotion request submitted successfully for ${targetUser.username}.` });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '❌ Failed to send request to the promotion channel. Check bot permissions.' });
        }
    }
};