const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
            await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commandsArray });
            console.log(`✅ ${commandsArray.length} Slash commands registered.`);
        } catch (error) { console.error(error); }
    });
}

bot.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const command = bot.commands.get(interaction.commandName);
            if (command) await command.execute(interaction, global.db);
        }

        if (interaction.isButton()) {
            const db = global.db;
            const customId = interaction.customId;

            // --- LOA HANDLING ---
            if (customId.startsWith('approve_loa_') || customId.startsWith('deny_loa_')) {
                await interaction.deferUpdate();
                const isApprove = customId.startsWith('approve_loa_');
                const requestId = customId.split('_')[2];

                const requestData = await db.collection('loa_requests').findOne({ _id: new ObjectId(requestId) });
                if (!requestData || requestData.status !== 'Pending') return;

                const newStatus = isApprove ? 'Approved' : 'Denied';
                await db.collection('loa_requests').updateOne({ _id: new ObjectId(requestId) }, { $set: { status: newStatus } });

                // Disable buttons
                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('d1').setLabel('Approve LOA').setStyle(ButtonStyle.Success).setDisabled(true),
                    new ButtonBuilder().setCustomId('d2').setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(true)
                );
                
                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(isApprove ? '#22c55e' : '#ef4444')
                    .setFooter({ text: `Processed by ${interaction.user.username}` });

                await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledRow] });

                const targetMember = await interaction.guild.members.fetch(requestData.user_id);

                if (isApprove) {
                    await targetMember.roles.add(process.env.ROLE_LOA).catch(console.error);
                    try {
                        await targetMember.send({ embeds: [
                            new EmbedBuilder().setColor('#22c55e').setTitle('LOA Approved').setDescription(`Your Leave of Absence request from **${requestData.startDate}** to **${requestData.endDate}** has been **Approved**. The LOA role has been applied to your account.`)
                        ]});
                    } catch (e) { console.log("Could not DM user."); }
                } else {
                    try {
                        await targetMember.send({ embeds: [
                            new EmbedBuilder().setColor('#ef4444').setTitle('LOA Denied').setDescription(`Your Leave of Absence request from **${requestData.startDate}** to **${requestData.endDate}** has been **Denied**. Please contact a supervisor for more information.`)
                        ]});
                    } catch (e) { console.log("Could not DM user."); }
                }
            }
        }
    } catch (error) {
        console.error("Interaction Error:", error);
    }
});

bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));
module.exports = bot;