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
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
let db; 

// --- CONSTANTS ---
const COLOR_GOLD = '#D4AF37';
const COLOR_NAVY = '#14264A';
const LOGO_URL = process.env.DOT_LOGO_URL || 'https://i.imgur.com/yourlogo.png';

const rankMap = {
    "Junior Operator": process.env.ROLE_JUNIOR, "Operator": process.env.ROLE_OPERATOR, "Senior Operator": process.env.ROLE_SENIOR,
    "Specialist": process.env.ROLE_SPECIALIST, "Crew Supervisor": process.env.ROLE_CREW, "Field Supervisor": process.env.ROLE_FIELD,
    "Management Team": process.env.ROLE_MGMT, "Executive Board": process.env.ROLE_EXEC
};
const roleToRankMap = Object.fromEntries(Object.entries(rankMap).map(([k, v]) => [v, k]));
const rankLevels = { "Junior Operator": 1, "Operator": 2, "Senior Operator": 3, "Specialist": 4, "Crew Supervisor": 5, "Field Supervisor": 6, "Management Team": 7, "Executive Board": 8 };

// Division/Board Map for Clockin
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
    
    const commands = [
        new SlashCommandBuilder().setName('clockin')
            .setDescription('Start your DOT shift')
            .addStringOption(opt => opt.setName('type').setDescription('Select Board or Division').setRequired(true)
                .addChoices(
                    { name: 'Ranked Board', value: 'Ranked Board' },
                    { name: 'Supervisory Board', value: 'Supervisory Board' },
                    { name: 'HOD (Heavy Ops)', value: 'HOD' },
                    { name: 'COD (Construction)', value: 'COD' },
                    { name: 'CCD (Community)', value: 'CCD' },
                    { name: 'FTO (Field Training)', value: 'FTO' }
                )),
        new SlashCommandBuilder().setName('clockout').setDescription('End your DOT shift'),
        new SlashCommandBuilder().setName('stats').setDescription('View your DOT stats'),
        new SlashCommandBuilder().setName('profile')
            .setDescription('View a member\'s full profile')
            .addUserOption(opt => opt.setName('user').setDescription('The user to view').setRequired(true)),
        new SlashCommandBuilder().setName('on-duty').setDescription('View who is currently on duty'),
        new SlashCommandBuilder().setName('leaderboard').setDescription('View the weekly hours leaderboard'),
        new SlashCommandBuilder().setName('loa')
            .setDescription('Request a Leave of Absence')
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for LOA').setRequired(true)),
        new SlashCommandBuilder().setName('promote')
            .setDescription('Promote a member')
            .addUserOption(opt => opt.setName('user').setDescription('The user to promote').setRequired(true))
            .addStringOption(opt => opt.setName('rank').setDescription('The new rank').setRequired(true)
                .addChoices(
                    { name: 'Junior Operator', value: 'Junior Operator' }, { name: 'Operator', value: 'Operator' },
                    { name: 'Senior Operator', value: 'Senior Operator' }, { name: 'Specialist', value: 'Specialist' },
                    { name: 'Crew Supervisor', value: 'Crew Supervisor' }, { name: 'Field Supervisor', value: 'Field Supervisor' },
                    { name: 'Management Team', value: 'Management Team' }, { name: 'Executive Board', value: 'Executive Board' }
                ))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason for promotion').setRequired(true)),
        new SlashCommandBuilder().setName('reset-shifts').setDescription('Reset all weekly hours (Executive Only)')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
        console.log('✅ Slash commands registered.');
    } catch (error) { console.error('Error registering commands:', error); }
});

// Auto-Sync Roles from Discord
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

