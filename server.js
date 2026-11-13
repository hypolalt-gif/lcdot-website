require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let db; 

const COLOR_GOLD = '#D4AF37';
const COLOR_NAVY = '#0A192F';
const LOGO_URL = 'https://cdn.discordapp.com/attachments/1533196538048942110/1570179443874336818/lkdot.png';

const rankMap = {
    "Junior Operator": process.env.ROLE_JUNIOR, "Operator": process.env.ROLE_OPERATOR, "Senior Operator": process.env.ROLE_SENIOR,
    "Specialist": process.env.ROLE_SPECIALIST, "Crew Supervisor": process.env.ROLE_CREW, "Field Supervisor": process.env.ROLE_FIELD,
    "Management Team": process.env.ROLE_MGMT, "Executive Board": process.env.ROLE_EXEC
};
const roleToRankMap = Object.fromEntries(Object.entries(rankMap).map(([k, v]) => [v, k]));
const rankLevels = { "Junior Operator": 1, "Operator": 2, "Senior Operator": 3, "Specialist": 4, "Crew Supervisor": 5, "Field Supervisor": 6, "Management Team": 7, "Executive Board": 8 };

const clockInMap = {
    'Ranked Board': '1478142484310786158', 'Supervisory Board': '1482181891762159779',
    'HOD': '1515405631736254694', 'COD': '1533620521881567262', 'CCD': '1559485323870998598', 'FTO': '1512374542213972093'
};

// --- 1. DISCORD BOT SETUP ---
bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));

bot.once('clientReady', async () => {
    console.log(`✅ Bot logged in as ${bot.user.tag}`);
    const commands = require('./commands.js');
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
        console.log(`✅ ${commands.length} Slash commands registered.`);
    } catch (error) { console.error('Error registering commands:', error); }
});

