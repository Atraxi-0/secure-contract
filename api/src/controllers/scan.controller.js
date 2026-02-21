"use strict";

require("dotenv").config({ path: "../../.env" });

const { createClient } = require("redis");

const redisConfig = {
  socket: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
  },
};

const { Pool } = require("pg");
const { contractAnalysisQueue } = require("../config/queue");

// ---------------------------------------------------------------------------
// DB pool — uses port 5433 per project spec
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// DB pool — Corrected to match your .env file
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  database: process.env.DB_NAME || "scans",
  user: process.env.DB_USER || "app",
  password: process.env.DB_PASSWORD || "app",
});

// Hackathon Trick: Auto-create the table when the server starts so you don't
// have to do manual database migrations right now.
pool
  .query(
    `
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
`,
  )
  .then(() => console.log("✅ Database Table 'scans' is verified and ready!"))
  .catch((err) => console.error("❌ DB Setup Error:", err));
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
    const { ethers } = require("ethers");
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
    const contractAddress =
      req.body.contractAddress || req.body.contract_address;

    // --- Validation ---
    if (!contractAddress) {
      return res.status(400).json({
        error: "Missing required field: contractAddress",
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
      [contractAddress.toLowerCase()],
    );

    const scanId = insertResult.rows[0].id;

    // --- Enqueue analysis job ---
    // The job payload is intentionally minimal; workers pull full data from DB.
    await contractAnalysisQueue.add(
      "analyse-contract",
      {
        scanId,
        contractAddress: contractAddress.toLowerCase(),
      },
      {
        // Use scanId as a unique job identifier to prevent duplicate queuing
        jobId: scanId,
      },
    );
    return res.status(200).json({
      id: scanId, // <-- The magic fix!
      contract_address: contractAddress.toLowerCase(),
      status: "pending",
      results: {},
      narration_log: [],
      final_score: null,
      streamUrl: `/api/v1/scans/${scanId}/stream`,
    });
  } catch (err) {
    console.error("[startScan] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error." });
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
      return res.status(400).json({ error: "Invalid scan ID format." });
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
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: `Scan not found: ${id}` });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("[getScanStatus] Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}

/**
 * GET /api/v1/scans/:id/stream
 * Sets up a Server-Sent Events (SSE) connection for the Next.js frontend.
 */
async function streamScanStatus(req, res) {
  const { id: scanId } = req.params;

  // 1. Set the strict SSE headers required by Next.js
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const subscriber = createClient(redisConfig);

  try {
    await subscriber.connect();
  } catch (err) {
    console.error("[SSE] Redis connect error:", err);
    res.write(
      `data: ${JSON.stringify({ type: "error", data: { message: "Stream unavailable." } })}\n\n`,
    );
    return res.end();
  }

  const channel = `scan:${scanId}:updates`;

  // 2. Tell the UI we successfully connected
  res.write(
    `data: ${JSON.stringify({ type: "status", data: { status: "connected" } })}\n\n`,
  );

  // 3. THE DUMB PIPE: The worker formatted the JSON perfectly, just pass it directly to the UI!
  await subscriber.subscribe(channel, (message) => {
    res.write(`data: ${message}\n\n`);

    try {
      const parsed = JSON.parse(message);
      // Close the internal stream connection if the scan is fully done
      if (parsed.type === "complete" && parsed.data?.status === "completed") {
        cleanup("Scan completed successfully");
      }
    } catch (e) {
      // Ignore parse errors, just keep streaming
    }
  });

  // Keep-alive ping so the browser doesn't drop the connection
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20000);

  let cleaned = false;
  async function cleanup(reason) {
    if (cleaned) return;
    cleaned = true;
    console.log(`[SSE] Closing stream for scan ${scanId} — ${reason}`);
    clearInterval(keepAlive);
    try {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    } catch (e) {}
    res.end();
  }

  // Clean up if the user closes their browser tab early
  req.on("close", () => cleanup("Client disconnected"));
}

module.exports = { startScan, getScanStatus, streamScanStatus };
