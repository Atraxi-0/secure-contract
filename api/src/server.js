"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const express    = require("express");
const cors       = require("cors");
const { v4: uuidv4 } = require("uuid");
const { Pool }   = require("pg");
const { Queue }  = require("bullmq");
const { createClient } = require("redis");

// ─── App & Config ─────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

const redisConnection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
};

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: "*",                          // dev open; lock down in prod
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// ─── PostgreSQL ───────────────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT || "5433", 10),
  database: process.env.DB_NAME     || "scans",
  user:     process.env.DB_USER     || "app",
  password: process.env.DB_PASSWORD || "app",
});

// ─── BullMQ Queue ─────────────────────────────────────────────────────────────
const analysisQueue = new Queue("contract-analysis", {
  connection: redisConnection,
});

// ─── Redis Subscriber factory ─────────────────────────────────────────────────
// Each SSE connection gets its own subscriber client (Redis requires a dedicated
// client per subscription).
function createSubscriber() {
  return createClient({
    socket: { host: redisConnection.host, port: redisConnection.port },
  });
}

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function createScan(contractAddress) {
  const id = uuidv4();
  await pool.query(
    `INSERT INTO scans (id, contract_address, status, results, narration_log, created_at, updated_at)
     VALUES ($1, $2, 'pending', '{}'::jsonb, '[]'::jsonb, now(), now())`,
    [id, contractAddress]
  );
  return id;
}

async function getScan(id) {
  const { rows } = await pool.query(
    `SELECT id, contract_address, status, results, narration_log, final_score, created_at, updated_at
     FROM scans WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────
function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseKeepAlive(res) {
  res.write(": keep-alive\n\n");
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /health
app.get("/health", async (req, res) => {
  const health = { status: "ok", services: {} };

  // PostgreSQL
  try {
    await pool.query("SELECT 1");
    health.services.postgres = { status: "ok", port: process.env.DB_PORT || 5433 };
  } catch (e) {
    health.services.postgres = { status: "error", error: e.message };
    health.status = "degraded";
  }

  // Redis
  const testRedis = createClient({ socket: { host: redisConnection.host, port: redisConnection.port } });
  try {
    await testRedis.connect();
    await testRedis.ping();
    health.services.redis = { status: "ok", port: redisConnection.port };
    await testRedis.quit();
  } catch (e) {
    health.services.redis = { status: "error", error: e.message };
    health.status = "degraded";
  }

  res.status(health.status === "ok" ? 200 : 503).json(health);
});

// POST /api/v1/scans  — start a new scan
app.post("/api/v1/scans", async (req, res) => {
  const { contractAddress } = req.body;

  if (!contractAddress) {
    return res.status(400).json({ error: "contractAddress is required." });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    return res.status(400).json({ error: "Invalid Ethereum address format." });
  }

  try {
    const scanId = await createScan(contractAddress);

    // Push job — Stage 1 (Slither) worker picks this up
    await analysisQueue.add(
      "analyze",
      { scanId, contractAddress },
      {
        jobId:    scanId,           // idempotent — same scanId = same job
        attempts: 1,
        removeOnComplete: { age: 3600 },
        removeOnFail:     { age: 86400 },
      }
    );

    console.log(`[API] Scan created: ${scanId} for ${contractAddress}`);

    return res.status(201).json({
      id:              scanId,
      contractAddress,
      status:          "pending",
      streamUrl:       `/api/v1/scans/${scanId}/stream`,
      createdAt:       new Date().toISOString(),
    });
  } catch (e) {
    console.error("[API] POST /scans error:", e.message);
    return res.status(500).json({ error: "Failed to create scan.", detail: e.message });
  }
});

// GET /api/v1/scans/:id  — fetch current scan state
app.get("/api/v1/scans/:id", async (req, res) => {
  try {
    const scan = await getScan(req.params.id);
    if (!scan) return res.status(404).json({ error: "Scan not found." });
    return res.json(scan);
  } catch (e) {
    console.error("[API] GET /scans/:id error:", e.message);
    return res.status(500).json({ error: "Failed to fetch scan.", detail: e.message });
  }
});

// GET /api/v1/scans/:id/stream  — SSE real-time narration stream
app.get("/api/v1/scans/:id/stream", async (req, res) => {
  const { id: scanId } = req.params;

  // Validate scan exists
  let scan;
  try {
    scan = await getScan(scanId);
    if (!scan) {
      return res.status(404).json({ error: "Scan not found." });
    }
  } catch (e) {
    return res.status(500).json({ error: "DB error.", detail: e.message });
  }

  // SSE headers
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");  // disable Nginx buffering
  res.flushHeaders();

  console.log(`[SSE] Client connected for scan ${scanId}`);

  // Immediately replay any existing narration_log entries
  // (handles page refresh mid-scan)
  if (scan.narration_log && scan.narration_log.length > 0) {
    for (const entry of scan.narration_log) {
      sseWrite(res, {
        type: "narration",
        data: { stage: entry.stage, text: entry.text, replayed: true },
      });
    }
  }

  // If scan is already completed, send final event and close
  if (scan.status === "completed") {
    sseWrite(res, {
      type: "complete",
      data: {
        stage:  "final-verdict",
        status: "completed",
        score:  scan.final_score,
        text:   "Analysis already complete. See results above.",
      },
    });
    return res.end();
  }

  // Acknowledge connection
  sseWrite(res, {
    type: "status",
    data: { status: "connected", scanId },
  });

  // Subscribe to Redis channel for live updates from workers
  const channel    = `scan:${scanId}:updates`;
  const subscriber = createSubscriber();

  let keepAliveTimer;

  const cleanup = async () => {
    clearInterval(keepAliveTimer);
    try {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    } catch (_) {}
    console.log(`[SSE] Client disconnected for scan ${scanId}`);
  };

  try {
    await subscriber.connect();

    await subscriber.subscribe(channel, (message) => {
      let parsed;
      try { parsed = JSON.parse(message); } catch { return; }

      // Forward to SSE client
      sseWrite(res, parsed);

      // If this is the final stage completing, close the stream gracefully
      if (
        parsed.type === "complete" &&
        (parsed.data?.stage === "forge" ||
         parsed.data?.stage === "final-verdict" ||
         parsed.data?.status === "completed")
      ) {
        setTimeout(async () => {
          await cleanup();
          res.end();
        }, 500);
      }
    });

    // Keep-alive ping every 25s (proxies drop idle SSE after 30s)
    keepAliveTimer = setInterval(() => {
      if (!res.writableEnded) {
        sseKeepAlive(res);
      }
    }, 25_000);

    // Clean up when client disconnects
    req.on("close", cleanup);

  } catch (e) {
    console.error(`[SSE] Subscriber error for ${scanId}:`, e.message);
    sseWrite(res, {
      type: "error",
      data: { message: "Stream connection failed." },
    });
    await cleanup();
    res.end();
  }
});

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   Secure-Contract API  — PORT ${PORT}   ║
╚══════════════════════════════════════╝

  POST  /api/v1/scans          — Start scan
  GET   /api/v1/scans/:id      — Get results
  GET   /api/v1/scans/:id/stream — SSE stream
  GET   /health                — Health check

  PostgreSQL : ${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 5433}
  Redis      : ${redisConnection.host}:${redisConnection.port}
  `);
});

module.exports = app;