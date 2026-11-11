require('dotenv').config();
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
let db;

async function connectDB() {
    if (db) return db;
    try {
        const client = new MongoClient(uri);
        await client.connect();
        console.log('✅ Connected to MongoDB Atlas');
        db = client.db('lcdot'); // Use the database name you set in the URI
        
        // Create unique indexes to prevent duplicate entries
        await db.collection('users').createIndex({ id: 1 }, { unique: true });
        await db.collection('shifts').createIndex({ user_id: 1, status: 1 });
        
        return db;
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1); // Exit if DB connection fails
    }
}

// Export a function to get the database instance
module.exports = { connectDB };