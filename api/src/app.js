const path = require("path");
const cors = require("cors"); // Moved to the top!

// Force Node to find your .env file in the root folder
const envPath = path.join(__dirname, "../../.env");
require("dotenv").config({ path: envPath });

const express = require("express");
const apiRouter = require("./routes");

const app = express();
const PORT = process.env.PORT || 3000;

// THE BULLETPROOF FIX: Accepts requests from anywhere, with any headers!
app.use(cors());

app.use(express.json());
app.use("/api/v1", apiRouter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "UP", message: "API is running" });
});

app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  console.log(
    `🔍 Checking env variables... PORT is set to: ${process.env.PORT ? process.env.PORT : "MISSING"}`,
  );
  console.log(
    `🔍 Checking DB... DB_USER is set to: ${process.env.DB_USER ? process.env.DB_USER : "MISSING"}`,
  );
});
