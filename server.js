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

        // Create Indexes for New Features
        await db.collection('users').createIndex({ id: 1 }, { unique: true });
        await db.collection('applications').createIndex({ appId: 1 }, { unique: true });
        await db.collection('dockets').createIndex({ title: 1 });
        console.log('✅ Database schema initialized.');

        require('./bot/bot');

        app.use(session({ 
            secret: process.env.SESSION_SECRET || 'fallback_secret',
            resave: false, saveUninitialized: false, 
            store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
            cookie: { secure: true, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 } 
        }));

        app.use('/auth', require('./routes/auth')(db));

        const requireAuth = (req, res, next) => {
            if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
            next();
        };

        const requireManagement = (req, res, next) => {
            if (!req.session.user || req.session.user.rankLevel < 7) return res.status(403).json({ error: 'Management access required.' });
            next();
        };

        // --- API ROUTES ---
        app.get('/api/health', (req, res) => res.send('OK'));
        app.get('/dashboard', (req, res) => { if (!req.session.user) return res.redirect('/'); res.sendFile(path.join(__dirname, 'public', 'dashboard.html')); });
        app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user));

        app.get('/api/profile', requireAuth, async (req, res) => {
            const user = await db.collection('users').findOne({ id: req.session.user.id });
            res.json({ user });
        });

        // APPLICATIONS API
        app.get('/api/applications', requireManagement, async (req, res) => {
            const apps = await db.collection('applications').find({ status: 'Pending' }).sort({ submittedAt: 1 }).toArray();
            res.json(apps);
        });

        app.post('/api/applications/:id/status', requireManagement, async (req, res) => {
            const { status } = req.body; // Approved or Denied
            await db.collection('applications').updateOne(
                { appId: req.params.id },
                { $set: { status, reviewedBy: req.session.user.username, reviewedAt: new Date() } }
            );
            res.json({ success: true });
        });

        // DOCKETS API
        app.get('/api/dockets', requireAuth, async (req, res) => {
            const dockets = await db.collection('dockets').find().toArray();
            res.json(dockets);
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => console.log(`✅ Web Server running on port ${PORT}`));

    } catch (error) {
        console.error('❌ Fatal Startup Error:', error);
        process.exit(1);
    }
}
startServer();