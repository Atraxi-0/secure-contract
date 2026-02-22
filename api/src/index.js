"use strict";

const { Router } = require("express");
const scanRouter = require("./scan.route");

const router = Router();

router.use("/scans", scanRouter);

module.exports = router;