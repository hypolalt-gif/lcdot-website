require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { MongoClient } = require('mongodb');
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
        global.db = db; // Make DB available to the Discord bot
        console.log('✅ Connected to MongoDB Atlas');

        // 2. Turn on the Discord Bot
        require('./bot/bot');

        // 3. Setup Sessions
        app.use(session({ 
            secret: process.env.SESSION_SECRET || 'fallback_secret',
            resave: false, saveUninitialized: false, 
            store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
            cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 } 
        }));

        // 4. Load Routes
        app.use('/auth', require('./routes/auth')(db));

        // 5. Page Routes
        app.get('/dashboard', (req, res) => {
            if (!req.session.user) return res.redirect('/');
            res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
        });

        app.get('/api/me', (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
            res.json(req.session.user);
        });

        // 6. Directory API
        app.get('/api/directory', async (req, res) => {
            if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
            const users = await db.collection('users').find().sort({ rank_level: -1, username: 1 }).toArray();
            res.json(users);
        });

        // 7. Management API (Promote/Suspend)
        app.post('/api/management/action', async (req, res) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management+ Only' });
            
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
                const bot = require('./bot/bot'); // Import bot to use its client
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
                } else if (action === 'Reinstate') {
                    await db.collection('users').updateOne({ id: targetId }, { $set: { status: 'Active' } });
                }
                res.json({ success: true });
            } catch (error) { 
                console.error(error);
                res.status(500).json({ error: 'Discord Action Failed. Check bot permissions.' }); 
            }
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web Server running on port ${PORT}`));

    } catch (error) {
        console.error('❌ Fatal Startup Error:', error);
        process.exit(1);
    }
}
startServer();