// --- 2. SLASH COMMAND LOGIC ---
bot.on('interactionCreate', async interaction => {
    // Handle Buttons (LOA Approval)
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('approve_loa_')) {
            const targetId = interaction.customId.split('_')[2];
            try {
                const member = await interaction.guild.members.fetch(targetId);
                await member.roles.add(process.env.ROLE_LOA);
                await member.setNickname(`LOA (${member.user.username})`);
                await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'LOA' } });
                
                const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('#2ecc71')
                    .setFooter({ text: `Approved by ${interaction.user.username}` });
                await interaction.update({ embeds: [updatedEmbed], components: [] });
            } catch (err) { interaction.reply({ content: 'Error approving LOA.', ephemeral: true }); }
        }
        if (interaction.customId.startsWith('deny_loa_')) {
            const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('#e74c3c')
                .setFooter({ text: `Denied by ${interaction.user.username}` });
            await interaction.update({ embeds: [updatedEmbed], components: [] });
        }
        return;
    }

    if (!interaction.isChatInputCommand() || !db) return;
    const { commandName, user } = interaction;
    const member = await interaction.guild.members.fetch(user.id);

    if (commandName === 'clockin') {
        const type = interaction.options.getString('type');
        const requiredRole = clockInMap[type];

        if (!member.roles.cache.has(requiredRole)) {
            return interaction.reply({ content: `❌ You do not have the required role to clock in for **${type}**.`, ephemeral: true });
        }

        const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
        if (active) return interaction.reply({ content: "You are already clocked in! Use `/clockout` first.", ephemeral: true });

        try {
            await member.roles.add(process.env.ROLE_ON_DUTY);
            await db.collection('shifts').insertOne({ user_id: user.id, shift_type: type, start_time: new Date(), status: 'active' });
            
            const embed = new EmbedBuilder().setTitle("Shift Started").setDescription(`You are now clocked in for **${type}**.`).setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
            interaction.reply({ embeds: [embed] });
        } catch (err) { interaction.reply({ content: "Error clocking in. Check bot permissions.", ephemeral: true }); }
    }

    if (commandName === 'clockout') {
        const active = await db.collection('shifts').findOne({ user_id: user.id, status: 'active' });
        if (!active) return interaction.reply({ content: "You are not clocked in!", ephemeral: true });

        try {
            await member.roles.remove(process.env.ROLE_ON_DUTY);
            const durationMins = Math.floor((new Date() - new Date(active.start_time)) / 60000);
            
            await db.collection('shifts').updateOne({ _id: active._id }, { $set: { end_time: new Date(), duration_minutes: durationMins, status: 'completed' } });
            await db.collection('users').updateOne({ id: user.id }, { $inc: { total_minutes: durationMins, weekly_minutes: durationMins } }, { upsert: true });
            
            const embed = new EmbedBuilder().setTitle("Shift Ended").setDescription(`You worked **${durationMins} minutes** for **${active.shift_type}**.`).setColor(COLOR_NAVY).setThumbnail(LOGO_URL);
            interaction.reply({ embeds: [embed] });
        } catch (err) { interaction.reply({ content: "Error clocking out.", ephemeral: true }); }
    }

    if (commandName === 'loa') {
        const reason = interaction.options.getString('reason');
        
        const embed = new EmbedBuilder()
            .setTitle("📝 Leave of Absence Request")
            .setDescription(`**User:** ${user.tag} (${user.id})\n**Reason:** ${reason}`)
            .setColor(COLOR_GOLD)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_loa_${user.id}`).setLabel('Approve LOA').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`deny_loa_${user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
        );

        try {
            const channel = await bot.channels.fetch(process.env.CHANNEL_LOA);
            if (channel) await channel.send({ embeds: [embed], components: [row] });
            interaction.reply({ content: "✅ Your LOA request has been sent to Management for review.", ephemeral: true });
        } catch (err) { interaction.reply({ content: "Error sending LOA request.", ephemeral: true }); }
    }

    if (commandName === 'promote') {
        if (!member.roles.cache.has(process.env.ROLE_MGMT) && !member.roles.cache.has(process.env.ROLE_EXEC)) {
            return interaction.reply({ content: "❌ Only Management+ can promote members.", ephemeral: true });
        }
        const target = interaction.options.getUser('user');
        const newRank = interaction.options.getString('rank');
        const reason = interaction.options.getString('reason');
        const newRoleId = rankMap[newRank];

        try {
            const targetMember = await interaction.guild.members.fetch(target.id);
            const oldRankData = await db.collection('users').findOne({ id: target.id });
            
            if (oldRankData && rankMap[oldRankData.rank]) {
                await targetMember.roles.remove(rankMap[oldRankData.rank]);
            }
            await targetMember.roles.add(newRoleId);
            await db.collection('users').updateOne({ id: target.id }, { $set: { rank: newRank, rank_level: rankLevels[newRank] } }, { upsert: true });

            const embed = new EmbedBuilder()
                .setTitle("🎖️ Promotion")
                .setDescription(`<@${target.id}> has been promoted to **${newRank}**!`)
                .addFields({ name: 'Reason', value: reason })
                .setColor(COLOR_GOLD)
                .setThumbnail(LOGO_URL);
            
            const promoChannel = await bot.channels.fetch(process.env.CHANNEL_PROMOTION);
            if (promoChannel) await promoChannel.send({ embeds: [embed] });
            interaction.reply({ content: `✅ Successfully promoted ${target.username}.`, ephemeral: true });
        } catch (err) { interaction.reply({ content: "Error processing promotion.", ephemeral: true }); }
    }

    if (commandName === 'on-duty') {
        const activeShifts = await db.collection('shifts').find({ status: 'active' }).toArray();
        if (activeShifts.length === 0) return interaction.reply({ content: "No one is currently on duty.", ephemeral: true });

        const grouped = {};
        for (const shift of activeShifts) {
            const u = await db.collection('users').findOne({ id: shift.user_id });
            if (!grouped[shift.shift_type]) grouped[shift.shift_type] = [];
            grouped[shift.shift_type].push(u ? u.username : 'Unknown');
        }

        const embed = new EmbedBuilder().setTitle("🟢 Currently On Duty").setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
        for (const [type, users] of Object.entries(grouped)) {
            embed.addFields({ name: `**${type}** (${users.length})`, value: users.join(', ') });
        }
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'leaderboard') {
        const topUsers = await db.collection('users').find().sort({ weekly_minutes: -1 }).limit(10).toArray();
        const embed = new EmbedBuilder().setTitle("🏆 Weekly Leaderboard").setColor(COLOR_GOLD).setThumbnail(LOGO_URL);
        
        let desc = topUsers.map((u, i) => `**${i + 1}.** ${u.username} - ${((u.weekly_minutes || 0) / 60).toFixed(1)} hrs`).join('\n');
        embed.setDescription(desc || "No shifts logged this week.");
        interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'reset-shifts') {
        if (!member.roles.cache.has(process.env.ROLE_EXEC)) {
            return interaction.reply({ content: "❌ Only the Executive Board can reset shifts.", ephemeral: true });
        }
        await db.collection('users').updateMany({}, { $set: { weekly_minutes: 0 } });
        interaction.reply({ content: "✅ All weekly hours have been reset to 0. All-time hours are safe.", ephemeral: true });
    }
});

