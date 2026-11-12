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

const COLOR_GOLD = '#D97706';
const COLOR_NAVY = '#0F172A';
const LOGO_URL = process.env.DOT_LOGO_URL || 'https://i.imgur.com/yourlogo.png';

const rankMap = {
    "Junior Operator": process.env.ROLE_JUNIOR, "Operator": process.env.ROLE_OPERATOR, "Senior Operator": process.env.ROLE_SENIOR,
    "Specialist": process.env.ROLE_SPECIALIST, "Crew Supervisor": process.env.ROLE_CREW, "Field Supervisor": process.env.ROLE_FIELD,
    "Management Team": process.env.ROLE_MGMT, "Executive Board": process.env.ROLE_EXEC
};
const roleToRankMap = Object.fromEntries(Object.entries(rankMap).map(([k, v]) => [v, k]));
const rankLevels = { "Junior Operator": 1, "Operator": 2, "Senior Operator": 3, "Specialist": 4, "Crew Supervisor": 5, "Field Supervisor": 6, "Management Team": 7, "Executive Board": 8 };

const clockInMap = {
    'Ranked Board': '1478142484310786158',
    'Supervisory Board': '1482181891762159779',
    'HOD': '1515405631736254694',
    'COD': '1533620521881567262',
    'CCD': '1559485323870998598',
    'FTO': '1512374542213972093'
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

bot.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!db) return;
    if (oldMember.roles.cache.size === newMember.roles.cache.size) return;
    
    let newRank = null, highestLevel = 0;
    newMember.roles.cache.forEach(role => {
        if (roleToRankMap[role.id]) {
            const rankName = roleToRankMap[role.id];
            if (rankLevels[rankName] > highestLevel) { highestLevel = rankLevels[rankName]; newRank = rankName; }
        }
    });

    if (newRank) {
        const currentUser = await db.collection('users').findOne({ id: newMember.id });
        if (currentUser && currentUser.rank !== newRank) {
            await db.collection('users').updateOne({ id: newMember.id }, { $set: { rank: newRank, rank_level: highestLevel } });
        }
    }
});

