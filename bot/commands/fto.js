const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fto')
        .setDescription('FTO Commands')
        .addSubcommand(sub => sub.setName('complete').setDescription('Complete a training session').addUserOption(opt => opt.setName('trainee').setDescription('The trainee').setRequired(true))),
    
    async execute(interaction, db) {
        if (interaction.options.getSubcommand() === 'complete') {
            if (!interaction.member.roles.cache.has(process.env.FTO_ROLE_CERT)) {
                return interaction.reply({ content: '❌ You are not an FTO.', ephemeral: true });
            }

            const trainee = interaction.options.getUser('trainee');
            try {
                const member = await interaction.guild.members.fetch(trainee.id);
                await member.roles.add(process.env.FTO_ROLE_CERT_2);

                const embed = new EmbedBuilder()
                    .setColor('#22c55e')
                    .setTitle('FTO Session Completed')
                    .setDescription(`<@${trainee.id}> has successfully passed their FTO training with <@${interaction.user.id}>.`)
                    .setTimestamp();

                const logChannel = await interaction.guild.channels.fetch(process.env.FTO_CHANNEL_LOGS);
                await logChannel.send({ embeds: [embed] });
                
                await interaction.reply({ content: `✅ FTO session logged for ${trainee.username}.`, ephemeral: true });
            } catch (e) { interaction.reply({ content: 'Failed to update roles.', ephemeral: true }); }
        }
    }
};