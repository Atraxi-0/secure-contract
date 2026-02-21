"use strict";

/**
 * workers/src/stage1.slither.worker.js
 *
 * Stage 1 of the contract-analysis pipeline.
 */

require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const { Worker, Queue } = require("bullmq");
const { Pool } = require("pg");
const { createClient } = require("redis");
const { spawn } = require("child_process");
const path = require("path");
const llmService = require("./services/llm.service");

// ─── Constants ───────────────────────────────────────────────────────────────
const QUEUE_NAME = "contract-analysis";
const STAGE_NAME = "slither";

// ─── Infrastructure clients ───────────────────────────────────────────────────
const redisConnection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
};

const pool = new Pool({
  host: process.env.DB_HOST || process.env.POSTGRES_HOST || "127.0.0.1",
  port: parseInt(
    process.env.DB_PORT || process.env.POSTGRES_PORT || "5433",
    10,
  ),
  database: process.env.DB_NAME || process.env.POSTGRES_DB || "secure_contract",
  user: process.env.DB_USER || process.env.POSTGRES_USER || "postgres",
  password:
    process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || "postgres",
});

const publisher = createClient({
  socket: { host: redisConnection.host, port: redisConnection.port },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function publishUpdate(scanId, payload) {
  const channel = `scan:${scanId}:updates`;
  await publisher.publish(channel, JSON.stringify(payload));
  console.log(`[${STAGE_NAME}] Published to ${channel}: type=${payload.type}`);
}

function runSlither(contractAddress, scanId) {
  return new Promise((resolve) => {
    // Relative path to find the target.sol file
    const slitherTarget = "../../contracts/target.sol";

    console.log(`[${STAGE_NAME}] Spawning: slither ${slitherTarget} --json -`);

    // shell: true is critical for Windows to find python/slither shims
    const proc = spawn("slither", [slitherTarget, "--json", "-"], {
      env: process.env,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      console.log(`[${STAGE_NAME}] Exit Code: ${code}`);

      // If we got ANY data in stdout, we try to parse it, regardless of the exit code
      if (stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout);
          resolve({ success: true, data: parsed, raw: stdout });
          return;
        } catch (e) {
          console.error(`[${STAGE_NAME}] JSON Parse Error:`, e.message);
        }
      }

      // If we got here, it means stdout was empty or unparseable
      if (code !== 0) {
        resolve({
          success: false,
          error: stderr || "Slither found issues but failed to report JSON",
          raw: stderr,
        });
      } else {
        resolve({ success: true, data: {}, raw: stdout });
      }
    });
  });
}

async function persistResults(scanId, slitherResult, narration) {
  await pool.query(
    `UPDATE scans
     SET
       status        = 'processing',
       results       = COALESCE(results, '{}'::jsonb) || jsonb_build_object('slither', $2::jsonb),
       narration_log = COALESCE(narration_log, '[]'::jsonb) || jsonb_build_array(
                         jsonb_build_object(
                           'stage',     $3::text,
                           'text',      $4::text,
                           'timestamp', now()
                         )
                       ),
       updated_at    = now()
     WHERE id = $1`,
    [scanId, JSON.stringify(slitherResult), STAGE_NAME, narration],
  );
}

// ─── Job processor ────────────────────────────────────────────────────────────

async function processJob(job) {
  const { scanId, contractAddress } = job.data;
  console.log(`\n[${STAGE_NAME}] Processing job ${job.id} — scan ${scanId}`);

  // Wait 2s for the frontend SSE to connect
  await new Promise((resolve) => setTimeout(resolve, 2000));

  await publishUpdate(scanId, {
    type: "narration",
    data: {
      stage: STAGE_NAME,
      text: "🔍 Stage 1: Running Slither static analysis…",
    },
  });

  let slitherResult;
  try {
    slitherResult = await runSlither(contractAddress, scanId);
  } catch (err) {
    slitherResult = { success: false, error: err.message };
  }

  await publishUpdate(scanId, {
    type: "narration",
    data: {
      stage: STAGE_NAME,
      text: "🤖 Slither complete. Generating AI narration…",
    },
  });

  let narration;
  try {
    narration = await llmService.generateNarration(slitherResult, "");
  } catch (llmErr) {
    narration = `Slither scan finished (Success: ${slitherResult.success})`;
  }

  await persistResults(scanId, slitherResult, narration);

  await publishUpdate(scanId, {
    type: "complete",
    data: {
      stage: STAGE_NAME,
      text: narration,
      success: slitherResult.success,
      detectors: slitherResult.data?.results?.detectors?.length ?? 0,
    },
  });

  // Hand off to Stage 2 Queue
  const stage2Queue = new Queue("contract-analysis-stage2", {
    connection: redisConnection,
  });
  await stage2Queue.add("analyse-contract-stage2", {
    scanId,
    contractAddress,
    previousNarration: narration,
  });
  await stage2Queue.close();

  console.log(`[${STAGE_NAME}] Stage 1 complete for scan ${scanId}.`);
  return { scanId, stage: STAGE_NAME, success: slitherResult.success };
}

// ─── Worker bootstrap ─────────────────────────────────────────────────────────

async function bootstrap() {
  await publisher.connect();
  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: redisConnection,
    concurrency: 1,
  });

  worker.on("active", (job) => console.log(`[Worker] Job active: ${job.id}`));
  worker.on("completed", (job) =>
    console.log(`[Worker] Job completed: ${job.id}`),
  );
  worker.on("failed", (job, err) =>
    console.error(`[Worker] Job failed: ${job?.id} —`, err.message),
  );

  console.log(
    `[Worker] Stage 1 (${STAGE_NAME}) listening on queue "${QUEUE_NAME}"…`,
  );
}

bootstrap().catch(console.error);
