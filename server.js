require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(express.json());
app.use(express.static('public'));

let db;

async function startServer() {
    try {
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('lcdot');
        global.db = db; 
        console.log('✅ Connected to MongoDB Atlas');

        require('./bot/bot');

        app.use(session({ 
            secret: process.env.SESSION_SECRET || 'fallback_secret',
            resave: false, saveUninitialized: false, 
            store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
            cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 } 
        }));

        app.use('/auth', require('./routes/auth')(db));

        app.get('/api/health', (req, res) => res.send('OK'));

        app.get('/dashboard', (req, res) => {
            if (!req.session.user) return res.redirect('/');
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        });

        app.get('/api/me', (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
            res.json(req.session.user);
        });

        app.get('/api/directory', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const users = await db.collection('users').find().sort({ rank_level: -1, username: 1 }).toArray();
            res.json(users);
        });

        app.get('/api/loa', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            let query = req.session.user.rankLevel < 7 ? { user_id: req.session.user.id } : {};
            const requests = await db.collection('loa_requests').find(query).sort({ submitted_at: -1 }).toArray();
            res.json(requests);
        });

        app.post('/api/loa/submit', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const { startDate, endDate, reason } = req.body;
            
            const request = {
                user_id: req.session.user.id, username: req.session.user.username,
                startDate, endDate, reason, status: 'Pending', submitted_at: new Date()
            };
            
            const result = await db.collection('loa_requests').insertOne(request);
            
            try {
                const bot = require('./bot/bot');
                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const channel = await bot.channels.fetch(process.env.CHANNEL_LOA);
                
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setColor('#18181b')
                        .setTitle('📝 LOA Request')
                        .addFields(
                            { name: 'Employee', value: `<@${req.session.user.id}>`, inline: true },
                            { name: 'Status', value: 'Pending', inline: true },
                            { name: 'Start Date', value: startDate, inline: true },
                            { name: 'End Date', value: endDate, inline: true },
                            { name: 'Reason', value: reason }
                        )
                        .setTimestamp();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`approve_loa_${result.insertedId}`).setLabel('Approve LOA').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`deny_loa_${result.insertedId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
                    );

                    await channel.send({ embeds: [embed], components: [row] });
                }
            } catch (err) { console.error("Could not send LOA to Discord:", err); }

            res.json({ success: true });
        });

        app.get('/api/director/active-shifts', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 8) return res.status(403).json({ error: 'Director Only' });
            const active = await db.collection('active_shifts').find().toArray();
            res.json(active);
        });

        app.post('/api/director/force-end', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 8) return res.status(403).json({ error: 'Director Only' });
            const { shiftId, userId } = req.body;
            
            const activeShift = await db.collection('active_shifts').findOne({ _id: new ObjectId(shiftId) });
            if (activeShift) {
                const totalMs = new Date() - new Date(activeShift.startTime) - (activeShift.totalPausedMs || 0);
                await db.collection('completed_shifts').insertOne({
                    userId: activeShift.userId, username: activeShift.username, type: activeShift.type, startTime: activeShift.startTime, endTime: new Date(), durationMs: totalMs, status: 'Completed'
                });
                await db.collection('active_shifts').deleteOne({ _id: activeShift._id });
                
                const bot = require('./bot/bot');
                try {
                    const member = await bot.guilds.cache.get(process.env.GUILD_ID).members.fetch(userId);
                    if (member) await member.roles.remove(process.env.ROLE_ON_DUTY);
                } catch(e) {}
            }
            res.json({ success: true });
        });

        // --- UPDATED OOS MANAGEMENT ROUTES ---
        app.get('/api/director/oos-users', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 8) return res.status(403).json({ error: 'Director Only' });
            const oos = await db.collection('users').find({ isOOS: true }).toArray();
            res.json(oos);
        });

        app.post('/api/director/oos-access', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 8) return res.status(403).json({ error: 'Director Only' });
            const { targetId, action, oosRank } = req.body;

            if (action === 'grant') {
                await db.collection('users').updateOne(
                    { id: targetId },
                    { $set: { isOOS: true, oos_rank: oosRank } }
                );
            } else {
                await db.collection('users').updateOne(
                    { id: targetId },
                    { $set: { isOOS: false, oos_rank: null } }
                );
            }
            res.json({ success: true });
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web Server running on port ${PORT}`));

    } catch (error) {
        console.error('❌ Fatal Startup Error:', error);
        process.exit(1);
    }
}
startServer();