const path = require('path');
const cors = require('cors');

// 1. Force Node to find your .env file in the root folder
const envPath = path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const express = require('express');
const apiRouter = require('./routes'); // Make sure this points to your routes folder

const app = express();
const PORT = process.env.PORT || 3000;

// 2. CRITICAL FOR FRONTEND: Allow Next.js (Port 3001) to talk to this API
app.use(cors({
    origin: 'http://localhost:3001',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

// 3. Middleware to parse JSON bodies
app.use(express.json());

// 4. Mount the routes
app.use('/api/v1', apiRouter);

// 5. Basic Health Check Route (Your teammate's UI looks for this!)
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        postgres: 'connected', 
        redis: 'connected' 
    });
});

// 6. Start the server
app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
    console.log(`🔍 Checking DB... DB_USER is set to: ${process.env.DB_USER ? process.env.DB_USER : 'MISSING'}`);
});