require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const MongoStore = require('connect-mongo'); // Fixed import for connect-mongo
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { MongoClient, ObjectId } = require('mongodb');

// --- 1. INITIALIZATION & CONFIG ---
const app = express();
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let db; // Global database variable

// Discord Rank Mapping
const rankMap = {
    "Junior Operator": process.env.ROLE_JUNIOR, "Operator": process.env.ROLE_OPERATOR, "Senior Operator": process.env.ROLE_SENIOR,
    "Specialist": process.env.ROLE_SPECIALIST, "Crew Supervisor": process.env.ROLE_CREW, "Field Supervisor": process.env.ROLE_FIELD,
    "Management Team": process.env.ROLE_MGMT, "Executive Board": process.env.ROLE_EXEC
};
const roleToRankMap = Object.fromEntries(Object.entries(rankMap).map(([k, v]) => [v, k]));
const rankLevels = { "Junior Operator": 1, "Operator": 2, "Senior Operator": 3, "Specialist": 4, "Crew Supervisor": 5, "Field Supervisor": 6, "Management Team": 7, "Executive Board": 8 };

// --- 2. DISCORD BOT LOGIC ---
bot.login(process.env.BOT_TOKEN).catch(err => console.error("Discord Login Error:", err));

bot.once('clientReady', async () => {
    console.log(`✅ Bot logged in as ${bot.user.tag}`);
    const commands = [
        new SlashCommandBuilder().setName('clockin').setDescription('Start your DOT shift'),
        new SlashCommandBuilder().setName('clockout').setDescription('End your DOT shift'),
        new SlashCommandBuilder().setName('stats').setDescription('View your DOT stats'),
        new SlashCommandBuilder().setName('profile').setDescription('Link to your DOT Portal profile')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
        console.log('✅ Slash commands registered.');
    } catch (error) { console.error('Error registering commands:', error); }
});

// Auto-Sync Roles
bot.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!db) return;
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));
    if (addedRoles.size === 0 && removedRoles.size === 0) return;

    let newRank = null;
    let highestLevel = 0;
    newMember.roles.cache.forEach(role => {
        if (roleToRankMap[role.id]) {
            const rankName = roleToRankMap[role.id];
            if (rankLevels[rankName] > highestLevel) {
                highestLevel = rankLevels[rankName];
                newRank = rankName;
            }
        }
    });

    if (newRank) {
        const currentUser = await db.collection('users').findOne({ id: newMember.id });
        if (currentUser && currentUser.rank !== newRank) {
            await db.collection('users').updateOne({ id: newMember.id }, { $set: { rank: newRank, rank_level: highestLevel } });
            await db.collection('audit_logs').insertOne({ action: 'Auto Role Sync', actor_id: 'DISCORD', target_id: newMember.id, details: `Discord roles changed manually. New rank: ${newRank}`, created_at: new Date() });
        }
    }
});

// Slash Commands
bot.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() || !db) return;
    const { commandName, user } = interaction;
    const dbUser = await db.collection('users').findOne({ id: user.id });
    if (!dbUser) return interaction.reply({ content: "You must log into the website first to register your account.", ephemeral: true });

    if (commandName === 'clockin') {
        const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
        if (active) return interaction.reply({ content: "You are already clocked in!", ephemeral: true });
        try {
            const member = await interaction.guild.members.fetch(user.id);
            await member.roles.add(process.env.ROLE_ON_DUTY);
            await db.collection('shifts').insertOne({ user_id: user.id, start_time: new Date(), status: 'active' });
            interaction.reply({ embeds: [new EmbedBuilder().setTitle("Shift Started").setDescription(`Welcome to your shift, ${user.username}!`).setColor('#2ecc71')] });
        } catch (err) { interaction.reply({ content: "Error clocking in.", ephemeral: true }); }
    }
    
    if (commandName === 'clockout') {
        const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
        if (!active) return interaction.reply({ content: "You are not clocked in!", ephemeral: true });
        try {
            const member = await interaction.guild.members.fetch(user.id);
            await member.roles.remove(process.env.ROLE_ON_DUTY);
            const durationMins = Math.floor((new Date() - new Date(active.start_time)) / 60000);
            await db.collection('shifts').updateOne({ _id: active._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed' } });
            await db.collection('users').updateOne({ id: user.id }, { $inc: { total_minutes: durationMins } });
            interaction.reply({ embeds: [new EmbedBuilder().setTitle("Shift Ended").setDescription(`You worked for **${durationMins} minutes**.`).setColor('#e74c3c')] });
        } catch (err) { interaction.reply({ content: "Error clocking out.", ephemeral: true }); }
    }
    
    if (commandName === 'stats') {
        interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${user.username}'s Stats`).addFields(
            { name: 'Rank', value: dbUser.rank || 'Unranked', inline: true }, 
            { name: 'Total Hours', value: `${((dbUser.total_minutes || 0) / 60).toFixed(1)}`, inline: true }, 
            { name: 'Status', value: dbUser.status || 'Active', inline: true }
        ).setColor('#245A8D')] });
    }
    
    if (commandName === 'profile') {
        const baseUrl = process.env.REDIRECT_URI ? process.env.REDIRECT_URI.replace('/auth/discord/callback', '') : 'http://localhost:3000';
        interaction.reply({ content: `View your full service record here: ${baseUrl}/dashboard`, ephemeral: true });
    }
});

