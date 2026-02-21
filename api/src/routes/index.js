'use strict';

const { Router } = require('express');
const scanRouter = require('./scan.route');

const router = Router();

/**
 * Mount feature routers under /api/v1
 *
 * Current routes:
 *   POST   /api/v1/scans           → startScan
 *   GET    /api/v1/scans/:id       → getScanStatus
 *   GET    /api/v1/scans/:id/stream → SSE narration stream
 */
router.use('/scans', scanRouter);

// Future routers can be added here, e.g.:
// router.use('/reports', require('./report.route'));

module.exports = router;