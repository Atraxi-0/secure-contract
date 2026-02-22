"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });

const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
};

const contractAnalysisQueue = new Queue("contract-analysis", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

contractAnalysisQueue.on("error", (err) => {
  console.error("[Queue] BullMQ connection error:", err.message);
});

module.exports = { contractAnalysisQueue, connection };