// Discord Logging Helper
async function sendLog(channelId, title, description, color = COLOR_NAVY) {
    if (!channelId) return;
    try {
        const channel = await bot.channels.fetch(channelId);
        if (channel) await channel.send({ embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp()] });
    } catch (err) { console.error('Logging Error:', err.message); }
}

// --- 3. EXPRESS & DB SETUP ---
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 2000 }));
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
        
        // This route is hit when a Division Lead approves an app on the website!
        app.post('/api/certify', async (req, res) => {
            if (!req.session.user || !req.session.user.graderType) return res.status(403).json({ error: 'Access Denied.' });
            const { targetId, passed, notes } = req.body;
            const grader = req.session.user.graderType;
            
            try {
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(targetId);
                
                await db.collection('certifications').insertOne({ user_id: targetId, cert_type: grader, status: passed ? 'Passed' : 'Failed', grader_id: req.session.user.id, notes, graded_at: new Date() });
                
                if (passed) {
                    // Give Roles
                    if (grader === 'HOD') { await member.roles.add(process.env.PASSED_HOD_1); await member.roles.add(process.env.PASSED_HOD_2); }
                    if (grader === 'COD') { await member.roles.add(process.env.PASSED_COD_1); await member.roles.add(process.env.PASSED_COD_2); }
                    if (grader === 'CCD') { await member.roles.add(process.env.PASSED_CCD_1); await member.roles.add(process.env.PASSED_CCD_2); }
                    
                    // Send beautiful DM (Matching the screenshot)
                    const dmEmbed = new EmbedBuilder()
                        .setAuthor({ name: 'Department Of Transportation', iconURL: LOGO_URL })
                        .setTitle(`DOT Application Approval: ${grader} Division`)
                        .setDescription(`Congratulations, <@${targetId}>,\n\n> Your **${grader}** application has been reviewed by our team. After careful evaluation, your application has been **approved**.`)
                        .addFields(
                            { name: 'Additional Information:', value: `**Applicant:** ${member.user.username} | ${targetId}\n**Result:** Passed\n**Time of Review:** <t:${Math.floor(Date.now() / 1000)}:R>` }
                        )
                        .setColor(COLOR_GOLD)
                        .setThumbnail(LOGO_URL);
                    
                    member.send({ embeds: [dmEmbed] }).catch(() => {});
                } else {
                    const failEmbed = new EmbedBuilder()
                        .setTitle(`Application Update: ${grader} Division`)
                        .setDescription(`Hello <@${targetId}>,\n\nUnfortunately, your application for the **${grader}** division was **denied** at this time. Please contact a Division Lead for feedback.`)
                        .setColor('#e74c3c').setThumbnail(LOGO_URL);
                    member.send({ embeds: [failEmbed] }).catch(() => {});
                }

                sendLog(process.env.CHANNEL_AUDIT, `App Review: ${passed ? 'Passed' : 'Failed'}`, `**Grader:** ${req.session.user.username}\n**Student ID:** ${targetId}\n**Division:** ${grader}`, passed ? '#2ecc71' : '#e74c3c');
                res.json({ success: true });
            } catch (error) { res.status(500).json({ error: 'Failed to grant roles.' }); }
        });

        // (All your other routes from Phase 6 go here, unchanged...)
        // Just paste your existing app.get('/auth/discord'...) etc. back in here.
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ LCDOT Master Server running on port ${PORT}`));
    } catch (error) {
        console.error('❌ Fatal Startup Error:', error);
        process.exit(1);
    }
}
startServer();