bot.on('interactionCreate', async interaction => {
    // Handle Buttons
    if (interaction.isButton()) {
        const { customId, user, guild } = interaction;
        const member = await guild.members.fetch(user.id);

        if (customId === 'btn_clockin') {
            const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
            if (active) return interaction.reply({ content: "❌ You are already clocked in!", ephemeral: true });
            await member.roles.add(process.env.ROLE_ON_DUTY);
            await db.collection('shifts').insertOne({ user_id: user.id, shift_type: 'Discord Panel', start_time: new Date(), status: 'active' });
            interaction.reply({ content: "✅ You have successfully **Clocked In**.", ephemeral: true });
        }

        if (customId === 'btn_clockout') {
            const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
            if (!active) return interaction.reply({ content: "❌ You are not clocked in!", ephemeral: true });
            await member.roles.remove(process.env.ROLE_ON_DUTY);
            const durationMins = Math.floor((new Date() - new Date(active.start_time)) / 60000);
            await db.collection('shifts').updateOne({ _id: active._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed' } });
            await db.collection('users').updateOne({ id: user.id }, { $inc: { total_minutes: durationMins, weekly_minutes: durationMins } }, { upsert: true });
            interaction.reply({ content: `✅ You have **Clocked Out**. Worked: **${durationMins} mins**.`, ephemeral: true });
        }
        
        if (customId === 'btn_div_apps') {
            // Placeholder for viewing division apps
            interaction.reply({ content: "This will open the division application menu on the website.", ephemeral: true });
        }

        if (customId.startsWith('approve_loa_')) {
            const targetId = customId.split('_')[2];
            const targetMember = await guild.members.fetch(targetId);
            await targetMember.roles.add(process.env.ROLE_LOA);
            await targetMember.setNickname(`LOA (${targetMember.user.username})`);
            await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'LOA' } });
            try { await (await bot.users.fetch(targetId)).send({ embeds: [new EmbedBuilder().setTitle("✅ LOA Approved").setColor('#16A34A')] }); } catch (e) {}
            await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#16A34A').setFooter({ text: `Approved by ${user.username}` })], components: [] });
        }
        
        if (customId.startsWith('deny_loa_')) {
            const targetId = customId.split('_')[2];
            try { await (await bot.users.fetch(targetId)).send({ embeds: [new EmbedBuilder().setTitle("❌ LOA Denied").setColor('#DC2626')] }); } catch (e) {}
            await interaction.update({ embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor('#DC2626').setFooter({ text: `Denied by ${user.username}` })], components: [] });
        }
        return;
    }

    if (!interaction.isChatInputCommand() || !db) return;
    const { commandName, user } = interaction;
    const member = await interaction.guild.members.fetch(user.id);

    if (commandName === 'setup-panels') {
        if (!member.roles.cache.has(process.env.ROLE_EXEC) && !member.roles.cache.has(process.env.ROLE_MGMT)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });

        const shiftEmbed = new EmbedBuilder().setTitle("⏱️ Shift Management").setDescription("Use the buttons below to clock in and out.").setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
        const shiftRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_clockin').setLabel('Clock In').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_clockout').setLabel('Clock Out').setStyle(ButtonStyle.Danger)
        );
        await interaction.channel.send({ embeds: [shiftEmbed], components: [shiftRow] });

        interaction.reply({ content: "✅ Panels deployed.", ephemeral: true });
    }

    if (commandName === 'division-dashboard') {
        if (!member.roles.cache.has(process.env.ROLE_EXEC) && !member.roles.cache.has(process.env.ROLE_MGMT)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        const div = interaction.options.getString('division');
        
        const embed = new EmbedBuilder()
            .setTitle(`${div} Division Dashboard`)
            .setDescription(`Welcome to the ${div} command center. Use the buttons below to manage your division.`)
            .setColor(COLOR_GOLD)
            .setThumbnail(LOGO_URL);
            
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_div_apps').setLabel('Pending Applications').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('btn_div_logs').setLabel('Division Logs').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('btn_div_roster').setLabel('Division Roster').setStyle(ButtonStyle.Secondary)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        interaction.reply({ content: `✅ ${div} dashboard deployed.`, ephemeral: true });
    }

    if (commandName === 'loa-request') {
        const reason = interaction.options.getString('reason');
        const embed = new EmbedBuilder().setTitle("📝 LOA Request").setDescription(`**User:** ${user.tag}\n**Reason:** ${reason}`).setColor(COLOR_GOLD).setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_loa_${user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`deny_loa_${user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
        try {
            const channel = await bot.channels.fetch(process.env.CHANNEL_LOA);
            await channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: "✅ LOA request sent.", ephemeral: true });
        } catch (err) { interaction.reply({ content: "Error sending LOA.", ephemeral: true }); }
    }

    // Keep your other commands (clockin, clockout, profile, etc) here...
    // (I am omitting them for brevity, they are the same as before)
});

// --- 2. EXPRESS & DB SETUP ---
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 }));
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
            cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30, rolling: true } 
        }));

        // Auth routes
        app.get('/auth/discord', (req, res) => {
            const scope = 'identify guilds.members.read';
            const redirectUri = encodeURIComponent(process.env.REDIRECT_URI || 'http://localhost:3000/auth/discord/callback');
            res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`);
        });

        app.get('/auth/discord/callback', async (req, res) => {
            const code = req.query.code;
            if (!code) return res.redirect('/');
            const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3000/auth/discord/callback';
            try {
                const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                const accessToken = tokenResponse.data.access_token;
                const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
                let roles = [];
                try {
                    const memberResponse = await axios.get(`https://discord.com/api/users/@me/guilds/${process.env.GUILD_ID}/member`, { headers: { Authorization: `Bearer ${accessToken}` } });
                    roles = memberResponse.data.roles;
                } catch (error) { return res.send("You must be in the Lakeview City DOT Discord server."); }

                let rank = "Unranked", rankLevel = 0;
                if (roles.includes(process.env.ROLE_EXEC)) { rank = "Executive Board"; rankLevel = 8; }
                else if (roles.includes(process.env.ROLE_MGMT)) { rank = "Management Team"; rankLevel = 7; }
                else if (roles.includes(process.env.ROLE_FIELD)) { rank = "Field Supervisor"; rankLevel = 6; }
                else if (roles.includes(process.env.ROLE_CREW)) { rank = "Crew Supervisor"; rankLevel = 5; }
                else if (roles.includes(process.env.ROLE_SPECIALIST)) { rank = "Specialist"; rankLevel = 4; }
                else if (roles.includes(process.env.ROLE_SENIOR)) { rank = "Senior Operator"; rankLevel = 3; }
                else if (roles.includes(process.env.ROLE_OPERATOR)) { rank = "Operator"; rankLevel = 2; }
                else if (roles.includes(process.env.ROLE_JUNIOR)) { rank = "Junior Operator"; rankLevel = 1; }

                const avatarUrl = userResponse.data.avatar ? `https://cdn.discordapp.com/avatars/${userResponse.data.id}/${userResponse.data.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`;
                await db.collection('users').updateOne({ id: userResponse.data.id }, { $set: { username: userResponse.data.username, rank, rank_level: rankLevel, avatar_url: avatarUrl, status: 'Active' }, $setOnInsert: { total_minutes: 0, weekly_minutes: 0 } }, { upsert: true });
                req.session.user = { id: userResponse.data.id, username: userResponse.data.username, rank, rankLevel, avatar_url: avatarUrl };
                res.redirect('/dashboard');
            } catch (error) { res.redirect('/'); }
        });

        app.get('/dashboard', (req, res) => { if (!req.session.user) return res.redirect('/'); res.sendFile(path.join(__dirname, 'public', 'dashboard.html')); });
        app.get('/api/me', (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Not logged in' }); res.json(req.session.user); });
        app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

        // Remove all Fleet APIs here (deleted completely)

        app.get('/api/my-stats', async (req, res) => {
            const stats = await db.collection('users').findOne({ id: req.session.user.id });
            const active = await db.collection('shifts').findOne({ user_id: req.session.user.id, status: 'active' });
            res.json({ totalMinutes: stats ? stats.total_minutes : 0, activeShift: !!active, startTime: active ? active.start_time : null });
        });

        app.get('/api/profile', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const user = await db.collection('users').findOne({ id: req.session.user.id });
            const certs = await db.collection('certifications').find({ user_id: req.session.user.id }).sort({ graded_at: -1 }).toArray();
            res.json({ user, certs });
        });

        // Keep LOA and Activity Log APIs here...
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ LCDOT Master Server running on port ${PORT}`));
    } catch (error) { process.exit(1); }
}
startServer();