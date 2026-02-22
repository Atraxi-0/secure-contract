# Secure-Contract — Complete Setup Guide

## Prerequisites (Install These First)

### 1. Node.js v18+
```
https://nodejs.org/en/download
```
Verify: `node --version`

---

### 2. Python 3.11
```
https://www.python.org/downloads/release/python-3110/
```
Verify: `py -3.11 --version`

---

### 3. Docker Desktop
```
https://www.docker.com/products/docker-desktop/
```
Verify: `docker --version`  
**Must be running** before starting the project.

---

### 4. Git
```
https://git-scm.com/downloads
```
Verify: `git --version`

---

### 5. Solidity Compiler (solc-select via Python)
```powershell
py -3.11 -m pip install solc-select
solc-select install 0.8.19
solc-select use 0.8.19
```
Verify: `solc --version`

---

### 6. Slither (Static Analysis)
```powershell
py -3.11 -m pip install slither-analyzer
```
Verify: `py -3.11 -m slither --version`

---

## Clone & Install

```powershell
git clone <your-repo-url>
cd secure-contract
```

### API dependencies
```powershell
cd api
npm install
cd ..
```

### Worker dependencies
```powershell
cd workers
npm install
cd ..
```

> **Required npm packages** (already in package.json, installed via `npm install`):
> `express`, `cors`, `uuid`, `bullmq`, `pg`, `redis`, `dotenv`

---

## Environment Variables

Create a `.env` file in the **project root** (`D:\secure-contract\.env`):

```env
# PostgreSQL
DB_HOST=localhost
DB_PORT=5433
DB_NAME=scans
DB_USER=app
DB_PASSWORD=app

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# API
PORT=3000

# Solidity
SOLC_VERSION=0.8.19

# LLM (get from https://console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

---

## Start Infrastructure (Docker)

```powershell
cd infra
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5433`
- **Redis** on port `6379`
- **Neo4j** on port `7474` (UI) / `7687` (Bolt)

Verify containers are running:
```powershell
docker ps
```

---

## Pull Mythril Docker Image

```powershell
docker pull mythril/myth
```

This is ~1GB, do it once. The Stage 2 worker uses it automatically.

---

## Database Setup

```powershell
docker exec -it scout_postgres psql -U app -d scans
```

Then run:
```sql
CREATE TABLE IF NOT EXISTS scans (
  id               UUID PRIMARY KEY,
  contract_address TEXT NOT NULL,
  status           TEXT DEFAULT 'pending',
  results          JSONB DEFAULT '{}',
  narration_log    JSONB DEFAULT '[]',
  final_score      INTEGER,
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now()
);
\q
```

---

## Run Slither Analysis (Once Per Contract)

```powershell
cd D:\secure-contract
py -3.11 -m slither contracts/target.sol --json slither_output.json
```

> Re-run this whenever you change `target.sol`.

---

## Start the Application

Open **6 separate terminals**, all from `D:\secure-contract`:

### Terminal 1 — API Server
```powershell
cd api
node src/app.js
```
Expected: `🚀 API Server running on http://localhost:3000`

### Terminal 2 — Stage 1 (Slither Worker)
```powershell
cd workers
node src/stage1.slither.worker.js
```
Expected: `[Worker] Stage 1 (slither) listening on "contract-analysis"…`

### Terminal 3 — Stage 2 (Mythril Worker)
```powershell
cd workers
node src/stage2.mythril.worker.js
```
Expected: `[Worker] Stage 2 (mythril) listening on "mythril-analysis"…`

### Terminal 4 — Stage 3 (GNN Worker)
```powershell
cd workers
node src/stage3.gnn.worker.js
```
Expected: `[Worker] Stage 3 (gnn) listening on "gnn-analysis"…`

### Terminal 5 — Stage 4 (Forge Worker)
```powershell
cd workers
node src/stage4.forge.worker.js
```
Expected: `[Worker] Stage 4 (forge) listening on "forge-analysis"…`

### Terminal 6 — Frontend
```powershell
# Open index.html directly in browser, OR serve it:
cd frontend
npx serve .
```
Then open `http://localhost:3000` (or wherever index.html is served).

---

## Queue Flow (How It Works)

```
Browser → POST /api/v1/scans
              ↓
        [contract-analysis] queue
              ↓
        Stage 1: Slither (reads slither_output.json)
              ↓ chains to
        [mythril-analysis] queue
              ↓
        Stage 2: Mythril (runs Docker container)
              ↓ chains to
        [gnn-analysis] queue
              ↓
        Stage 3: GNN (simulated AST analysis)
              ↓ chains to
        [forge-analysis] queue
              ↓
        Stage 4: Forge (simulated exploit simulation)
              ↓
        Final verdict → SSE stream closes
```

---

## Troubleshooting

### Workers picking up wrong jobs
```powershell
docker exec -it scout_redis redis-cli
FLUSHALL
```
Then restart all workers.

### Check which queue a worker listens on
```bash
grep -n "IN_QUEUE" workers/src/stage3.gnn.worker.js
```

### Node running old cached version of a file
```powershell
taskkill /F /IM node.exe
```
Then restart all workers fresh.

### Mythril Docker timeout
In `stage2.mythril.worker.js`, reduce timeout:
```javascript
"--execution-timeout", "30",
"--max-depth", "10",
```

### PostgreSQL connection refused
Make sure Docker is running: `docker ps` — you should see `scout_postgres`.

### Slither output not found
```powershell
py -3.11 -m slither contracts/target.sol --json slither_output.json
```

---

## Tech Stack Summary

| Component | Technology | Port |
|-----------|-----------|------|
| API | Node.js + Express | 3000 |
| Queue | BullMQ + Redis | 6379 |
| Database | PostgreSQL 16 | 5433 |
| Graph DB | Neo4j 5 | 7474/7687 |
| Static Analysis | Slither (Python) | — |
| Symbolic Exec | Mythril (Docker) | — |
| Graph AI | GNN (simulated) | — |
| Simulation | Forge (simulated) | — |
| LLM | Anthropic Claude Haiku | — |
| Streaming | SSE (EventSource) | — |