// Discord Logging Helper
async function sendLog(channelId, title, description, color = '#245A8D') {
    if (!channelId || channelId === 'undefined') return;
    try {
        const channel = await bot.channels.fetch(channelId);
        if (channel) await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp()] });
    } catch (err) { console.error('Logging Error:', err.message); }
}

function audit(action, actorId, targetId, details) {
    if (!db) return;
    db.collection('audit_logs').insertOne({ action, actor_id: actorId, target_id: targetId, details, created_at: new Date() }).catch(console.error);
}

// --- 3. EXPRESS & MIDDLEWARE SETUP ---
app.set('trust proxy', 1); // Trust Render's proxy
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 })); // Prevents DDoS but allows high traffic
app.use(express.static('public'));
app.use(express.json());

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

// --- 4. DATABASE CONNECTION & SERVER START ---
async function startServer() {
    try {
        // Connect to MongoDB FIRST
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('lcdot');
        console.log('✅ Connected to MongoDB Atlas');

        // Setup Sessions AFTER DB is connected
        app.use(session({ 
            secret: process.env.SESSION_SECRET || 'fallback_secret_please_change',
            resave: false, 
            saveUninitialized: false, 
            store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }), // Fixed syntax here
            cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 } 
        }));

        // --- 5. EXPRESS ROUTES ---
        
        app.post('/api/contact', async (req, res) => {
            const { name, email, message } = req.body;
            if (!name || !email || !message) return res.status(400).json({ error: 'All fields required.' });
            const embed = new EmbedBuilder().setTitle('📬 New Website Contact Message').addFields({ name: 'Name', value: name }, { name: 'Email', value: email }, { name: 'Message', value: message }).setColor('#D5A52A').setTimestamp();
            try {
                const channel = await bot.channels.fetch(process.env.CHANNEL_CONTACT);
                if (channel) await channel.send({ embeds: [embed] });
            } catch (err) { console.error(err); }
            res.json({ success: true });
        });

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
                else if (roles.includes(process.env.ROLE_PROBATIONARY)) { rank = "Probationary"; rankLevel = 0; }
                let graderType = null;
                if (roles.includes(process.env.GRADER_FTO)) graderType = 'FTO';
                else if (roles.includes(process.env.GRADER_HOD)) graderType = 'HOD';
                else if (roles.includes(process.env.GRADER_COD)) graderType = 'COD';
                else if (roles.includes(process.env.GRADER_CCD)) graderType = 'CCD';

                const avatarUrl = userResponse.data.avatar ? `https://cdn.discordapp.com/avatars/${userResponse.data.id}/${userResponse.data.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`;
                await db.collection('users').updateOne({ id: userResponse.data.id }, { $set: { username: userResponse.data.username, rank, rank_level: rankLevel, avatar_url: avatarUrl } }, { upsert: true });

                req.session.user = { id: userResponse.data.id, username: userResponse.data.username, rank, rankLevel, graderType };
                sendLog(process.env.CHANNEL_LOGIN, "Website Login", `**User:** ${rank} ${req.session.user.username}`, '#2ecc71');
                res.redirect('/dashboard');
            } catch (error) { res.redirect('/'); }
        });

        app.get('/dashboard', (req, res) => { if (!req.session.user) return res.redirect('/'); res.sendFile(path.join(__dirname, 'public', 'dashboard.html')); });
        app.get('/api/me', (req, res) => { if (!req.session.user) return res.status(401).json({ error: 'Not logged in' }); res.json(req.session.user); });
        app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

        app.get('/api/my-stats', async (req, res) => {
            const stats = await db.collection('users').findOne({ id: req.session.user.id });
            const active = await db.collection('shifts').findOne({ user_id: req.session.user.id, status: 'active' });
            res.json({ totalMinutes: stats ? stats.total_minutes : 0, activeShift: !!active, startTime: active ? active.start_time : null });
        });

        app.post('/api/shift', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const { action } = req.body;
            const userId = req.session.user.id;
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(userId);
                if (action === 'Start') {
                    const active = await db.collection('shifts').findOne({ user_id: userId, status: 'active' });
                    if (active) return res.status(400).json({ error: 'Already clocked in!' });
                    await member.roles.add(process.env.ROLE_ON_DUTY);
                    await db.collection('shifts').insertOne({ user_id: userId, start_time: new Date(), status: 'active' });
                    sendLog(process.env.CHANNEL_SHIFT, "Shift Started", `**User:** ${req.session.user.username}`, '#3498db');
                    res.json({ success: true });
                } else if (action === 'End') {
                    const active = await db.collection('shifts').findOne({ user_id: userId, status: 'active' });
                    if (!active) return res.status(400).json({ error: 'No active shift found!' });
                    await member.roles.remove(process.env.ROLE_ON_DUTY);
                    const durationMins = Math.floor((new Date() - new Date(active.start_time)) / 60000);
                    await db.collection('shifts').updateOne({ _id: active._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed' } });
                    await db.collection('users').updateOne({ id: userId }, { $inc: { total_minutes: durationMins } });
                    sendLog(process.env.CHANNEL_SHIFT, "Shift Ended", `**User:** ${req.session.user.username}\n**Time:** ${durationMins} mins`, '#e74c3c');
                    res.json({ success: true });
                }
            } catch (error) { res.status(500).json({ error: 'Failed to update role.' }); }
        });

        app.post('/api/certify', async (req, res) => {
            if (!req.session.user || !req.session.user.graderType) return res.status(403).json({ error: 'Access Denied.' });
            const { targetId, passed, notes } = req.body;
            const grader = req.session.user.graderType;
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(targetId);
                await db.collection('certifications').insertOne({ user_id: targetId, cert_type: grader, status: passed ? 'Passed' : 'Failed', grader_id: req.session.user.id, notes, graded_at: new Date() });
                if (passed) {
                    if (grader === 'HOD') { await member.roles.add(process.env.PASSED_HOD_1); await member.roles.add(process.env.PASSED_HOD_2); }
                    if (grader === 'COD') { await member.roles.add(process.env.PASSED_COD_1); await member.roles.add(process.env.PASSED_COD_2); }
                    if (grader === 'CCD') { await member.roles.add(process.env.PASSED_CCD_1); await member.roles.add(process.env.PASSED_CCD_2); }
                    member.send(`🎉 **Congratulations!** You have passed your **${grader}** certification in the Lakeview City DOT. The roles have been added to your account.`).catch(() => {});
                } else {
                    member.send(`❌ Your recent **${grader}** certification attempt was marked as **Failed**. Please contact your division lead for more information.`).catch(() => {});
                }
                sendLog(process.env.CHANNEL_AUDIT, `Cert: ${passed ? 'Passed' : 'Failed'}`, `**Grader:** ${req.session.user.username}\n**Student ID:** ${targetId}\n**Type:** ${grader}`, passed ? '#2ecc71' : '#e74c3c');
                audit(`Certification ${passed ? 'Passed' : 'Failed'} (${grader})`, req.session.user.id, targetId, notes);
                res.json({ success: true });
            } catch (error) { res.status(500).json({ error: 'Failed to grant roles.' }); }
        });

        app.get('/api/resources', async (req, res) => res.json(await db.collection('resources').find().sort({ uploaded_at: -1 }).toArray()));
        app.post('/api/upload-resource', upload.single('file'), async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only.' });
            if (!req.file) return res.status(400).json({ error: 'No file.' });
            await db.collection('resources').insertOne({ name: req.file.originalname, filename: req.file.filename, category: 'General', uploader_id: req.session.user.id, uploaded_at: new Date() });
            sendLog(process.env.CHANNEL_AUDIT, "Resource Uploaded", `**User:** ${req.session.user.username}\n**File:** ${req.file.originalname}`);
            res.json({ success: true });
        });

        app.get('/api/personnel', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 6) return res.status(403).json({ error: 'Supervisor+ Only' });
            res.json(await db.collection('users').find().sort({ rank_level: -1, username: 1 }).toArray());
        });

        app.get('/api/audit-logs', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            res.json(await db.collection('audit_logs').find().sort({ created_at: -1 }).limit(100).toArray());
        });

        app.post('/api/admin/action', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            const { targetId, action, value } = req.body;
            const target = await db.collection('users').findOne({ id: targetId });
            if (!target) return res.status(404).json({ error: 'User not found.' });
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(targetId);
                if (action === 'Promote' || action === 'Demote') {
                    const newRank = value;
                    const newRoleId = rankMap[newRank];
                    if (!newRoleId) return res.status(400).json({ error: 'Invalid rank.' });
                    const oldRoleId = rankMap[target.rank];
                    if (oldRoleId && member.roles.cache.has(oldRoleId)) await member.roles.remove(oldRoleId);
                    await member.roles.add(newRoleId);
                    await db.collection('users').updateOne({ id: targetId }, { $set: { rank: newRank, rank_level: rankLevels[newRank] } });
                    sendLog(process.env.CHANNEL_AUDIT, `Personnel: ${action}`, `**By:** ${req.session.user.username}\n**User:** ${target.username}\n**New Rank:** ${newRank}`, '#f39c12');
                    audit(action, req.session.user.id, targetId, `Changed rank to ${newRank}`);
                } else if (action === 'Suspend') {
                    await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'Suspended' } });
                    sendLog(process.env.CHANNEL_AUDIT, `Personnel: Suspended`, `**By:** ${req.session.user.username}\n**User:** ${target.username}`, '#e74c3c');
                    audit('Suspended', req.session.user.id, targetId, value || 'No reason provided');
                } else if (action === 'Reinstate') {
                    await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'Active' } });
                    sendLog(process.env.CHANNEL_AUDIT, `Personnel: Reinstated`, `**By:** ${req.session.user.username}\n**User:** ${target.username}`, '#2ecc71');
                    audit('Reinstated', req.session.user.id, targetId, 'Account restored');
                }
                res.json({ success: true });
            } catch (error) { res.status(500).json({ error: 'Discord Action Failed.' }); }
        });

        app.get('/api/stats', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const topHours = await db.collection('users').find().sort({ total_minutes: -1 }).limit(5).toArray();
            const allUsers = await db.collection('users').find().toArray();
            const totalDeptHours = allUsers.reduce((sum, u) => sum + (u.total_minutes || 0), 0);
            const activeCount = allUsers.filter(u => u.status === 'Active').length;
            const suspendedCount = allUsers.filter(u => u.status === 'Suspended').length;
            const certCount = await db.collection('certifications').countDocuments({ status: 'Passed' });
            res.json({ topHours, totalDeptHours, activeCount, suspendedCount, certCount });
        });

        app.get('/api/admin/notes/:userId', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 6) return res.status(403).json({ error: 'Supervisor+ Only' });
            res.json(await db.collection('disciplinary_notes').find({ user_id: req.params.userId }).sort({ created_at: -1 }).toArray());
        });

        app.post('/api/admin/notes', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 6) return res.status(403).json({ error: 'Supervisor+ Only' });
            await db.collection('disciplinary_notes').insertOne({ user_id: req.body.targetId, author_id: req.session.user.id, note: req.body.note, created_at: new Date() });
            await db.collection('audit_logs').insertOne({ action: 'Internal Note Added', actor_id: req.session.user.id, target_id: req.body.targetId, details: req.body.note, created_at: new Date() });
            res.json({ success: true });
        });

        app.post('/api/announcements', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            const { title, content } = req.body;
            await db.collection('announcements').insertOne({ title, content, author_id: req.session.user.id, created_at: new Date(), pinned: 0 });
            const embed = new EmbedBuilder().setTitle(`📢 ${title}`).setDescription(content).setColor('#D5A52A').setFooter({ text: `Posted by ${req.session.user.username}` }).setTimestamp();
            try {
                const channel = await bot.channels.fetch(process.env.CHANNEL_ANNOUNCE);
                if (channel) await channel.send({ embeds: [embed] });
            } catch (err) { console.error("Could not send to announce channel", err); }
            sendLog(process.env.CHANNEL_AUDIT, "New Announcement", `**By:** ${req.session.user.username}\n**Title:** ${title}`, '#D5A52A');
            res.json({ success: true });
        });

        app.get('/api/announcements', async (req, res) => res.json(await db.collection('announcements').find().sort({ pinned: -1, created_at: -1 }).toArray()));
        app.post('/api/announcements/pin', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            await db.collection('announcements').updateOne({ _id: new ObjectId(req.body.id) }, { $set: { pinned: req.body.pinned ? 1 : 0 } });
            res.json({ success: true });
        });

        app.get('/api/closures', async (req, res) => res.json(await db.collection('road_closures').find().sort({ created_at: -1 }).toArray()));
        app.post('/api/closures', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 5) return res.status(403).json({ error: 'Crew Supervisor+ Only' });
            await db.collection('road_closures').insertOne({ location: req.body.location, reason: req.body.reason, reported_by: req.session.user.id, status: 'Active', created_at: new Date() });
            sendLog(process.env.CHANNEL_AUDIT, "Road Closure Reported", `**By:** ${req.session.user.username}\n**Location:** ${req.body.location}\n**Reason:** ${req.body.reason}`, '#e74c3c');
            res.json({ success: true });
        });
        
        app.post('/api/closures/status', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 5) return res.status(403).json({ error: 'Access Denied' });
            await db.collection('road_closures').updateOne({ _id: new ObjectId(req.body.id) }, { $set: { status: req.body.status } });
            res.json({ success: true });
        });

        app.get('/api/workorders', async (req, res) => res.json(await db.collection('work_orders').find().sort({ created_at: -1 }).toArray()));
        app.post('/api/workorders', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 5) return res.status(403).json({ error: 'Crew Supervisor+ Only' });
            const { title, description, priority, assigned_to } = req.body;
            const refNum = `WO-${Math.floor(1000 + Math.random() * 9000)}`;
            await db.collection('work_orders').insertOne({ ref_num: refNum, title, description, priority, assigned_to, created_by: req.session.user.id, status: 'Open', created_at: new Date() });
            sendLog(process.env.CHANNEL_AUDIT, "Work Order Created", `**Ref:** ${refNum}\n**By:** ${req.session.user.username}\n**Title:** ${title}`, '#9b59b6');
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const channel = await guild.channels.create({ name: `wo-${refNum.toLowerCase()}`, type: 0, topic: `Work Order: ${title} | Assigned: ${assigned_to} | Priority: ${priority}` });
                const embed = new EmbedBuilder().setTitle(`Work Order: ${refNum}`).setDescription(description).addFields({ name: 'Priority', value: priority, inline: true }, { name: 'Assigned To', value: assigned_to, inline: true }, { name: 'Created By', value: req.session.user.username, inline: true }).setColor('#9b59b6');
                await channel.send({ embeds: [embed] });
                await channel.send(`<@${assigned_to}> please review this work order.`);
            } catch (err) { console.error("Failed to create channel:", err); }
            res.json({ success: true });
        });

        app.post('/api/workorders/status', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 5) return res.status(403).json({ error: 'Access Denied' });
            const wo = await db.collection('work_orders').findOne({ _id: new ObjectId(req.body.id) });
            await db.collection('work_orders').updateOne({ _id: new ObjectId(req.body.id) }, { $set: { status: req.body.status } });
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const channel = guild.channels.cache.find(c => c.name === `wo-${wo.ref_num.toLowerCase()}`);
                if (channel) { await channel.send(`Work Order marked as **${req.body.status}** by ${req.session.user.username}. Locking channel.`); await channel.permissionOverwrites.edit(guild.id, { SendMessages: false }); }
            } catch (err) { console.error(err); }
            res.json({ success: true });
        });

        app.get('/api/quizzes', async (req, res) => res.json(await db.collection('quizzes').find().toArray()));
        app.get('/api/quizzes/:id', async (req, res) => res.json(await db.collection('quiz_questions').find({ quiz_id: req.params.id }).toArray()));
        app.post('/api/quizzes', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            const { title, description, roleId, questions } = req.body;
            const quizResult = await db.collection('quizzes').insertOne({ title, description, role_to_grant: roleId, created_by: req.session.user.id });
            const quizId = quizResult.insertedId.toString();
            for (let q of questions) {
                await db.collection('quiz_questions').insertOne({ quiz_id: quizId, question: q.text, option_a: q.a, option_b: q.b, option_c: q.c, option_d: q.d, correct_option: q.correct });
            }
            res.json({ success: true });
        });
        app.post('/api/quizzes/submit', async (req, res) => {
            const { quizId, answers } = req.body;
            const questions = await db.collection('quiz_questions').find({ quiz_id: quizId }).toArray();
            let score = 0;
            questions.forEach(q => { const userAnswer = answers.find(a => a.id === q._id.toString()); if (userAnswer && userAnswer.selected === q.correct_option) score++; });
            const passed = score >= Math.ceil(questions.length * 0.8);
            const quiz = await db.collection('quizzes').findOne({ _id: new ObjectId(quizId) });
            await db.collection('quiz_attempts').insertOne({ user_id: req.session.user.id, quiz_id: quizId, score, passed, created_at: new Date() });
            if (passed && quiz.role_to_grant) {
                try {
                    const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                    const member = await guild.members.fetch(req.session.user.id);
                    await member.roles.add(quiz.role_to_grant);
                    member.send(`🎉 You passed the **${quiz.title}** quiz with a score of **${score}/${questions.length}**!`).catch(()=>{});
                    sendLog(process.env.CHANNEL_AUDIT, "Training Passed", `**User:** ${req.session.user.username}\n**Quiz:** ${quiz.title}\n**Score:** ${score}/${questions.length}`, '#2ecc71');
                } catch (err) { console.error(err); }
            }
            res.json({ passed, score, total: questions.length });
        });

        app.get('/api/profile', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const user = await db.collection('users').findOne({ id: req.session.user.id });
            const shifts = await db.collection('shifts').find({ user_id: req.session.user.id, status: 'completed' }).sort({ start_time: -1 }).limit(10).toArray();
            const certs = await db.collection('certifications').find({ user_id: req.session.user.id }).sort({ graded_at: -1 }).toArray();
            const quizzes = await db.collection('quiz_attempts').find({ user_id: req.session.user.id }).sort({ created_at: -1 }).toArray();
            res.json({ user, shifts, certs, quizzes });
        });

        app.get('/api/admin/active-shifts', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 6) return res.status(403).json({ error: 'Supervisor+ Only' });
            const activeShifts = await db.collection('shifts').find({ status: 'active' }).toArray();
            const populatedShifts = await Promise.all(activeShifts.map(async (shift) => {
                const user = await db.collection('users').findOne({ id: shift.user_id });
                return { ...shift, username: user ? user.username : 'Unknown', rank: user ? user.rank : 'Unknown' };
            }));
            res.json(populatedShifts);
        });

        app.post('/api/admin/force-clockout', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 6) return res.status(403).json({ error: 'Supervisor+ Only' });
            const { shiftId, userId, reason } = req.body;
            const activeShift = await db.collection('shifts').findOne({ _id: new ObjectId(shiftId), status: 'active' });
            if (!activeShift) return res.status(404).json({ error: 'Shift not found.' });
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(userId);
                if (member) await member.roles.remove(process.env.ROLE_ON_DUTY);
                const durationMins = Math.floor((new Date() - new Date(activeShift.start_time)) / 60000);
                await db.collection('shifts').updateOne({ _id: activeShift._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed', adjusted_by: req.session.user.id, adjusted_reason: reason } });
                await db.collection('users').updateOne({ id: userId }, { $inc: { total_minutes: durationMins } });
                sendLog(process.env.CHANNEL_AUDIT, "Force Clock-Out", `**Supervisor:** ${req.session.user.username}\n**User ID:** ${userId}\n**Reason:** ${reason}`, '#e74c3c');
                audit('Force Clock-Out', req.session.user.id, userId, reason);
                res.json({ success: true });
            } catch (err) { res.status(500).json({ error: 'Discord action failed.' }); }
        });

        app.get('/api/admin/export-shifts', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            const shifts = await db.collection('shifts').find().sort({ start_time: -1 }).toArray();
            let csv = 'Shift ID,User ID,Start Time,End Time,Duration (Mins),Status\n';
            shifts.forEach(s => { csv += `${s._id},${s.user_id},${s.start_time || ''},${s.end_time || ''},${s.duration_minutes || 0},${s.status}\n`; });
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="lcdot_shift_report.csv"');
            res.send(csv);
        });

        // --- 6. START LISTENING ---
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`✅ LCDOT Master Server running on port ${PORT}`);
        });

    } catch (error) {
        console.error('❌ Fatal Startup Error:', error);
        process.exit(1); // Forces Render to show an error if DB fails
    }
}

// Start the app
startServer();