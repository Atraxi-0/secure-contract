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
  // 1. Establish the SSE connection
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); 

  // 2. Tell the frontend we connected successfully
  res.write(`data: ${JSON.stringify({ type: 'status', data: { status: 'connected' } })}\n\n`);

  // 3. Hackathon Simulation: Send a new AI update every 3 seconds
  let step = 0;
  const simulation = setInterval(() => {
    step++;
    
    if (step === 1) {
      res.write(`data: ${JSON.stringify({ type: 'narration', data: { stage: 'slither', text: 'Initiating static analysis. Scanning for reentrancy...' } })}\n\n`);
    } 
    else if (step === 2) {
      res.write(`data: ${JSON.stringify({ type: 'narration', data: { stage: 'mythril', text: 'Symbolic execution engine engaged. Mapping attack vectors.' } })}\n\n`);
    } 
    else if (step === 3) {
      res.write(`data: ${JSON.stringify({ type: 'narration', data: { stage: 'forge', text: 'Fuzzing complete. Calculating final vulnerability metrics.' } })}\n\n`);
    }
    else if (step === 4) {
      // Send the final score and close out the scan
      res.write(`data: ${JSON.stringify({ type: 'score', data: { final_score: 85 } })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'complete', data: { status: 'completed' } })}\n\n`);
      
      clearInterval(simulation);
      res.end();
    }
  }, 3000);

  // 4. Cleanup memory if the user closes their browser tab early
  req.on('close', () => {
    clearInterval(simulation);
  });
});

module.exports = router;
