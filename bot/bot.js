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
            if (process.env.GUILD_ID_OOS) {
                await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID_OOS), { body: commandsArray });
            }
            console.log(`✅ ${commandsArray.length} Slash commands registered.`);
        } catch (error) { console.error(error); }
    });
}

bot.on('interactionCreate', async interaction => {
    try {
        const db = global.db;

        // --- SLASH COMMANDS ---
        if (interaction.isChatInputCommand()) {
            const command = bot.commands.get(interaction.commandName);
            if (command) await command.execute(interaction, db);
        }

        // --- MODALS ---
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'app_submit_modal') {
                const robloxUser = interaction.fields.getTextInputValue('roblox_user');
                const experience = interaction.fields.getTextInputValue('experience');
                const whyJoin = interaction.fields.getTextInputValue('why_join');
                const appId = Math.random().toString(36).substring(2, 8).toUpperCase();

                await db.collection('applications').insertOne({
                    appId, userId: interaction.user.id, robloxUser, experience, whyJoin,
                    status: 'Pending', submittedAt: new Date()
                });

                await interaction.reply({ content: `✅ Application submitted successfully! Your App ID is **${appId}**. Management will review it shortly.`, ephemeral: true });
            }
        }

        // --- BUTTONS ---
        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (customId.startsWith('app_approve_') || customId.startsWith('app_deny_')) {
                const isApprove = customId.startsWith('app_approve_');
                const appId = customId.split('_')[2];
                
                const app = await db.collection('applications').findOne({ appId });
                if (!app || app.status !== 'Pending') return interaction.reply({ content: 'Application already processed.', ephemeral: true });

                const newStatus = isApprove ? 'Approved' : 'Denied';
                await db.collection('applications').updateOne({ appId }, { $set: { status: newStatus } });

                const disabledRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('d1').setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(true),
                    new ButtonBuilder().setCustomId('d2').setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(true)
                );

                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(isApprove ? '#22c55e' : '#ef4444')
                    .setFooter({ text: `Processed by ${interaction.user.username}` });

                await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });

                // Notify User
                try {
                    const user = await bot.users.fetch(app.userId);
                    await user.send(`Your DOT application (**${appId}**) has been **${newStatus}**.`);
                } catch (e) {}
            }

            // Dashboard Buttons
            if (customId === 'dash_apps') {
                await interaction.reply({ content: 'Use `/application review` to view the next pending application.', ephemeral: true });
            }
            if (customId === 'dash_dockets') {
                await interaction.reply({ content: 'Use `/docket` to view the department rules.', ephemeral: true });
            }
        }
    } catch (error) {
        console.error("Interaction Error:", error);
    }
});

bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));
module.exports = bot;