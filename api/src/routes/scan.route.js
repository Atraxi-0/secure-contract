'use strict';

const { Router } = require('express');
const { startScan, getScanStatus, streamScanStatus } = require('../controllers/scan.controller');

const router = Router();

/**
 * POST /api/v1/scans
 * Initiates a new contract security scan.
 */
router.post('/', startScan);

/**
 * GET /api/v1/scans/:id
 * Returns the current status and results of a scan.
 */
router.get('/:id', getScanStatus);

/**
 * GET /api/v1/scans/:id/stream
 * SSE endpoint - Logic handled by streamScanStatus in the controller.
 */
router.get('/:id/stream', streamScanStatus);

module.exports = router;