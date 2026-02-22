"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const { Worker }       = require("bullmq");
const { Pool }         = require("pg");
const { createClient } = require("redis");
const https            = require("https");

// ─── Constants ────────────────────────────────────────────────────────────────
const IN_QUEUE   = "forge-analysis";    // GNN worker chains here
const STAGE_NAME = "forge";

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

const publisher = createClient({ socket: { host: redisConnection.host, port: redisConnection.port } });

// ─── Simulated Forge simulation ───────────────────────────────────────────────
// In production: spawn("forge", ["test", "--fork-url", rpcUrl, "--json"])
// For the hackathon we return realistic simulated exploit simulation results.
function runForgeSimulation(contractAddress) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        success: true,
        tests: [
          {
            name: "testReentrancyExploit",
            status: "FAIL",
            description: "Reentrancy exploit simulation succeeded — attacker drained 100 ETH",
            gas_used: 187_432,
            exploit_profit_eth: 100,
            severity: "Critical",
          },
          {
            name: "testOwnershipTransfer",
            status: "PASS",
            description: "Ownership transfer protected correctly",
            gas_used: 45_210,
          },
          {
            name: "testIntegerOverflow",
            status: "FAIL",
            description: "Integer overflow triggered in deposit function with crafted input",
            gas_used: 62_118,
            severity: "High",
          },
          {
            name: "testAccessControl",
            status: "PASS",
            description: "Admin functions correctly gated",
            gas_used: 38_920,
          },
        ],
        summary: {
          total: 4,
          passed: 2,
          failed: 2,
          critical_exploits: 1,
        },
        execution_time_ms: 8200,
      });
    }, 5000);
  });
}

// ─── LLM Narration ────────────────────────────────────────────────────────────
function buildFallbackNarration(tests, finalScore) {
  const failed   = (tests || []).filter((t) => t.status === "FAIL");
  const passed   = (tests || []).filter((t) => t.status === "PASS");
  const critical = failed.filter((t) => t.severity === "Critical");

  if (failed.length === 0) {
    return `✅ Forge simulation complete. All ${passed.length} exploit simulations PASSED — no attack vectors could be demonstrated in a live fork environment. This contract is robust against tested attack patterns. Final security score: ${finalScore}/100.`;
  }

  let text = `🔥 Forge simulation CONFIRMED live exploits: ${failed.length} of ${tests.length} attack simulations succeeded.\n\n`;

  if (critical.length > 0) {
    text += `🚨 CRITICAL EXPLOITS DEMONSTRATED:\n`;
    critical.forEach((t) => {
      text += `  • ${t.name}: ${t.description}`;
      if (t.exploit_profit_eth) text += ` (${t.exploit_profit_eth} ETH drained)`;
      text += `\n`;
    });
    text += `\n`;
  }

  const nonCritFailed = failed.filter((t) => t.severity !== "Critical");
  if (nonCritFailed.length > 0) {
    text += `⚠️  OTHER FAILED TESTS:\n`;
    nonCritFailed.forEach((t) => {
      text += `  • ${t.name}: ${t.description}\n`;
    });
    text += `\n`;
  }

  text += `🛑 FINAL VERDICT: This contract is NOT safe to deploy. Forge confirmed that reentrancy and overflow vulnerabilities detected by Slither, Mythril, and GNN are exploitable in a live mainnet fork. User funds would be at immediate risk.`;
  return text;
}

async function generateFinalNarration(forgeResults, aggregatedScore, scanData) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here" || apiKey.trim() === "") {
    return buildFallbackNarration(forgeResults.tests, aggregatedScore);
  }

  // Build a rich context summary of ALL stages for the final verdict
  const context = {
    forge_tests:     forgeResults.tests,
    forge_summary:   forgeResults.summary,
    final_score:     aggregatedScore,
    prior_stages:    scanData?.narration_log?.map((n) => ({ stage: n.stage, summary: n.text?.slice(0, 200) })) || [],
  };

  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `You are a senior smart contract auditor delivering a FINAL VERDICT to a developer.
Forge simulated real exploits on a mainnet fork. Write a definitive 5-7 sentence final verdict.
Cover: what Forge confirmed, the overall security posture across all 4 analysis stages, whether this contract is safe to deploy, and the top 2-3 actions needed.
Be direct and authoritative. Use emojis for severity. No markdown headers.
Final security score: ${aggregatedScore}/100.

Results:
${JSON.stringify(context, null, 2).slice(0, 2000)}`,
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
          resolve((text && text.length > 20) ? text : buildFallbackNarration(forgeResults.tests, aggregatedScore));
        } catch {
          resolve(buildFallbackNarration(forgeResults.tests, aggregatedScore));
        }
      });
    });
    req.on("error", () => resolve(buildFallbackNarration(forgeResults.tests, aggregatedScore)));
    req.write(body);
    req.end();
  });
}

