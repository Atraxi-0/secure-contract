"use strict";

const express = require("express");
const router = express.Router();
const scanController = require("../controllers/scan.controller");

router.post("/", scanController.startScan);
router.get("/:id", scanController.getScanStatus);
router.get("/:id/stream", scanController.streamScan);

module.exports = router;