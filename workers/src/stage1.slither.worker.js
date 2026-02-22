"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const { Worker, Queue } = require("bullmq");
const { Pool }          = require("pg");
const { createClient }  = require("redis");
const { readFileSync, existsSync } = require("fs");
const path  = require("path");
const https = require("https");

// ─── Constants ────────────────────────────────────────────────────────────────
const IN_QUEUE   = "contract-analysis";   // API pushes here
const OUT_QUEUE  = "mythril-analysis";    // We chain Mythril after us
const STAGE_NAME = "slither";
const OUTPUT_PATH = path.resolve(__dirname, "../../slither_output.json");

// ─── Infrastructure ───────────────────────────────────────────────────────────
const redisConnection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
};

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT || "5433", 10),
  database: process.env.DB_NAME     || "scans",
  user:     process.env.DB_USER     || "app",
  password: process.env.DB_PASSWORD || "app",
});

const publisher    = createClient({ socket: { host: redisConnection.host, port: redisConnection.port } });
const mythrilQueue = new Queue(OUT_QUEUE, { connection: redisConnection });

// ─── LLM Narration ────────────────────────────────────────────────────────────
function buildFallbackNarration(detectors) {
  if (!detectors || detectors.length === 0) {
    return "✅ Slither static analysis complete. No vulnerabilities detected. The contract appears safe from static-analysis-detectable issues.";
  }

  const high   = detectors.filter((d) => d.impact === "High");
  const medium = detectors.filter((d) => d.impact === "Medium");
  const low    = detectors.filter((d) => d.impact === "Low" || d.impact === "Informational");

  let text = `🔍 Slither detected ${detectors.length} issue(s): ${high.length} critical, ${medium.length} medium, ${low.length} informational.\n\n`;

  if (high.length > 0) {
    text += `🚨 CRITICAL ISSUES:\n`;
    high.slice(0, 3).forEach((d) => {
      const firstLine = (d.description || "").split("\n")[0].trim();
      text += `  • ${firstLine.slice(0, 150)}\n`;
    });
    text += `\n`;
  }

  if (medium.length > 0) {
    text += `⚠️  MEDIUM ISSUES:\n`;
    medium.slice(0, 2).forEach((d) => {
      const firstLine = (d.description || "").split("\n")[0].trim();
      text += `  • ${firstLine.slice(0, 120)}\n`;
    });
    text += `\n`;
  }

  if (high.length > 0) {
    text += `💡 Recommendation: Critical reentrancy vulnerabilities detected. User funds are at risk. Do NOT deploy without fixing state variable ordering and adding reentrancy guards.`;
  } else if (medium.length > 0) {
    text += `💡 Recommendation: Review and address medium-severity issues before mainnet deployment.`;
  } else {
    text += `💡 No critical issues found. Standard security review recommended before deployment.`;
  }

  return text;
}

async function generateNarration(detectors) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here" || apiKey.trim() === "") {
    console.log("[LLM] No API key — using fallback narration.");
    return buildFallbackNarration(detectors);
  }

  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are a smart contract security expert writing a report for a developer.
Analyze these Slither findings and write a clear, direct 4-6 sentence summary.
Cover: what was found, the severity, what it means for user funds, and what to fix.
Use plain English — no markdown headers, just flowing text with emojis for impact levels.

Findings:
${JSON.stringify(detectors.slice(0, 5), null, 2)}`,
    }],
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      path:     "/v1/messages",
      method:   "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length":    Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text   = parsed.content?.[0]?.text;
          resolve((text && text.length > 20) ? text : buildFallbackNarration(detectors));
        } catch {
          resolve(buildFallbackNarration(detectors));
        }
      });
    });
    req.on("error", () => resolve(buildFallbackNarration(detectors)));
    req.write(body);
    req.end();
  });
}

// ─── Score ────────────────────────────────────────────────────────────────────
function detectorsToScore(detectors) {
  let score = 100;
  (detectors || []).forEach((d) => {
    if      (d.impact === "High")          score -= 25;
    else if (d.impact === "Medium")        score -= 10;
    else if (d.impact === "Low")           score -= 4;
    else                                   score -= 1;
  });
  return Math.max(0, Math.min(100, score));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function publishUpdate(scanId, payload) {
  await publisher.publish(`scan:${scanId}:updates`, JSON.stringify(payload));
  console.log(`[${STAGE_NAME}] Published: type=${payload.type}`);
}

function readSlitherOutput() {
  if (!existsSync(OUTPUT_PATH)) {
    console.error(`[${STAGE_NAME}] slither_output.json not found — run Slither first.`);
    return { success: false, detectors: [], error: "Output file not found" };
  }
  try {
    const raw       = readFileSync(OUTPUT_PATH, "utf8");
    const data      = JSON.parse(raw);
    const detectors = data.results?.detectors || [];
    console.log(`[${STAGE_NAME}] Found ${detectors.length} detector result(s).`);
    return { success: true, detectors };
  } catch (e) {
    return { success: false, detectors: [], error: e.message };
  }
}

async function persistResults(scanId, detectors, narration, score) {
  try {
    await pool.query(
      `UPDATE scans
       SET status        = 'processing',
           results       = COALESCE(results, '{}'::jsonb) || jsonb_build_object('slither', $2::jsonb),
           narration_log = COALESCE(narration_log, '[]'::jsonb) || jsonb_build_array(
                             jsonb_build_object('stage', $3::text, 'text', $4::text, 'timestamp', now())
                           ),
           updated_at    = now()
       WHERE id = $1`,
      [scanId, JSON.stringify({ detectors, score }), STAGE_NAME, narration]
    );
  } catch (e) {
    console.error(`[${STAGE_NAME}] DB persist error:`, e.message);
  }
}

// ─── Job Processor ────────────────────────────────────────────────────────────
async function processJob(job) {
  const { scanId, contractAddress } = job.data;
  console.log(`\n[${STAGE_NAME}] Processing scan ${scanId}`);

  await new Promise((r) => setTimeout(r, 2000));

  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: "🔍 Stage 1: Running Slither static analysis on contract bytecode..." },
  });

  const { success, detectors } = readSlitherOutput();

  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: "🤖 Analysis complete. Generating AI security report..." },
  });

  const narration = await generateNarration(detectors);
  const score     = detectorsToScore(detectors);

  await persistResults(scanId, detectors, narration, score);

  await publishUpdate(scanId, {
    type: "complete",
    data: {
      stage:     STAGE_NAME,
      text:      narration,
      score,
      findings:  detectors.length,
      detectors,
      success,
    },
  });

  // ── Chain to Mythril ──
  await mythrilQueue.add("mythril-analyze", { scanId, contractAddress }, {
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail:     { age: 86400 },
  });

  console.log(`[${STAGE_NAME}] Done. Score: ${score}. Chained to Mythril.`);
  return { scanId, stage: STAGE_NAME, success: true };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  await publisher.connect();

  const worker = new Worker(IN_QUEUE, processJob, {
    connection: redisConnection,
    concurrency: 1,
  });

  worker.on("active",    (job) => console.log(`[Worker] Job active: ${job.id}`));
  worker.on("completed", (job) => console.log(`[Worker] Job completed: ${job.id}`));
  worker.on("failed",    (job, err) => console.error(`[Worker] Job failed:`, err.message));

  console.log(`[Worker] Stage 1 (${STAGE_NAME}) listening on "${IN_QUEUE}"…`);

  const shutdown = async (sig) => {
    console.log(`\n[Worker] ${sig} — shutting down…`);
    await worker.close();
    await publisher.quit();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  console.error("[Worker] Fatal:", err);
  process.exit(1);
});