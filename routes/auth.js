const express = require('express');
const axios = require('axios');
const router = express.Router();

module.exports = (db) => {
    router.get('/discord', (req, res) => {
        const scope = 'identify guilds.members.read';
        const redirectUri = encodeURIComponent(process.env.REDIRECT_URI || 'http://localhost:3000/auth/discord/callback');
        res.redirect(`https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`);
    });

    router.get('/discord/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) return res.redirect('/');
        
        const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3000/auth/discord/callback';
        
        try {
            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({ 
                client_id: process.env.CLIENT_ID, 
                client_secret: process.env.CLIENT_SECRET, 
                grant_type: 'authorization_code', 
                code, 
                redirect_uri: redirectUri 
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
            
            const accessToken = tokenResponse.data.access_token;
            const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
            
            let roles = [];
            try {
                const memberResponse = await axios.get(`https://discord.com/api/users/@me/guilds/${process.env.GUILD_ID}/member`, { headers: { Authorization: `Bearer ${accessToken}` } });
                roles = memberResponse.data.roles;
            } catch (error) { 
                return res.status(403).send("Access Denied. You must be in the Lakeview City DOT Discord server."); 
            }

            let rank = "Probationary", rankLevel = 0;
            if (roles.includes(process.env.ROLE_EXEC)) { rank = "Executive Board"; rankLevel = 8; }
            else if (roles.includes(process.env.ROLE_MGMT)) { rank = "Management Team"; rankLevel = 7; }
            else if (roles.includes(process.env.ROLE_FIELD)) { rank = "Field Supervisor"; rankLevel = 6; }
            else if (roles.includes(process.env.ROLE_CREW)) { rank = "Crew Supervisor"; rankLevel = 5; }
            else if (roles.includes(process.env.ROLE_SPECIALIST)) { rank = "Specialist"; rankLevel = 4; }
            else if (roles.includes(process.env.ROLE_SENIOR)) { rank = "Senior Operator"; rankLevel = 3; }
            else if (roles.includes(process.env.ROLE_OPERATOR)) { rank = "Operator"; rankLevel = 2; }
            else if (roles.includes(process.env.ROLE_JUNIOR)) { rank = "Junior Operator"; rankLevel = 1; }

            const avatarUrl = userResponse.data.avatar ? `https://cdn.discordapp.com/avatars/${userResponse.data.id}/${userResponse.data.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/0.png`;
            
            await db.collection('users').updateOne(
                { id: userResponse.data.id }, 
                { 
                    $set: { username: userResponse.data.username, rank, rank_level: rankLevel, avatar_url: avatarUrl, status: 'Active' }, 
                    $setOnInsert: { total_minutes: 0, weekly_minutes: 0, joined_at: new Date() } 
                }, 
                { upsert: true }
            );
            
            req.session.user = { id: userResponse.data.id, username: userResponse.data.username, rank, rankLevel, avatar_url: avatarUrl };
            res.redirect('/dashboard');
        } catch (error) { 
            console.error(error);
            res.status(500).send("Authentication Error."); 
        }
    });

    router.get('/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/');
    });

    return router;
};