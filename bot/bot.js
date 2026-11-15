const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

bot.once('clientReady', () => {
    console.log(`✅ Bot logged in as ${bot.user.tag}`);
});

bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));

module.exports = bot;