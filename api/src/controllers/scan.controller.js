"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });

const { createClient } = require("redis");
const { Pool } = require("pg");
const { contractAnalysisQueue } = require("../config/queue");

// ─── Redis config ─────────────────────────────────────────────────────────────
const redisConfig = {
  socket: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
  },
};

// ─── Postgres pool — credentials pulled from .env ────────────────────────────
// .env has: DB_HOST=localhost, DB_PORT=5433, DB_USER=app, DB_PASSWORD=app, DB_NAME=scans
const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT || "5433", 10),
  database: process.env.DB_NAME     || "scans",
  user:     process.env.DB_USER     || "app",
  password: process.env.DB_PASSWORD || "app",
});

// Auto-create table on startup
pool.query(`
  CREATE TABLE IF NOT EXISTS scans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_address VARCHAR(42) NOT NULL,
    status           VARCHAR(50) NOT NULL DEFAULT 'pending',
    results          JSONB DEFAULT '{}',
    narration_log    JSONB DEFAULT '[]',
    final_score      INTEGER,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`)
  .then(() => console.log("✅ DB table 'scans' ready."))
  .catch((err) => console.error("❌ DB setup error:", err.message));

// ─── Validation ───────────────────────────────────────────────────────────────
function isValidEthAddress(address) {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

// ─── startScan ────────────────────────────────────────────────────────────────
async function startScan(req, res) {
  try {
    const contractAddress = req.body.contractAddress || req.body.contract_address;

    if (!contractAddress || !isValidEthAddress(contractAddress)) {
      return res.status(400).json({ error: "Invalid or missing Ethereum address." });
    }

    const insertResult = await pool.query(
      `INSERT INTO scans (contract_address, status, results, narration_log)
       VALUES ($1, 'pending', '{}', '[]')
       RETURNING id`,
      [contractAddress.toLowerCase()]
    );

    const scanId = insertResult.rows[0].id;

    await contractAnalysisQueue.add(
      "analyse-contract",
      { scanId, contractAddress: contractAddress.toLowerCase() },
      { jobId: scanId }
    );

    return res.status(200).json({
      id:               scanId,
      contract_address: contractAddress.toLowerCase(),
      status:           "pending",
      results:          {},
      narration_log:    [],
      final_score:      null,
      streamUrl:        `/api/v1/scans/${scanId}/stream`,
    });
  } catch (err) {
    console.error("[startScan] Error:", err.message);
    return res.status(500).json({ error: "Internal server error." });
  }
}

// ─── getScanStatus ────────────────────────────────────────────────────────────
async function getScanStatus(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(`SELECT * FROM scans WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Scan not found." });
    }
    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("[getScanStatus] Error:", err.message);
    return res.status(500).json({ error: "Internal server error." });
  }
}

// ─── streamScan ───────────────────────────────────────────────────────────────
async function streamScan(req, res) {
  const { id: scanId } = req.params;

  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Create a fresh Redis subscriber for this SSE connection
  const subscriber = createClient(redisConfig);

  try {
    await subscriber.connect();
  } catch (err) {
    console.error("[SSE] Redis connect error:", err.message);
    res.write(`data: ${JSON.stringify({ type: "error", data: { message: "Stream unavailable." } })}\n\n`);
    return res.end();
  }

  const channel = `scan:${scanId}:updates`;

  // Immediately tell the frontend the stream is live
  res.write(`data: ${JSON.stringify({ type: "status", data: { status: "connected" } })}\n\n`);

  // Dumb pipe — worker formats payloads, we just forward them
  await subscriber.subscribe(channel, (message) => {
    if (!res.writableEnded) {
      res.write(`data: ${message}\n\n`);
    }

    try {
      const parsed = JSON.parse(message);
      // Final verdict from Stage 3 closes the stream
      if (parsed.type === "complete" && parsed.data?.stage === "final-verdict") {
        cleanup("final-verdict received");
      }
    } catch (e) { /* ignore malformed messages */ }
  });

  // Keep-alive ping every 15s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15000);

  let cleaned = false;
  async function cleanup(reason) {
    if (cleaned) return;
    cleaned = true;
    console.log(`[SSE] Closing stream for scan ${scanId} — ${reason}`);
    clearInterval(keepAlive);
    try {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    } catch (e) { /* best-effort */ }
    if (!res.writableEnded) res.end();
  }

  req.on("close", () => cleanup("client disconnected"));
}

module.exports = { startScan, getScanStatus, streamScan };