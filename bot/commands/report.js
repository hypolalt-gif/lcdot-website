const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Submit a report to the Office of Operator Standards')
        .addUserOption(opt => opt.setName('user').setDescription('The user you are reporting').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for report').setRequired(true))
        .addStringOption(opt => opt.setName('proof').setDescription('Links to screenshots/video').setRequired(true))
        .addStringOption(opt => opt.setName('witnesses').setDescription('Any witnesses?').setRequired(false)),
    
    async execute(interaction, db) {
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const proof = interaction.options.getString('proof');
        const witnesses = interaction.options.getString('witnesses') || 'N/A';
        const refCode = Math.random().toString(36).substring(2, 8);

        // 1. Create Thread
        const threadChannel = await interaction.guild.channels.fetch(process.env.OOS_CHANNEL_THREADS);
        const thread = await threadChannel.threads.create({
            name: `${refCode}-${target.username}`,
            autoArchiveDuration: 1440,
            type: ChannelType.PrivateThread,
            reason: `Report against ${target.username}`
        });

        // 2. Send to Report Log
        const reportEmbed = new EmbedBuilder()
            .setColor('#18181b')
            .setTitle('Report Submitted')
            .setDescription(`A report was submitted. Report ID: **${refCode}**\nReview report information below:`)
            .addFields(
                { name: 'Reporter', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'User', value: `<@${target.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Evidence', value: proof, inline: false },
                { name: 'Witnesses', value: witnesses, inline: false }
            )
            .setThumbnail('https://cdn.discordapp.com/attachments/1477138457821446216/1514637975374397571/LCDOT_OOS_1.png');

        const claimRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`report_claim_${refCode}_${target.id}`).setLabel('Claim Report').setStyle(ButtonStyle.Primary)
        );

        const logChannel = await interaction.guild.channels.fetch(process.env.OOS_CHANNEL_REPORTS);
        await logChannel.send({ embeds: [reportEmbed], components: [claimRow] });

        // 3. DM Target
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#f59e0b')
                .setTitle('Investigation Opened')
                .setDescription(`You are being contacted in regards to an open investigation. This is not a disciplinary measure, and is meant only to determine whether you have violated policy.`)
                .addFields({ name: 'Case ID', value: refCode })
                .setFooter({ text: 'Office of Operator Standards' });
            await target.send({ embeds: [dmEmbed] });
        } catch (e) { console.log("Could not DM target."); }

        await interaction.reply({ content: `✅ Report submitted securely. Case ID: **${refCode}**. An OOS agent will contact you if needed.`, ephemeral: true });
    }
};