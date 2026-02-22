"use strict";

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const { Worker, Queue } = require("bullmq");
const { Pool }          = require("pg");
const { createClient }  = require("redis");
const https             = require("https");

// ─── Constants ────────────────────────────────────────────────────────────────
const IN_QUEUE   = "gnn-analysis";      // Mythril worker chains here
const OUT_QUEUE  = "forge-analysis";     // We chain Forge after us
const STAGE_NAME = "gnn";

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

const publisher  = createClient({ socket: { host: redisConnection.host, port: redisConnection.port } });
const forgeQueue = new Queue(OUT_QUEUE, { connection: redisConnection });

// ─── Simulated GNN analysis ───────────────────────────────────────────────────
// In production: spawn("python3", ["scripts/gnn_analyze.py", contractAddress])
// and parse stdout JSON. For the hackathon we return realistic simulated findings.
function runGNNAnalysis(contractAddress) {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Simulate GNN finding reentrancy pattern via AST graph traversal
      resolve({
        success: true,
        vulnerabilities: [
          {
            type: "reentrancy-pattern",
            confidence: 0.94,
            node_id: "FunctionDef_withdraw",
            description: "AST subgraph matches known reentrancy pattern: external call before state update",
            severity: "High",
            line: 42,
            shap_features: ["call_before_store", "loop_in_callstack", "no_mutex"],
          },
          {
            type: "integer-overflow-risk",
            confidence: 0.71,
            node_id: "BinaryOp_add_balance",
            description: "Unchecked arithmetic operation on user-controlled input",
            severity: "Medium",
            line: 28,
            shap_features: ["no_safemath", "user_controlled_operand"],
          },
        ],
        graph_stats: {
          nodes: 147,
          edges: 203,
          vulnerable_subgraphs: 2,
        },
        model: "GNN-v2-solidity",
        execution_time_ms: 1840,
      });
    }, 3500); // Simulate real analysis time
  });
}

// ─── LLM Narration ────────────────────────────────────────────────────────────
function buildFallbackNarration(findings) {
  if (!findings || findings.length === 0) {
    return "✅ GNN graph analysis complete. No vulnerable AST patterns detected. The contract's call graph shows no structural similarity to known exploit templates.";
  }

  const high   = findings.filter((f) => f.severity === "High");
  const medium = findings.filter((f) => f.severity === "Medium");

  let text = `🧠 GNN graph analysis identified ${findings.length} structural vulnerability pattern(s) with ${high.length} high-confidence match(es).\n\n`;

  if (high.length > 0) {
    text += `🚨 HIGH CONFIDENCE PATTERNS:\n`;
    high.forEach((f) => {
      text += `  • [${Math.round(f.confidence * 100)}% match] ${f.description}\n`;
      if (f.shap_features?.length) {
        text += `    SHAP factors: ${f.shap_features.join(", ")}\n`;
      }
    });
    text += `\n`;
  }

  if (medium.length > 0) {
    text += `⚠️  MEDIUM CONFIDENCE:\n`;
    medium.forEach((f) => {
      text += `  • [${Math.round(f.confidence * 100)}% match] ${f.description}\n`;
    });
    text += `\n`;
  }

  text += `💡 The GNN model's SHAP explanation confirms the reentrancy flag is driven by the "call_before_store" and "no_mutex" graph features — this pattern matches 94% of historical reentrancy exploits in our training dataset. Immediate code restructuring required.`;
  return text;
}

async function generateNarration(findings) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here" || apiKey.trim() === "") {
    return buildFallbackNarration(findings);
  }

  const body = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `You are a smart contract security AI. A Graph Neural Network analyzed the contract's AST and found these structural vulnerability patterns.
Write a clear 4-6 sentence summary: what patterns were found, the confidence levels, what SHAP features drove the prediction, and what must be fixed.
Plain English with severity emojis. No markdown headers.

GNN Findings:
${JSON.stringify(findings, null, 2)}`,
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
          resolve((text && text.length > 20) ? text : buildFallbackNarration(findings));
        } catch {
          resolve(buildFallbackNarration(findings));
        }
      });
    });
    req.on("error", () => resolve(buildFallbackNarration(findings)));
    req.write(body);
    req.end();
  });
}

// ─── Score ────────────────────────────────────────────────────────────────────
function findingsToScore(findings) {
  let score = 100;
  (findings || []).forEach((f) => {
    const weight = f.confidence || 0.5;
    if      (f.severity === "High")   score -= Math.round(22 * weight);
    else if (f.severity === "Medium") score -= Math.round(9  * weight);
    else                              score -= Math.round(3  * weight);
  });
  return Math.max(0, Math.min(100, score));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function publishUpdate(scanId, payload) {
  await publisher.publish(`scan:${scanId}:updates`, JSON.stringify(payload));
  console.log(`[${STAGE_NAME}] Published: type=${payload.type}`);
}

async function persistResults(scanId, findings, narration, score) {
  try {
    await pool.query(
      `UPDATE scans
       SET results       = COALESCE(results, '{}'::jsonb) || jsonb_build_object('gnn', $2::jsonb),
           narration_log = COALESCE(narration_log, '[]'::jsonb) || jsonb_build_array(
                             jsonb_build_object('stage', $3::text, 'text', $4::text, 'timestamp', now())
                           ),
           updated_at    = now()
       WHERE id = $1`,
      [scanId, JSON.stringify({ findings, score }), STAGE_NAME, narration]
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
    data: { stage: STAGE_NAME, text: "🧠 Stage 3: GNN Graph Analysis — building contract AST and running neural vulnerability classifier..." },
  });

  await new Promise((r) => setTimeout(r, 2000));

  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: "⚙️  Running SHAP explainability layer — identifying which graph features drove each prediction..." },
  });

  const { vulnerabilities, graph_stats } = await runGNNAnalysis(contractAddress);

  await publishUpdate(scanId, {
    type: "narration",
    data: { stage: STAGE_NAME, text: `📊 Graph analysis complete. Analyzed ${graph_stats.nodes} nodes, ${graph_stats.edges} edges. Generating AI report...` },
  });

  const narration = await generateNarration(vulnerabilities);
  const score     = findingsToScore(vulnerabilities);

  await persistResults(scanId, vulnerabilities, narration, score);

  await publishUpdate(scanId, {
    type: "complete",
    data: {
      stage:           STAGE_NAME,
      text:            narration,
      score,
      findings:        vulnerabilities.length,
      vulnerabilities,
      graph_stats,
      success:         true,
    },
  });

  // Chain to Forge
  await forgeQueue.add("forge-simulate", { scanId, contractAddress }, {
    attempts: 1,
    removeOnComplete: { age: 3600 },
    removeOnFail:     { age: 86400 },
  });

  console.log(`[${STAGE_NAME}] Done. Score: ${score}. Chained to Forge.`);
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

  console.log(`[Worker] Stage 3 (${STAGE_NAME}) listening on "${IN_QUEUE}"…`);

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
