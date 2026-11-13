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
    if (interaction.isButton()) {
        const { customId, user, guild } = interaction;
        if (customId === 'btn_clockin') {
            const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
            if (active) return interaction.reply({ content: "❌ You are already clocked in!", ephemeral: true });
            await guild.members.fetch(user.id).then(m => m.roles.add(process.env.ROLE_ON_DUTY));
            await db.collection('shifts').insertOne({ user_id: user.id, shift_type: 'Discord Panel', start_time: new Date(), status: 'active' });
            interaction.reply({ content: "✅ You have successfully **Clocked In**.", ephemeral: true });
        }
        if (customId === 'btn_clockout') {
            const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
            if (!active) return interaction.reply({ content: "❌ You are not clocked in!", ephemeral: true });
            await guild.members.fetch(user.id).then(m => m.roles.remove(process.env.ROLE_ON_DUTY));
            const durationMins = Math.floor((new Date() - new Date(active.start_time)) / 60000);
            await db.collection('shifts').updateOne({ _id: active._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed' } });
            await db.collection('users').updateOne({ id: user.id }, { $inc: { total_minutes: durationMins, weekly_minutes: durationMins } }, { upsert: true });
            interaction.reply({ content: `✅ You have **Clocked Out**. Worked: **${durationMins} mins**.`, ephemeral: true });
        }
        return;
    }

    if (!interaction.isChatInputCommand() || !db) return;
    const { commandName, user } = interaction;
    const member = await interaction.guild.members.fetch(user.id);

    // --- PANELS & DASHBOARDS ---
    if (commandName === 'setup-panels') {
        if (!member.roles.cache.has(process.env.ROLE_MGMT) && !member.roles.cache.has(process.env.ROLE_EXEC)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        const embed = new EmbedBuilder().setTitle("⏱️ Shift Management").setDescription("Use the buttons below to clock in and out.").setColor(COLOR_GOLD);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_clockin').setLabel('Clock In').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_clockout').setLabel('Clock Out').setStyle(ButtonStyle.Danger)
        );
        await interaction.channel.send({ embeds: [embed], components: [row] });
        interaction.reply({ content: "✅ Panels deployed.", ephemeral: true });
    }

    if (commandName === 'management-dashboard') {
        if (!member.roles.cache.has(process.env.ROLE_MGMT) && !member.roles.cache.has(process.env.ROLE_EXEC)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        const embed = new EmbedBuilder().setTitle("🏛️ Management Command Center").setDescription("Use these buttons to manage department operations.").setColor(COLOR_GOLD);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('mgmt_apps').setLabel('Pending Applications').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('mgmt_discipline').setLabel('Issue Discipline').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('mgmt_promotions').setLabel('Promotions').setStyle(ButtonStyle.Success)
        );
        await interaction.channel.send({ embeds: [embed], components: [row] });
        interaction.reply({ content: "✅ Management Dashboard deployed.", ephemeral: true });
    }

    if (commandName === 'fto-dashboard') {
        if (!member.roles.cache.has(process.env.GRADER_FTO)) return interaction.reply({ content: "❌ Denied. FTO Only.", ephemeral: true });
        const embed = new EmbedBuilder().setTitle("🎓 FTO Command Center").setDescription("Use these buttons to manage training operations.").setColor(COLOR_GOLD);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fto_assign').setLabel('Assign Trainee').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('fto_complete').setLabel('Complete Training').setStyle(ButtonStyle.Success)
        );
        await interaction.channel.send({ embeds: [embed], components: [row] });
        interaction.reply({ content: "✅ FTO Dashboard deployed.", ephemeral: true });
    }

    // --- ROSTER & SHIFTS ---
    if (commandName === 'roster') {
        const users = await db.collection('users').find({ status: 'Active' }).sort({ rank_level: -1 }).limit(20).toArray();
        const embed = new EmbedBuilder().setTitle('📋 LCDOT Roster').setColor(COLOR_GOLD);
        embed.setDescription(users.map(u => `**${u.rank}** - ${u.username}`).join('\n') || 'No active members.');
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'roster-view' || commandName === 'roster-search') {
        let targetId = commandName === 'roster-view' ? interaction.options.getUser('user').id : interaction.options.getString('query');
        const query = { $or: [{ id: targetId }, { username: { $regex: targetId, $options: 'i' } }] };
        const targetUser = await db.collection('users').findOne(query);
        if (!targetUser) return interaction.reply({ content: "User not found.", ephemeral: true });
        
        const embed = new EmbedBuilder().setTitle(`👤 Profile: ${targetUser.username}`).setThumbnail(targetUser.avatar_url || LOGO_URL)
            .addFields({ name: 'Rank', value: targetUser.rank || 'Unranked', inline: true }, { name: 'Weekly Hours', value: `${((targetUser.weekly_minutes || 0) / 60).toFixed(1)}`, inline: true }, { name: 'Total Hours', value: `${((targetUser.total_minutes || 0) / 60).toFixed(1)}`, inline: true }, { name: 'Status', value: targetUser.status || 'Active', inline: true }).setColor(COLOR_GOLD);
        interaction.reply({ embeds: [embed] });
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
        await db.collection('users').updateOne({ id: target.id }, { $set: { rank: newRank, rank_level: rankLevels[newRank] } });
        
        await db.collection('promotions').insertOne({ user_id: target.id, old_rank: oldRankData?.rank || 'None', new_rank: newRank, reason, promoted_by: user.id, date: new Date() });

        const embed = new EmbedBuilder().setTitle("🎖️ Promotion").setDescription(`<@${target.id}> has been promoted to **${newRank}**!`).addFields({ name: 'Reason', value: reason }).setColor(COLOR_GOLD);
        try { await interaction.channel.send({ embeds: [embed] }); } catch(e){}
        interaction.reply({ content: `✅ Promoted ${target.username}.`, ephemeral: true });
    }

    if (commandName === 'promotion-history') {
        const target = interaction.options.getUser('user');
        const history = await db.collection('promotions').find({ user_id: target.id }).sort({ date: -1 }).toArray();
        const embed = new EmbedBuilder().setTitle(`Promotion History: ${target.username}`).setColor(COLOR_GOLD);
        embed.setDescription(history.map(h => `**${new Date(h.date).toLocaleDateString()}**: ${h.old_rank} ➔ ${h.new_rank} (${h.reason})`).join('\n') || 'No promotions recorded.');
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'shift' || commandName === 'activity') {
        const stats = await db.collection('users').findOne({ id: user.id });
        const embed = new EmbedBuilder().setTitle(`Shift Data: ${user.username}`)
            .addFields(
                { name: 'Weekly Hours', value: `${((stats?.weekly_minutes || 0) / 60).toFixed(1)}`, inline: true },
                { name: 'Total Hours', value: `${((stats?.total_minutes || 0) / 60).toFixed(1)}`, inline: true }
            ).setColor(COLOR_GOLD);
        interaction.reply({ embeds: [embed] });
    }

    // --- DISCIPLINE / IA ---
    if (commandName === 'discipline-issue') {
        if (!member.roles.cache.has(process.env.ROLE_MGMT) && !member.roles.cache.has(process.env.ROLE_EXEC)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        const target = interaction.options.getUser('user');
        const action = interaction.options.getString('action');
        const reason = interaction.options.getString('reason');
        
        await db.collection('discipline').insertOne({ user_id: target.id, action, reason, issued_by: user.id, date: new Date(), status: 'Active' });
        interaction.reply({ content: `✅ Logged **${action}** for ${target.username}.`, ephemeral: true });
    }

    if (commandName === 'discipline-history') {
        if (!member.roles.cache.has(process.env.ROLE_MGMT) && !member.roles.cache.has(process.env.ROLE_EXEC)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        const target = interaction.options.getUser('user');
        const history = await db.collection('discipline').find({ user_id: target.id }).sort({ date: -1 }).toArray();
        
        const embed = new EmbedBuilder().setTitle(`IA Record: ${target.username}`).setColor('#DC2626');
        embed.setDescription(history.map(h => `**${h.action}** on ${new Date(h.date).toLocaleDateString()}\nReason: ${h.reason}\nStatus: ${h.status}`).join('\n\n') || 'No disciplinary records found.');
        interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // --- FTO ---
    if (commandName === 'fto-complete') {
        if (!member.roles.cache.has(process.env.GRADER_FTO)) return interaction.reply({ content: "❌ Denied.", ephemeral: true });
        const trainee = interaction.options.getUser('trainee');
        const result = interaction.options.getString('result');
        
        await db.collection('fto_logs').insertOne({ trainee_id: trainee.id, fto_id: user.id, result, date: new Date() });
        
        if (result === 'Pass') {
            const targetMember = await interaction.guild.members.fetch(trainee.id);
            await targetMember.roles.add(process.env.PASSED_FTO || process.env.ROLE_OPERATOR); // Fallback if PASSED_FTO not set
        }
        
        interaction.reply({ content: `✅ FTO session logged. Result: **${result}**.`, ephemeral: true });
    }

    if (commandName === 'fto-history') {
        const target = interaction.options.getUser('user');
        const history = await db.collection('fto_logs').find({ trainee_id: target.id }).sort({ date: -1 }).toArray();
        const embed = new EmbedBuilder().setTitle(`FTO History: ${target.username}`).setColor(COLOR_GOLD);
        embed.setDescription(history.map(h => `**${new Date(h.date).toLocaleDateString()}**: ${h.result} (Instructor: <@${h.fto_id}>)`).join('\n') || 'No training records.');
        interaction.reply({ embeds: [embed] });
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

        app.get('/api/my-stats', async (req, res) => {
            const stats = await db.collection('users').findOne({ id: req.session.user.id });
            res.json({ totalMinutes: stats ? stats.total_minutes : 0 });
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ LCDOT Master Server running on port ${PORT}`));
    } catch (error) { process.exit(1); }
}
startServer();