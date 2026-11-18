const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
require('dotenv').config();

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
bot.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    const commandsArray = [];

    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        bot.commands.set(command.data.name, command);
        commandsArray.push(command.data.toJSON());
    }

    bot.once('clientReady', async () => {
        console.log(`✅ Bot logged in as ${bot.user.tag}`);
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        try {
            // Register in Main DOT Server
            await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commandsArray });
            // Register in OOS Server
            await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID_OOS), { body: commandsArray });
            console.log(`✅ Slash commands registered in both servers.`);
        } catch (error) { console.error(error); }
    });
}

bot.on('interactionCreate', async interaction => {
    try {
        // --- SLASH COMMANDS ---
        if (interaction.isChatInputCommand()) {
            const command = bot.commands.get(interaction.commandName);
            if (command) await command.execute(interaction, global.db);
            return;
        }

        // --- MODALS (Forms) ---
        if (interaction.isModalSubmit()) {
            const customId = interaction.customId;
            const db = global.db;

            if (customId.startsWith('oos_punish_modal_')) {
                const parts = customId.split('_');
                const action = parts[3];
                const targetId = parts[4];
                const refCode = parts[5];
                
                const reason = interaction.fields.getTextInputValue('reason');
                const proof = interaction.fields.getTextInputValue('proof');
                let extra = null;
                try { extra = interaction.fields.getTextInputValue('extra'); } catch(e){}

                const embed = new EmbedBuilder()
                    .setColor('#f59e0b')
                    .setTitle('Office of Operator Standards Discipline')
                    .setDescription(`The Office of Operator Standards is reviewing a **${action}** for department related misconduct.`)
                    .setThumbnail('https://cdn.discordapp.com/attachments/1477138457821446216/1514637975374397571/LCDOT_OOS_1.png')
                    .addFields(
                        { name: 'User', value: `<@${targetId}>`, inline: true },
                        { name: 'Punishment', value: action, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Proof', value: proof, inline: false },
                        { name: 'Reference Code', value: refCode, inline: true }
                    )
                    .setFooter({ text: 'Pending Approval' })
                    .setTimestamp();

                if (extra) embed.addFields({ name: 'Extra Info', value: extra });

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`oos_approve_${action}_${targetId}_${refCode}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`oos_deny_${refCode}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
                );

                // Send to Approval Channel
                const approvalChannel = await interaction.guild.channels.fetch(process.env.OOS_CHANNEL_APPROVALS);
                await approvalChannel.send({ content: '<@&' + process.env.OOS_ROLE_LEAD + '>', embeds: [embed], components: [row] });
                
                await interaction.reply({ content: '✅ Punishment submitted for approval.', ephemeral: true });
            }
        }

        // --- BUTTONS ---
        if (interaction.isButton()) {
            const db = global.db;
            const customId = interaction.customId;

            // OOS Panel Main Buttons
            if (customId.startsWith('oos_btn_')) {
                const parts = customId.split('_');
                const action = parts[2];
                const targetId = parts[3];
                const refCode = parts[4];

                const modal = new ModalBuilder()
                    .setCustomId(`oos_punish_modal_${action}_${targetId}_${refCode}`)
                    .setTitle(`Issue ${action}`);

                const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Short).setRequired(true);
                const proofInput = new TextInputBuilder().setCustomId('proof').setLabel('Proof (Links/Screenshots)').setStyle(TextInputStyle.Short).setRequired(true);
                
                const actionRow1 = new ActionRowBuilder().addComponents(reasonInput);
                const actionRow2 = new ActionRowBuilder().addComponents(proofInput);
                modal.addComponents(actionRow1, actionRow2);

                if (['Suspension', 'Demotion', 'Divisional'].includes(action)) {
                    const extraInput = new TextInputBuilder().setCustomId('extra').setLabel(action === 'Suspension' ? 'Days' : action === 'Demotion' ? 'New Rank' : 'Division & Type').setStyle(TextInputStyle.Short).setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(extraInput));
                }

                await interaction.showModal(modal);
            }

            // OOS Approval Buttons
            if (customId.startsWith('oos_approve_')) {
                await interaction.deferUpdate();
                const parts = customId.split('_');
                const action = parts[2];
                const targetId = parts[3];
                const refCode = parts[4];

                // Logic to apply punishment to user
                try {
                    const member = await interaction.guild.members.fetch(targetId);
                    if (action === 'Verbal Warning' || action === 'Written Warning' || action === 'Final Warning') {
                        // Just DM and log
                        await member.send(`You have received a **${action}** from OOS. Ref: ${refCode}`).catch(()=>{});
                    } else if (action === 'Termination') {
                        await member.roles.set([]); // Remove all roles
                        await member.send(`You have been **Terminated** by OOS. Ref: ${refCode}`).catch(()=>{});
                    } else if (action === 'Suspension') {
                        await member.roles.add(process.env.ROLE_SUSPENDED);
                        await member.send(`You have been **Suspended** by OOS. Ref: ${refCode}`).catch(()=>{});
                    }
                } catch(e) { console.error("Could not apply punishment to user:", e); }

                const logEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#ef4444')
                    .setFooter({ text: `Approved by ${interaction.user.username}` });
                
                await interaction.editReply({ embeds: [logEmbed], components: [] });
                
                // Send to public punishment channel
                const publicChannel = await interaction.guild.channels.fetch(process.env.OOS_CHANNEL_PUNISHMENTS);
                await publicChannel.send({ embeds: [logEmbed] });
            }

            if (customId.startsWith('oos_deny_')) {
                await interaction.deferUpdate();
                const logEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#27272a')
                    .setFooter({ text: `Denied by ${interaction.user.username}` });
                await interaction.editReply({ embeds: [logEmbed], components: [] });
            }
        }
    } catch (error) {
        console.error("Interaction Error:", error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred processing this.', ephemeral: true });
        }
    }
});

bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));
module.exports = bot;