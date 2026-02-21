'use strict';

require('dotenv').config({ path: '../../.env' });

const { Queue } = require('bullmq');

/**
 * Shared BullMQ Queue instance for the "contract-analysis" pipeline.
 *
 * Workers (Teammate 1) should connect to the same Redis instance using:
 *   const { Worker } = require('bullmq');
 *   new Worker('contract-analysis', processorFn, { connection });
 *
 * The `connection` object exported below can be imported directly by the
 * worker package to guarantee they share identical Redis configuration.
 */
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  // Optional: password: process.env.REDIS_PASSWORD,
};

const contractAnalysisQueue = new Queue('contract-analysis', {
  connection,
  defaultJobOptions: {
    // Retry a failed job up to 3 times with exponential back-off
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 s initial delay
    },
    // Keep the last 100 completed / 50 failed jobs for inspection
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

contractAnalysisQueue.on('error', (err) => {
  console.error('[Queue] BullMQ connection error:', err.message);
});

module.exports = { contractAnalysisQueue, connection };
