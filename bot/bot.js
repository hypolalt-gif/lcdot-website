const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
bot.commands = new Collection();

// Load Commands
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

// Handle Commands Safely
bot.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = bot.commands.get(interaction.commandName);
    if (!command) return;

    try {
        // Pass global.db set in server.js
        await command.execute(interaction, global.db);
    } catch (error) {
        console.error(`Error in /${interaction.commandName}:`, error);
        const errorMsg = { content: 'There was an error executing this command.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMsg);
        } else {
            await interaction.reply(errorMsg);
        }
    }
});

bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));

module.exports = bot;