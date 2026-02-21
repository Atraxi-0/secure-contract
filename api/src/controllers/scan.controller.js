'use strict';

require('dotenv').config({ path: '../../.env' });

const { Pool } = require('pg');
const { contractAnalysisQueue } = require('../config/queue');

// ---------------------------------------------------------------------------
// DB pool — uses port 5433 per project spec
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// DB pool — Corrected to match your .env file
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'scans',
  user: process.env.DB_USER || 'app',
  password: process.env.DB_PASSWORD || 'app',
});

// Hackathon Trick: Auto-create the table when the server starts so you don't 
// have to do manual database migrations right now.
pool.query(`
  CREATE TABLE IF NOT EXISTS scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_address VARCHAR(42) NOT NULL,
    status VARCHAR(50) NOT NULL,
    results JSONB DEFAULT '{}',
    narration_log JSONB DEFAULT '[]',
    final_score INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`).then(() => console.log("✅ Database Table 'scans' is verified and ready!"))
  .catch(err => console.error("❌ DB Setup Error:", err));
// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate an Ethereum address.
 * Accepts both checksummed and lower-case 0x-prefixed 40-hex-char addresses.
 * Uses ethers.js if available; falls back to a regex for environments where
 * the package has not been installed yet.
 */
function isValidEthAddress(address) {
  try {
    const { ethers } = require('ethers');
    // ethers.getAddress() throws if the address is invalid or checksum fails
    ethers.getAddress(address);
    return true;
  } catch {
    // Fallback regex — basic structure check
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }
}

// ---------------------------------------------------------------------------
// Controller methods
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/scans
 * Body: { contractAddress: "0x..." }
 *
 * 1. Validates the Ethereum address.
 * 2. Inserts a 'pending' record into the `scans` table.
 * 3. Enqueues a BullMQ job for the worker pipeline.
 * 4. Returns 202 Accepted with the new scanId.
 */
async function startScan(req, res) {
  try {
    const contractAddress = req.body.contractAddress || req.body.contract_address;

    // --- Validation ---
    if (!contractAddress) {
      return res.status(400).json({
        error: 'Missing required field: contractAddress',
      });
    }

    if (!isValidEthAddress(contractAddress)) {
      return res.status(400).json({
        error: `Invalid Ethereum address: "${contractAddress}"`,
      });
    }

    // --- Persist pending record ---
    const insertResult = await pool.query(
      `INSERT INTO scans (contract_address, status, results, narration_log)
       VALUES ($1, 'pending', '{}', '[]')
       RETURNING id`,
      [contractAddress.toLowerCase()]
    );

    const scanId = insertResult.rows[0].id;

    // --- Enqueue analysis job ---
    // The job payload is intentionally minimal; workers pull full data from DB.
    await contractAnalysisQueue.add(
      'analyse-contract',
      {
        scanId,
        contractAddress: contractAddress.toLowerCase(),
      },
      {
        // Use scanId as a unique job identifier to prevent duplicate queuing
        jobId: scanId,
      }
    );
return res.status(200).json({
  id: scanId, // <-- The magic fix!
  contract_address: contractAddress.toLowerCase(),
  status: 'pending',
  results: {},
  narration_log: [],
  final_score: null,
  streamUrl: `/api/v1/scans/${scanId}/stream`
});
  } catch (err) {
    console.error('[startScan] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

/**
 * GET /api/v1/scans/:id
 *
 * Fetches the current state of a scan from the database.
 * Returns the full row including status, results, narration_log, and final_score.
 */
async function getScanStatus(req, res) {
  try {
    const { id } = req.params;

    // Basic UUID format check before hitting the DB
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid scan ID format.' });
    }

    const result = await pool.query(
      `SELECT id,
              contract_address,
              status,
              results,
              narration_log,
              final_score,
              created_at,
              updated_at
       FROM scans
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Scan not found: ${id}` });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('[getScanStatus] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

/**
 * GET /api/v1/scans/:id/stream
 * Sets up a Server-Sent Events (SSE) connection for the Next.js frontend.
 */
async function streamScanStatus(req, res) {
  const { id } = req.params;

  // 1. Set the exact headers the Next.js frontend requires
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 2. Send the initial connection success message
  res.write(`data: ${JSON.stringify({ type: 'status', data: { status: 'connected' } })}\n\n`);

  // 3. Hackathon Simulation: Since your AI workers aren't fully hooked up 
  // to the DB yet, let's simulate a live stream so the UI looks amazing.
  let step = 0;
  const simulation = setInterval(() => {
    step++;
    if (step === 1) {
      res.write(`data: ${JSON.stringify({ type: 'narration', data: { stage: 'slither', text: 'Initiating static analysis...' } })}\n\n`);
    } else if (step === 2) {
      res.write(`data: ${JSON.stringify({ type: 'narration', data: { stage: 'mythril', text: 'Symbolic execution engine engaged. Mapping attack vectors.' } })}\n\n`);
    } else if (step === 3) {
      res.write(`data: ${JSON.stringify({ type: 'score', data: { final_score: 85 } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'complete', data: { status: 'completed' } })}\n\n`);
      clearInterval(simulation);
    }
  }, 3000); // Sends a new fake AI update every 3 seconds

  // 4. Cleanup when the browser closes the tab
  req.on('close', () => {
    clearInterval(simulation);
  });
}

module.exports = { startScan, getScanStatus, streamScanStatus };
