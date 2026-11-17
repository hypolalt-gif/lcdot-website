require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { MongoClient } = require('mongodb');
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

        // Health check for UptimeRobot
        app.get('/api/health', (req, res) => res.send('OK'));

        app.get('/dashboard', (req, res) => {
            if (!req.session.user) return res.redirect('/');
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        });

        app.get('/api/me', (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
            res.json(req.session.user);
        });

        // --- DIRECTOR PANEL APIS ---
        app.get('/api/director/active-shifts', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 8) return res.status(403).json({ error: 'Director Only' });
            const active = await db.collection('active_shifts').find().toArray();
            res.json(active);
        });

        app.post('/api/director/force-end', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 8) return res.status(403).json({ error: 'Director Only' });
            const { shiftId, userId } = req.body;
            
            const activeShift = await db.collection('active_shifts').findOne({ _id: require('mongodb').ObjectId(shiftId) });
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

        app.get('/api/directory', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const users = await db.collection('users').find().sort({ rank_level: -1, username: 1 }).toArray();
            res.json(users);
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web Server running on port ${PORT}`));

    } catch (error) {
        console.error('❌ Fatal Startup Error:', error);
        process.exit(1);
    }
}
startServer();