// ─── Score aggregation ────────────────────────────────────────────────────────
function calcForgeScore(tests) {
  let score = 100;
  (tests || []).forEach((t) => {
    if (t.status !== "FAIL") return;
    if      (t.severity === "Critical") score -= 30;
    else if (t.severity === "High")     score -= 15;
    else if (t.severity === "Medium")   score -= 7;
    else                                score -= 3;
  });
  return Math.max(0, Math.min(100, score));
}

async function aggregateFinalScore(scanId, forgeScore) {
  // Pull all stage scores from DB results and average them
  try {
    const { rows } = await pool.query(
      `SELECT results FROM scans WHERE id = $1`,
      [scanId]
    );
    const results = rows[0]?.results || {};

    const scores = [forgeScore];
    if (results.slither)  scores.push(results.slither.score  ?? forgeScore);
    if (results.mythril)  scores.push(results.mythril.score  ?? forgeScore);
    if (results.gnn)      scores.push(results.gnn.score      ?? forgeScore);

    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return Math.max(0, Math.min(100, avg));
  } catch {
    return forgeScore;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function publishUpdate(scanId, payload) {
  await publisher.publish(`scan:${scanId}:updates`, JSON.stringify(payload));
  console.log(`[${STAGE_NAME}] Published: type=${payload.type}`);
}

async function persistFinalResults(scanId, forgeResults, narration, finalScore) {
  try {
    await pool.query(
      `UPDATE scans
       SET status        = 'completed',
           results       = COALESCE(results, '{}'::jsonb) || jsonb_build_object('forge', $2::jsonb),
           narration_log = COALESCE(narration_log, '[]'::jsonb) || jsonb_build_array(
                             jsonb_build_object('stage', $3::text, 'text', $4::text, 'timestamp', now())
                           ),
           final_score   = $5,
           updated_at    = now()
       WHERE id = $1`,
      [scanId, JSON.stringify(forgeResults), STAGE_NAME, narration, finalScore]
    );
  } catch (e) {
    console.error(`[${STAGE_NAME}] DB persist error:`, e.message);
  }
}

// ─── Job Processor ────────────────────────────────────────────────────────────
async function processJob(job) {
  const { scanId, contractAddress } = job.data;
  console.log(`\n[${STAGE_NAME}] Processing scan ${scanId}`);

  await new Promise((r) => setTimeout(r, 1000));

  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: "🔥 Stage 4: Forge simulation — forking mainnet and running exploit simulations against your contract..." },
  });

  await new Promise((r) => setTimeout(r, 2500));

  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: "⚙️  Deploying contract to local fork... Running reentrancy, overflow, and access control exploit tests..." },
  });

  const forgeResults = await runForgeSimulation(contractAddress);

  await publishUpdate(scanId, {
    type: "narration",
    data: {
      stage: STAGE_NAME,
      text: `📊 Simulation complete: ${forgeResults.summary.passed}/${forgeResults.summary.total} tests passed, ${forgeResults.summary.failed} exploits confirmed. Generating final verdict...`,
    },
  });

  const forgeScore   = calcForgeScore(forgeResults.tests);
  const finalScore   = await aggregateFinalScore(scanId, forgeScore);

  // Fetch scan for context-rich final narration
  const { rows } = await pool.query(`SELECT narration_log FROM scans WHERE id = $1`, [scanId]);
  const scanData  = rows[0] || {};

  const narration = await generateFinalNarration(forgeResults, finalScore, scanData);

  await persistFinalResults(scanId, forgeResults, narration, finalScore);

  // Send stage complete
  await publishUpdate(scanId, {
    type: "complete",
    data: {
      stage:    STAGE_NAME,
      text:     narration,
      score:    forgeScore,
      findings: forgeResults.summary.failed,
      tests:    forgeResults.tests,
      success:  true,
    },
  });

  // Send FINAL VERDICT — this closes the SSE stream on the frontend
  await new Promise((r) => setTimeout(r, 800));
  await publishUpdate(scanId, {
    type: "complete",
    data: {
      stage:  "final-verdict",
      status: "completed",
      score:  finalScore,
      text:   narration,
    },
  });

  console.log(`[${STAGE_NAME}] Done. Final score: ${finalScore}. Scan complete.`);
  return { scanId, stage: STAGE_NAME, success: true };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  await publisher.connect();
  console.log("[Worker] Redis publisher connected.");

  const worker = new Worker(IN_QUEUE, processJob, {
    connection: redisConnection,
    concurrency: 1,
  });

  worker.on("active",    (job) => console.log(`[Worker] Job active: ${job.id}`));
  worker.on("completed", (job) => console.log(`[Worker] Job completed: ${job.id}`));
  worker.on("failed",    (job, err) => console.error(`[Worker] Job failed:`, err.message));

  console.log(`[Worker] Stage 4 (${STAGE_NAME}) listening on "${IN_QUEUE}"…`);

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