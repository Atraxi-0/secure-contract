const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// We'll use the environment variables or fall back to 'app'
const pool = new Pool({
  user: process.env.DB_USER || 'app',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'scans',
  password: process.env.DB_PASSWORD || 'app',
  port: process.env.DB_PORT || 5432,
});

router.get('/', async (req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW()');
    res.json({
      status: 'UP',
      database: 'connected',
      serverTime: dbResult.rows[0].now
    });
  } catch (err) {
    res.status(500).json({
      status: 'DOWN',
      error: err.message,
      hint: "Check if your .env file is in the root folder and has DB_PASSWORD=app"
    });
  }
});

module.exports = router;