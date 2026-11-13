require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const { Client, GatewayIntentBits, REST, Routes, Collection } = require('discord.js');
const { MongoClient } = require('mongodb');

const app = express();
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let db; 

bot.commands = new Collection();

// --- 1. LOAD MODULAR COMMANDS ---
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
const commandsArray = [];

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    bot.commands.set(command.data.name, command);
    commandsArray.push(command.data.toJSON());
}

// --- 2. DISCORD BOT STARTUP ---
bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));

bot.once('clientReady', async () => {
    console.log(`✅ Bot logged in as ${bot.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commandsArray });
        console.log(`✅ ${commandsArray.length} Modular Slash commands registered.`);
    } catch (error) { console.error('Error registering commands:', error); }
});

// --- 3. INTERACTION HANDLER ---
bot.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = bot.commands.get(interaction.commandName);
    if (!command) return;

    try {
        // Execute the command module, passing the interaction and the database connection
        await command.execute(interaction, db);
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
    }
});

// --- 4. WEBSITE & DATABASE SETUP ---
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static('public'));
app.use(express.json());

async function startServer() {
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('lcdot');
        console.log('✅ Connected to MongoDB Atlas');

        app.use(session({ 
            secret: process.env.SESSION_SECRET || 'fallback_secret',
            resave: false, saveUninitialized: false, 
            store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
            cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 } 
        }));

        // Discord OAuth Login
        app.get('/auth/discord', (req, res) => {
            const scope = 'identify guilds.members.read';
            const redirectUri = encodeURIComponent(process.env.REDIRECT_URI || 'http://localhost:3000/auth/discord/callback');
            res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`);
        });

        // Discord OAuth Callback
        app.get('/auth/discord/callback', async (req, res) => {
            const code = req.query.code;
            if (!code) return res.redirect('/');
            const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3000/auth/discord/callback';
            try {
                const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                const accessToken = tokenResponse.data.access_token;
                const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
                
                // Fetch roles to determine rank
                let roles = [];
                try {
                    const memberResponse = await axios.get(`https://discord.com/api/users/@me/guilds/${process.env.GUILD_ID}/member`, { headers: { Authorization: `Bearer ${accessToken}` } });
                    roles = memberResponse.data.roles;
                } catch (error) { return res.send("You must be in the Lakeview City DOT Discord server."); }

                // Determine Rank (Expand this mapping later)
                let rank = "Probationary", rankLevel = 0;
                if (roles.includes(process.env.ROLE_EXEC)) { rank = "Executive Board"; rankLevel = 8; }
                else if (roles.includes(process.env.ROLE_MGMT)) { rank = "Management Team"; rankLevel = 7; }
                else if (roles.includes(process.env.ROLE_FIELD)) { rank = "Field Supervisor"; rankLevel = 6; }
                else if (roles.includes(process.env.ROLE_CREW)) { rank = "Crew Supervisor"; rankLevel = 5; }

                const avatarUrl = userResponse.data.avatar ? `https://cdn.discordapp.com/avatars/${userResponse.data.id}/${userResponse.data.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`;
                
                // Upsert User into DB
                await db.collection('users').updateOne(
                    { id: userResponse.data.id }, 
                    { 
                        $set: { username: userResponse.data.username, rank, rank_level: rankLevel, avatar_url: avatarUrl, status: 'Active' }, 
                        $setOnInsert: { total_minutes: 0, weekly_minutes: 0, created_at: new Date() } 
                    }, 
                    { upsert: true }
                );
                
                req.session.user = { id: userResponse.data.id, username: userResponse.data.username, rank, rankLevel, avatar_url: avatarUrl };
                res.redirect('/dashboard');
            } catch (error) { res.redirect('/'); }
        });

        app.get('/dashboard', (req, res) => { if (!req.session.user) return res.redirect('/'); res.sendFile(path.join(__dirname, 'public', 'dashboard.html')); });
        app.get('/api/me', (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Not logged in' }); res.json(req.session.user); });
        app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ LCDOT Master Server running on port ${PORT}`));
    } catch (error) { console.error(error); process.exit(1); }
}
startServer();