bot.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('approve_loa_')) {
            const targetId = interaction.customId.split('_')[2];
            try {
                const member = await interaction.guild.members.fetch(targetId);
                await member.roles.add(process.env.ROLE_LOA);
                await member.setNickname(`LOA (${member.user.username})`);
                await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'LOA' } });
                
                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor('#16A34A').setFooter({ text: `Approved by ${interaction.user.username}` });
                await interaction.update({ embeds: [updatedEmbed], components: [] });
            } catch (err) { interaction.reply({ content: 'Error approving LOA. Check role hierarchy.', ephemeral: true }); }
        }
        if (interaction.customId.startsWith('deny_loa_')) {
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor('#DC2626').setFooter({ text: `Denied by ${interaction.user.username}` });
            await interaction.update({ embeds: [updatedEmbed], components: [] });
        }
        return;
    }

    if (!interaction.isChatInputCommand() || !db) return;
    const { commandName, user } = interaction;
    const member = await interaction.guild.members.fetch(user.id);

    if (commandName === 'loa-request') {
        const reason = interaction.options.getString('reason');
        const embed = new EmbedBuilder()
            .setTitle("📝 Leave of Absence Request")
            .setDescription(`**User:** ${user.tag} (${user.id})\n**Reason:** ${reason}`)
            .setColor(COLOR_GOLD).setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_loa_${user.id}`).setLabel('Approve LOA').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`deny_loa_${user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        try {
            const channel = await bot.channels.fetch(process.env.CHANNEL_LOA);
            if (!channel) throw new Error("Channel not found");
            await channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: "✅ Your LOA request has been sent to Management.", ephemeral: true });
        } catch (err) { 
            console.error("LOA Error:", err); // This will print the exact error in Render logs
            interaction.reply({ content: "Error sending LOA request. Check Render logs.", ephemeral: true }); 
        }
    }

    if (commandName === 'clockin') {
        const type = interaction.options.getString('type');
        const requiredRole = clockInMap[type];
        if (!member.roles.cache.has(requiredRole)) return interaction.reply({ content: `❌ You do not have the required role for **${type}**.`, ephemeral: true });

        const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
        if (active) return interaction.reply({ content: "You are already clocked in!", ephemeral: true });

        try {
            await member.roles.add(process.env.ROLE_ON_DUTY);
            await db.collection('shifts').insertOne({ user_id: user.id, shift_type: type, start_time: new Date(), status: 'active' });
            interaction.reply({ embeds: [new EmbedBuilder().setTitle("Shift Started").setDescription(`You are now clocked in for **${type}**.`).setColor(COLOR_GOLD).setThumbnail(LOGO_URL)] });
        } catch (err) { interaction.reply({ content: "Error clocking in.", ephemeral: true }); }
    }

    if (commandName === 'clockout') {
        const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
        if (!active) return interaction.reply({ content: "You are not clocked in!", ephemeral: true });
        try {
            await member.roles.remove(process.env.ROLE_ON_DUTY);
            const durationMins = Math.floor((new Date() - new Date(active.start_time)) / 60000);
            await db.collection('shifts').updateOne({ _id: active._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed' } });
            await db.collection('users').updateOne({ id: user.id }, { $inc: { total_minutes: durationMins, weekly_minutes: durationMins } }, { upsert: true });
            interaction.reply({ embeds: [new EmbedBuilder().setTitle("Shift Ended").setDescription(`You worked **${durationMins} minutes**.`).setColor(COLOR_NAVY).setThumbnail(LOGO_URL)] });
        } catch (err) { interaction.reply({ content: "Error clocking out.", ephemeral: true }); }
    }

    if (commandName === 'on-duty') {
        const activeShifts = await db.collection('shifts').find({ status: 'active' }).toArray();
        if (activeShifts.length === 0) return interaction.reply({ content: "No one is on duty.", ephemeral: true });
        const grouped = {};
        for (const shift of activeShifts) {
            const u = await db.collection('users').findOne({ id: shift.user_id });
            if (!grouped[shift.shift_type]) grouped[shift.shift_type] = [];
            grouped[shift.shift_type].push(u ? u.username : 'Unknown');
        }
        const embed = new EmbedBuilder().setTitle("🟢 Currently On Duty").setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
        for (const [type, users] of Object.entries(grouped)) { embed.addFields({ name: `**${type}** (${users.length})`, value: users.join(', ') }); }
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'leaderboard') {
        const topUsers = await db.collection('users').find().sort({ weekly_minutes: -1 }).limit(10).toArray();
        const embed = new EmbedBuilder().setTitle("🏆 Weekly Leaderboard").setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
        embed.setDescription(topUsers.map((u, i) => `**${i + 1}.** ${u.username} - ${((u.weekly_minutes || 0) / 60).toFixed(1)} hrs`).join('\n') || "No shifts logged this week.");
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'profile') {
        const target = interaction.options.getUser('user');
        const dbUser = await db.collection('users').findOne({ id: target.id });
        if (!dbUser) return interaction.reply({ content: "User not found.", ephemeral: true });
        const embed = new EmbedBuilder().setTitle(`👤 Profile: ${dbUser.username}`).setThumbnail(dbUser.avatar_url || LOGO_URL)
            .addFields({ name: 'Rank', value: dbUser.rank || 'Unranked', inline: true }, { name: 'Weekly Hours', value: `${((dbUser.weekly_minutes || 0) / 60).toFixed(1)}`, inline: true }, { name: 'Total Hours', value: `${((dbUser.total_minutes || 0) / 60).toFixed(1)}`, inline: true }, { name: 'Status', value: dbUser.status || 'Active', inline: true }).setColor(COLOR_GOLD);
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'roster') {
        const users = await db.collection('users').find({ status: 'Active' }).sort({ rank_level: -1 }).limit(20).toArray();
        const embed = new EmbedBuilder().setTitle('📋 LCDOT Roster').setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
        embed.setDescription(users.map(u => `**${u.rank}** - ${u.username}`).join('\n') || 'No active members.');
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'loa-return') {
        try {
            await member.roles.remove(process.env.ROLE_LOA);
            await member.setNickname(member.user.username);
            await db.collection('users').updateOne({ id: user.id }, { $set: { status: 'Active' } });
            interaction.reply({ content: "✅ Welcome back! LOA status removed.", ephemeral: true });
        } catch (err) { interaction.reply({ content: "Error removing LOA status.", ephemeral: true }); }
    }

    if (commandName === 'promote') {
        if (!member.roles.cache.has(process.env.ROLE_MGMT) && !member.roles.cache.has(process.env.ROLE_EXEC)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        const target = interaction.options.getUser('user');
        const newRank = interaction.options.getString('rank');
        const reason = interaction.options.getString('reason');
        const targetMember = await interaction.guild.members.fetch(target.id);
        
        const oldRankData = await db.collection('users').findOne({ id: target.id });
        if (oldRankData && rankMap[oldRankData.rank]) await targetMember.roles.remove(rankMap[oldRankData.rank]);
        await targetMember.roles.add(rankMap[newRank]);
        await db.collection('users').updateOne({ id: target.id }, { $set: { rank: newRank, rank_level: rankLevels[newRank] } }, { upsert: true });

        const embed = new EmbedBuilder().setTitle("🎖️ Promotion").setDescription(`<@${target.id}> has been promoted to **${newRank}**!`).addFields({ name: 'Reason', value: reason }).setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
        const promoChannel = await bot.channels.fetch(process.env.CHANNEL_PROMOTION);
        if (promoChannel) await promoChannel.send({ embeds: [embed] });
        interaction.reply({ content: `✅ Promoted ${target.username}.`, ephemeral: true });
    }

    if (commandName === 'reset-shifts') {
        if (!member.roles.cache.has(process.env.ROLE_EXEC)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        await db.collection('users').updateMany({}, { $set: { weekly_minutes: 0 } });
        interaction.reply({ content: "✅ All weekly hours reset to 0.", ephemeral: true });
    }
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

        // --- WEBSITE ROUTES ---
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
                
                await db.collection('users').updateOne({ id: userResponse.data.id }, { $set: { username: userResponse.data.username, rank, rank_level: rankLevel, avatar_url: avatarUrl, status: 'Active' }, $setOnInsert: { total_minutes: 0, weekly_minutes: 0 } }, { upsert: true });

                req.session.user = { id: userResponse.data.id, username: userResponse.data.username, rank, rankLevel, graderType, avatar_url: avatarUrl };
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
                    await db.collection('shifts').insertOne({ user_id: userId, shift_type: 'Website', start_time: new Date(), status: 'active' });
                    res.json({ success: true });
                } else if (action === 'End') {
                    const active = await db.collection('shifts').findOne({ user_id: userId, status: 'active' });
                    if (!active) return res.status(400).json({ error: 'No active shift found!' });
                    await member.roles.remove(process.env.ROLE_ON_DUTY);
                    const durationMins = Math.floor((new Date() - new Date(active.start_time)) / 60000);
                    await db.collection('shifts').updateOne({ _id: active._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed' } });
                    await db.collection('users').updateOne({ id: userId }, { $inc: { total_minutes: durationMins, weekly_minutes: durationMins } });
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
                    
                    const dmEmbed = new EmbedBuilder().setAuthor({ name: 'Department Of Transportation', iconURL: LOGO_URL }).setTitle(`DOT Application Approval: ${grader} Division`).setDescription(`Congratulations, <@${targetId}>,\n\n> Your **${grader}** application has been reviewed by our team. After careful evaluation, your application has been **approved**.`).addFields({ name: 'Additional Information:', value: `**Applicant:** ${member.user.username} | ${targetId}\n**Result:** Passed\n**Time of Review:** <t:${Math.floor(Date.now() / 1000)}:R>` }).setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
                    member.send({ embeds: [dmEmbed] }).catch(() => {});
                } else {
                    member.send({ embeds: [new EmbedBuilder().setTitle(`Application Update: ${grader} Division`).setDescription(`Hello <@${targetId}>,\n\nUnfortunately, your application for the **${grader}** division was **denied** at this time. Please contact a Division Lead for feedback.`).setColor('#DC2626').setThumbnail(LOGO_URL)] }).catch(() => {});
                }
                res.json({ success: true });
            } catch (error) { res.status(500).json({ error: 'Failed to grant roles.' }); }
        });

        app.get('/api/profile', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const user = await db.collection('users').findOne({ id: req.session.user.id });
            const shifts = await db.collection('shifts').find({ user_id: req.session.user.id, status: 'completed' }).sort({ start_time: -1 }).limit(10).toArray();
            const certs = await db.collection('certifications').find({ user_id: req.session.user.id }).sort({ graded_at: -1 }).toArray();
            res.json({ user, shifts, certs });
        });

        app.get('/api/personnel', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 6) return res.status(403).json({ error: 'Supervisor+ Only' });
            res.json(await db.collection('users').find().sort({ rank_level: -1, username: 1 }).toArray());
        });

        // --- DOCS (HANDBOOK & POLICIES) ---
        app.get('/api/docs/:type', async (req, res) => {
            const doc = await db.collection('docs').findOne({ type: req.params.type });
            res.json({ content: doc ? doc.content : 'No content added yet.' });
        });

        app.post('/api/docs/:type', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            await db.collection('docs').updateOne({ type: req.params.type }, { $set: { content: req.body.content } }, { upsert: true });
            res.json({ success: true });
        });

        // --- ADMIN ACTIONS ---
        app.post('/api/admin/action', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            const { targetId, action, value } = req.body;
            const target = await db.collection('users').findOne({ id: targetId });
            if (!target) return res.status(404).json({ error: 'User not found.' });
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(targetId);
                if (action === 'Promote') {
                    const newRoleId = rankMap[value];
                    if (!newRoleId) return res.status(400).json({ error: 'Invalid rank.' });
                    const oldRoleId = rankMap[target.rank];
                    if (oldRoleId && member.roles.cache.has(oldRoleId)) await member.roles.remove(oldRoleId);
                    await member.roles.add(newRoleId);
                    await db.collection('users').updateOne({ id: targetId }, { $set: { rank: value, rank_level: rankLevels[value] } });
                } else if (action === 'Suspend') {
                    await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'Suspended' } });
                } else if (action === 'Reinstate') {
                    await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'Active' } });
                }
                res.json({ success: true });
            } catch (error) { res.status(500).json({ error: 'Discord Action Failed.' }); }
        });

        app.get('/api/audit-logs', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            res.json(await db.collection('audit_logs').find().sort({ created_at: -1 }).limit(100).toArray());
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ LCDOT Master Server running on port ${PORT}`));
    } catch (error) {
        console.error('❌ Fatal Startup Error:', error);
        process.exit(1);
    }
}
startServer();