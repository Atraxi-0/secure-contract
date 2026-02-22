"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const { Worker } = require("bullmq");
const { Pool } = require("pg");
const { createClient } = require("redis");
const { readFileSync, existsSync } = require("fs");
const path = require("path");
const https = require("https");

// ─── Constants ────────────────────────────────────────────────────────────────
const QUEUE_NAME = "contract-analysis";
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

const publisher = createClient({
  socket: { host: redisConnection.host, port: redisConnection.port },
});

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
    text += `💡 Recommendation: This contract has critical reentrancy vulnerabilities. User funds are at risk. Do NOT deploy without fixing state variable ordering and adding reentrancy guards.`;
  } else if (medium.length > 0) {
    text += `💡 Recommendation: Review and address medium-severity issues before mainnet deployment.`;
  } else {
    text += `💡 No critical issues found. Standard security review recommended before deployment.`;
  }

  return text;
}

async function generateNarration(detectors) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Use fallback if no real key
  if (!apiKey || apiKey === "your_key_here" || apiKey.trim() === "") {
    console.log("[LLM] No API key — using fallback narration.");
    return buildFallbackNarration(detectors);
  }

  console.log("[LLM] Calling Anthropic API...");

  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are a smart contract security expert writing a report for a developer.
Analyze these Slither findings and write a clear, direct 4-6 sentence summary.
Cover: what was found, the severity, what it means for user funds, and what to fix.
Use plain English — no markdown headers, just flowing text with emojis for impact levels.

Findings:
${JSON.stringify(detectors.slice(0, 5), null, 2)}`,
      },
    ],
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content?.[0]?.text;
            if (text && text.length > 20) {
              console.log("[LLM] Narration received from Anthropic.");
              resolve(text);
            } else {
              console.log("[LLM] Empty response — using fallback.");
              resolve(buildFallbackNarration(detectors));
            }
          } catch (e) {
            console.error("[LLM] Parse error:", e.message);
            resolve(buildFallbackNarration(detectors));
          }
        });
      }
    );
    req.on("error", (e) => {
      console.error("[LLM] Request error:", e.message);
      resolve(buildFallbackNarration(detectors));
    });
    req.write(body);
    req.end();
  });
}

// ─── Score calculation ────────────────────────────────────────────────────────
function detectorsToScore(detectors) {
  let score = 100;
  (detectors || []).forEach((d) => {
    if      (d.impact === "High")          score -= 25;
    else if (d.impact === "Medium")        score -= 10;
    else if (d.impact === "Low")           score -= 4;
    else                                   score -= 1;   // Informational
  });
  return Math.max(0, Math.min(100, score));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function publishUpdate(scanId, payload) {
  const channel = `scan:${scanId}:updates`;
  await publisher.publish(channel, JSON.stringify(payload));
  console.log(`[${STAGE_NAME}] Published: type=${payload.type}`);
}

function readSlitherOutput() {
  console.log(`[${STAGE_NAME}] Reading: ${OUTPUT_PATH}`);
  if (!existsSync(OUTPUT_PATH)) {
    console.error(`[${STAGE_NAME}] slither_output.json not found!`);
    console.error(`[${STAGE_NAME}] Run: py -3.11 -m slither contracts/target.sol --json slither_output.json`);
    return { success: false, detectors: [], error: "Output file not found" };
  }
  try {
    const raw  = readFileSync(OUTPUT_PATH, "utf8");
    const data = JSON.parse(raw);
    const detectors = data.results?.detectors || [];
    console.log(`[${STAGE_NAME}] Found ${detectors.length} detector result(s).`);
    return { success: true, detectors, raw };
  } catch (e) {
    console.error(`[${STAGE_NAME}] Failed to parse output:`, e.message);
    return { success: false, detectors: [], error: e.message };
  }
}

async function persistResults(scanId, detectors, narration) {
  try {
    await pool.query(
      `UPDATE scans
       SET status        = 'completed',
           results       = COALESCE(results, '{}'::jsonb) || jsonb_build_object('slither', $2::jsonb),
           narration_log = COALESCE(narration_log, '[]'::jsonb) || jsonb_build_array(
                             jsonb_build_object('stage', $3::text, 'text', $4::text, 'timestamp', now())
                           ),
           updated_at    = now()
       WHERE id = $1`,
      [scanId, JSON.stringify({ detectors }), STAGE_NAME, narration]
    );
  } catch (e) {
    console.error(`[${STAGE_NAME}] DB persist error:`, e.message);
  }
}

// ─── Job processor ────────────────────────────────────────────────────────────
async function processJob(job) {
  const { scanId } = job.data;
  console.log(`\n[${STAGE_NAME}] Processing scan ${scanId}`);

  // 1. Wait for SSE to connect
  await new Promise((r) => setTimeout(r, 2000));

  // 2. Progress update — analysis starting
  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: "🔍 Stage 1: Running Slither static analysis on contract bytecode..." },
  });

  // 3. Read findings
  const { success, detectors } = readSlitherOutput();

  // 4. Progress update — generating narration
  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: "🤖 Analysis complete. Generating AI security report..." },
  });

  // 5. Generate narration via Anthropic (or fallback)
  const narration = await generateNarration(detectors);

  // 6. Calculate risk score
  const score = detectorsToScore(detectors);

  // 7. Save to DB
  await persistResults(scanId, detectors, narration);

  // 8. Send COMPLETE with all data the frontend needs:
  //    - narration: the full LLM text (shown in feed)
  //    - detectors: raw array (frontend can use for its own processing)
  //    - score: computed risk score (drives the gauge needle)
  //    - findings: count (for display)
  await publishUpdate(scanId, {
    type: "complete",
    data: {
      stage:     STAGE_NAME,
      text:      narration,          // non-empty → frontend shows this directly
      score:     score,              // drives gauge
      findings:  detectors.length,   // count
      detectors: detectors,          // raw data
      success:   success,
    },
  });

  // 9. Send final verdict to close the scan on the frontend
  await new Promise((r) => setTimeout(r, 500));
  await publishUpdate(scanId, {
    type: "complete",
    data: {
      status: "completed",           // triggers frontend finalVerdictHandler
      stage:  "final-verdict",
      score:  score,
    },
  });

  console.log(`[${STAGE_NAME}] Done. Score: ${score}. Findings: ${detectors.length}.`);
  return { scanId, stage: STAGE_NAME, success: true };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  await publisher.connect();
  console.log("[Worker] Redis publisher connected.");

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: redisConnection,
    concurrency: 1,
  });

  worker.on("active",    (job) => console.log(`[Worker] Job active: ${job.id}`));
  worker.on("completed", (job) => console.log(`[Worker] Job completed: ${job.id}`));
  worker.on("failed",    (job, err) => console.error(`[Worker] Job failed:`, err.message));

  console.log(`[Worker] Stage 1 (${STAGE_NAME}) listening on "${QUEUE_NAME}"…`);

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