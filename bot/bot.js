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
            const userId = interaction.user.id;

            // --- SHIFT BUTTONS ---
            if (customId.startsWith('shift_')) {
                await interaction.deferUpdate();
                const action = customId.split('_')[1];
                const shiftType = customId.split('_')[2] || null;

                let activeShift = await db.collection('active_shifts').findOne({ userId });

                if (action === 'start') {
                    if (activeShift) return;
                    await db.collection('active_shifts').insertOne({
                        userId, username: interaction.user.username, type: shiftType, startTime: new Date(), pausedTime: null, totalPausedMs: 0, status: 'Active'
                    });
                    await interaction.guild.members.fetch(userId).then(m => m.roles.add(process.env.ROLE_ON_DUTY)).catch(console.error);
                } 
                
                if (action === 'pause' && activeShift) {
                    if (activeShift.status === 'Paused') {
                        // Resume
                        const pausedDuration = new Date() - new Date(activeShift.pausedTime);
                        await db.collection('active_shifts').updateOne({ _id: activeShift._id }, { $set: { status: 'Active', pausedTime: null }, $inc: { totalPausedMs: pausedDuration } });
                    } else {
                        // Pause
                        await db.collection('active_shifts').updateOne({ _id: activeShift._id }, { $set: { status: 'Paused', pausedTime: new Date() } });
                    }
                } 
                
                if (action === 'end' && activeShift) {
                    const endTime = new Date();
                    const totalMs = endTime - new Date(activeShift.startTime) - (activeShift.totalPausedMs || 0);
                    
                    await db.collection('completed_shifts').insertOne({
                        userId, username: interaction.user.username, type: activeShift.type, startTime: activeShift.startTime, endTime, durationMs: totalMs, status: 'Completed'
                    });
                    await db.collection('active_shifts').deleteOne({ _id: activeShift._id });
                    await interaction.guild.members.fetch(userId).then(m => m.roles.remove(process.env.ROLE_ON_DUTY)).catch(console.error);
                }

                // Update UI
                activeShift = await db.collection('active_shifts').findOne({ userId });
                const isRunning = !!activeShift;
                const isPaused = activeShift && activeShift.status === 'Paused';

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`shift_start_${shiftType || 'Regular'}`).setLabel('Start').setStyle(ButtonStyle.Success).setEmoji('⏱️').setDisabled(isRunning),
                    new ButtonBuilder().setCustomId(`shift_pause`).setLabel('Resume').setStyle(ButtonStyle.Primary).setEmoji('▶️').setDisabled(!isRunning || !isPaused),
                    new ButtonBuilder().setCustomId(`shift_pause`).setLabel('Pause').setStyle(ButtonStyle.Primary).setEmoji('⏸️').setDisabled(!isRunning || isPaused),
                    new ButtonBuilder().setCustomId(`shift_end`).setLabel('End').setStyle(ButtonStyle.Danger).setEmoji('⏹️').setDisabled(!isRunning)
                );

                // Remove the duplicate pause button depending on state
                if (isPaused) row.components.splice(2, 1);
                else row.components.splice(1, 1);

                await interaction.editReply({ components: [row] });
            }
        }
    } catch (error) { console.error("Interaction Error:", error); }
});

bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));
module.exports = bot;