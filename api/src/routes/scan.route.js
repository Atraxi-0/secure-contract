'use strict';

const { Router } = require('express');
const { startScan, getScanStatus } = require('../controllers/scan.controller');

const router = Router();

/**
 * POST /api/v1/scans
 * Initiates a new contract security scan.
 * Body: { contractAddress: "0x..." }
 */
router.post('/', startScan);

/**
 * GET /api/v1/scans/:id
 * Returns the current status and results of a scan.
 */
router.get('/:id', getScanStatus);

/**
 * GET /api/v1/scans/:id/stream
 * SSE endpoint — implemented by Teammate 1 in the worker package.
 * Placeholder handler so the route is registered and discoverable now;
 * replace the handler body once the SSE worker logic is ready.
 */
router.get('/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send an immediate acknowledgement so the client knows the connection is live
  res.write(
    `data: ${JSON.stringify({ stage: 'connected', message: 'SSE stream ready. Waiting for analysis stages...' })}\n\n`
  );

  // Keep-alive ping every 20 s to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    res.end();
  });
});

module.exports = router;
