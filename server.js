require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Security Middleware
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(express.json());
app.use(express.static('public'));

let db;

async function startServer() {
    try {
        // 1. Connect to Database
        const client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        db = client.db('lcdot');
        global.db = db; // Make available to bot
        
        console.log('✅ Connected to MongoDB Atlas');

        // 2. Create Database Indexes
        await db.collection('users').createIndex({ id: 1 }, { unique: true });
        await db.collection('active_shifts').createIndex({ userId: 1 });
        await db.collection('completed_shifts').createIndex({ userId: 1 });
        await db.collection('loa_requests').createIndex({ user_id: 1 });
        console.log('✅ Database schema initialized.');

        // 3. Start Discord Bot
        require('./bot/bot');

        // 4. Setup Sessions
        app.use(session({ 
            secret: process.env.SESSION_SECRET || 'fallback_secret',
            resave: false, 
            saveUninitialized: false, 
            store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
            cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 } 
        }));

        // 5. Auth Routes
        app.use('/auth', require('./routes/auth')(db));

        // --- MIDDLEWARE: PERMISSIONS ---
        const requireAuth = (req, res, next) => {
            if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
            next();
        };

        const requireManagement = (req, res, next) => {
            if (!req.session.user || req.session.user.rankLevel < 7) {
                return res.status(403).json({ error: 'Management access required.' });
            }
            next();
        };

        const requireDirector = (req, res, next) => {
            if (!req.session.user || req.session.user.rankLevel < 8) {
                return res.status(403).json({ error: 'Director access required.' });
            }
            next();
        };

        // --- API ROUTES ---

        // Health Check
        app.get('/api/health', (req, res) => res.send('OK'));

        // Page Routes
        app.get('/dashboard', (req, res) => {
            if (!req.session.user) return res.redirect('/');
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        });

        app.get('/api/me', requireAuth, (req, res) => {
            res.json(req.session.user);
        });

        // Profile API
        app.get('/api/profile/:id?', requireAuth, async (req, res) => {
            const targetId = req.params.id || req.session.user.id;
            
            // Employees can only view their own profile unless they are Supervisor+
            if (targetId !== req.session.user.id && req.session.user.rankLevel < 6) {
                return res.status(403).json({ error: 'Access Denied' });
            }

            const user = await db.collection('users').findOne({ id: targetId });
            if (!user) return res.status(404).json({ error: 'User not found' });

            const loas = await db.collection('loa_requests').find({ user_id: targetId }).toArray();
            const shifts = await db.collection('completed_shifts').find({ userId: targetId }).sort({ endTime: -1 }).limit(10).toArray();
            
            res.json({ user, loas, shifts });
        });

        // Directory API
        app.get('/api/directory', requireAuth, async (req, res) => {
            if (req.session.user.rankLevel < 6) return res.status(403).json({ error: 'Access Denied' });
            const users = await db.collection('users').find().sort({ rank_level: -1, username: 1 }).toArray();
            res.json(users);
        });

        // Management Action API (Promote/Suspend)
        app.post('/api/management/action', requireManagement, async (req, res) => {
            const { targetId, action, value } = req.body;
            const target = await db.collection('users').findOne({ id: targetId });
            if (!target) return res.status(404).json({ error: 'User not found.' });

            const rankConfig = {
                "Junior Operator": { level: 1, role: process.env.ROLE_JUNIOR },
                "Operator": { level: 2, role: process.env.ROLE_OPERATOR },
                "Senior Operator": { level: 3, role: process.env.ROLE_SENIOR },
                "Specialist": { level: 4, role: process.env.ROLE_SPECIALIST },
                "Crew Supervisor": { level: 5, role: process.env.ROLE_CREW },
                "Field Supervisor": { level: 6, role: process.env.ROLE_FIELD },
                "Management Team": { level: 7, role: process.env.ROLE_MGMT },
                "Executive Board": { level: 8, role: process.env.ROLE_EXEC }
            };

            try {
                const bot = require('./bot/bot');
                const guild = await bot.guilds.fetch(process.env.GUILD_ID);
                const member = await guild.members.fetch(targetId);

                if (action === 'Promote') {
                    const newConfig = rankConfig[value];
                    const oldConfig = Object.values(rankConfig).find(r => r.level === target.rank_level);
                    
                    if (oldConfig && oldConfig.role && member.roles.cache.has(oldConfig.role)) {
                        await member.roles.remove(oldConfig.role).catch(()=>{});
                    }
                    if (newConfig && newConfig.role) {
                        await member.roles.add(newConfig.role);
                    }
                    await db.collection('users').updateOne({ id: targetId }, { $set: { rank: value, rank_level: newConfig.level } });
                    
                } else if (action === 'Suspend') {
                    await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'Suspended' } });
                    await member.roles.add(process.env.ROLE_SUSPENDED).catch(()=>{});
                } else if (action === 'Reinstate') {
                    await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'Active' } });
                    await member.roles.remove(process.env.ROLE_SUSPENDED).catch(()=>{});
                }
                res.json({ success: true });
            } catch (error) { 
                console.error(error);
                res.status(500).json({ error: 'Discord Action Failed. Check bot permissions.' }); 
            }
        });

        // LOA APIs
        app.get('/api/loa', requireAuth, async (req, res) => {
            let query = req.session.user.rankLevel < 7 ? { user_id: req.session.user.id } : {};
            const requests = await db.collection('loa_requests').find(query).sort({ submitted_at: -1 }).toArray();
            res.json(requests);
        });

        app.post('/api/loa/submit', requireAuth, async (req, res) => {
            const { startDate, endDate, reason } = req.body;
            const request = {
                user_id: req.session.user.id, username: req.session.user.username,
                startDate, endDate, reason, status: 'Pending', submitted_at: new Date()
            };
            const result = await db.collection('loa_requests').insertOne(request);
            
            // Discord Notification
            try {
                const bot = require('./bot/bot');
                const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                const channel = await bot.channels.fetch(process.env.CHANNEL_LOA);
                if (channel) {
                    const embed = new EmbedBuilder().setColor('#18181b').setTitle('📝 LOA Request')
                        .addFields(
                            { name: 'Employee', value: `<@${req.session.user.id}>`, inline: true },
                            { name: 'Status', value: 'Pending', inline: true },
                            { name: 'Start Date', value: startDate, inline: true },
                            { name: 'End Date', value: endDate, inline: true },
                            { name: 'Reason', value: reason }
                        ).setTimestamp();
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`approve_loa_${result.insertedId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`deny_loa_${result.insertedId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
                    );
                    await channel.send({ embeds: [embed], components: [row] });
                }
            } catch (err) { console.error(err); }
            res.json({ success: true });
        });

        // Director Panel APIs
        app.get('/api/director/active-shifts', requireDirector, async (req, res) => {
            const active = await db.collection('active_shifts').find().toArray();
            res.json(active);
        });

        app.post('/api/director/force-end', requireDirector, async (req, res) => {
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

        app.get('/api/director/oos-users', requireDirector, async (req, res) => {
            const oos = await db.collection('users').find({ isOOS: true }).toArray();
            res.json(oos);
        });

        app.post('/api/director/oos-access', requireDirector, async (req, res) => {
            const { targetId, action, oosRank } = req.body;
            if (action === 'grant') {
                await db.collection('users').updateOne({ id: targetId }, { $set: { isOOS: true, oos_rank: oosRank } });
            } else {
                await db.collection('users').updateOne({ id: targetId }, { $set: { isOOS: false, oos_rank: null } });
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