const path = require('path');

// This forces Node to look exactly two folders up from this file's location
const envPath = path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const express = require('express');
const apiRouter = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/v1', apiRouter);

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'API is running' });
});

app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
    console.log(`🔍 Checking env variables... PORT is set to: ${process.env.PORT ? process.env.PORT : 'MISSING'}`);
    console.log(`🔍 Checking DB... DB_USER is set to: ${process.env.DB_USER ? process.env.DB_USER : 'MISSING'}`);
});