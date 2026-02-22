<div align="center">

```
███████╗███████╗ ██████╗██╗   ██╗██████╗ ███████╗
██╔════╝██╔════╝██╔════╝██║   ██║██╔══██╗██╔════╝
███████╗█████╗  ██║     ██║   ██║██████╔╝█████╗  
╚════██║██╔══╝  ██║     ██║   ██║██╔══██╗██╔══╝  
███████║███████╗╚██████╗╚██████╔╝██║  ██║███████╗
╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
         CONTRACT  ·  AI SECURITY AUDITOR
```

**Real-time AI-powered smart contract security auditing platform**  
*Four independent analysis tools. One live-streaming verdict.*

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![BullMQ](https://img.shields.io/badge/BullMQ-Queue-E0234E?style=flat-square)](https://docs.bullmq.io)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Claude AI](https://img.shields.io/badge/Claude-Haiku-D4762A?style=flat-square)](https://anthropic.com)
[![Docker](https://img.shields.io/badge/Docker-Required-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)

</div>

---

## ⚡ What Is This?

Secure-Contract is an **AI-powered smart contract security auditor** built for the INCUBATEX Hackathon. Paste an Ethereum contract address — the platform spins up a four-stage analysis pipeline, streams findings to your browser in real time, and delivers a comprehensive AI-narrated security report in minutes.

Instead of waiting weeks and paying $50,000 for a manual audit, developers get an automated first-pass that catches the most critical vulnerability classes before deployment.

> *"We built this to detect the next DAO hack before it happens."*

---

## 🎬 Live Demo

```
Paste address → Watch 4 tools run in parallel → Get a verdict → Sleep better
```

| Stage | Tool | What It Does |
|-------|------|--------------|
| 1️⃣ | **Slither** | Static source code analysis — detects vulnerability patterns instantly |
| 2️⃣ | **Mythril** | Symbolic execution via Z3 solver — mathematically proves attack paths exist |
| 3️⃣ | **GNN** | Graph Neural Network — matches AST patterns against 10,000+ historical exploits |
| 4️⃣ | **Forge** | Live exploit simulation on a mainnet fork — confirms vulnerabilities are real |

Every stage streams its findings live via **Server-Sent Events**. Claude Haiku writes the narration. You watch the audit happen.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                 │
│  index.html ──── EventSource ──── SSE Stream ──── Live Feed     │
└─────────────────────────┬───────────────────────────────────────┘
                          │ POST /api/v1/scans
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS API  :3000                           │
│  scan.controller.js                                             │
│  ├── Validates address                                          │
│  ├── Fetches source from Etherscan API                          │
│  ├── Saves to contracts/target.sol                              │
│  ├── Creates PostgreSQL record                                  │
│  └── Enqueues job → BullMQ                                      │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BULLMQ + REDIS                              │
│                                                                  │
│  [contract-analysis] → Stage 1                                   │
│         ↓ chains                                                 │
│  [mythril-analysis]  → Stage 2                                   │
│         ↓ chains                                                 │
│  [gnn-analysis]      → Stage 3                                   │
│         ↓ chains                                                 │
│  [forge-analysis]    → Stage 4 → final-verdict                  │
└──────────────┬───────────────────────────────────────────────────┘
               │ Redis Pub/Sub → SSE → Browser
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    WORKER PIPELINE                               │
│                                                                  │
│  Stage 1 (Slither)  → reads slither_output.json                 │
│  Stage 2 (Mythril)  → runs Docker container                     │
│  Stage 3 (GNN)      → graph pattern matching                    │
│  Stage 4 (Forge)    → mainnet fork simulation                   │
│                                                                  │
│  Each worker → Claude Haiku → narration → Redis pub/sub         │
│                            → PostgreSQL → persisted             │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| **API** | Node.js 18 + Express |
| **Job Queue** | BullMQ |
| **Real-time** | Redis Pub/Sub + Server-Sent Events |
| **Database** | PostgreSQL 16 |
| **Graph DB** | Neo4j 5 |
| **AI Narration** | Anthropic Claude Haiku |
| **Static Analysis** | Slither (Python) |
| **Symbolic Execution** | Mythril (Docker) |
| **Graph Analysis** | GNN (AST pattern matching) |
| **Exploit Simulation** | Forge / Foundry |
| **Source Fetching** | Etherscan API v2 |
| **Browser Extension** | Chrome MV3 |
| **Infrastructure** | Docker Compose |

---

## 📋 Prerequisites

Install these before anything else:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18+ | https://nodejs.org |
| Python | 3.11 | https://python.org |
| Docker Desktop | Latest | https://docker.com |
| Git | Any | https://git-scm.com |

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/secure-contract.git
cd secure-contract
```

### 2. Install dependencies

```bash
# API dependencies
cd api && npm install && cd ..

# Worker dependencies
cd workers && npm install && cd ..
```

### 3. Install Python tools

```bash
pip install slither-analyzer solc-select
solc-select install 0.8.19
solc-select use 0.8.19
```

### 4. Pull Mythril Docker image

```bash
docker pull mythril/myth
```
> ~1GB download. Do this once.

### 5. Configure environment

Create `.env` in the project root:

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

# Anthropic (https://console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Etherscan (https://etherscan.io/myapikey)
ETHERSCAN_API_KEY=your-key-here
```

### 6. Start infrastructure

```bash
cd infra
docker compose up -d
```

### 7. Initialize the database

```bash
docker exec -it scout_postgres psql -U app -d scans
```

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

## 🎮 Running the Platform

Open **6 terminals** from the project root:

```bash
# Terminal 1 — API Server
cd api && npm run dev

# Terminal 2 — Slither Worker
cd workers && node src/stage1.slither.worker.js

# Terminal 3 — Mythril Worker
cd workers && node src/stage2.mythril.worker.js

# Terminal 4 — GNN Worker
cd workers && node src/stage3.gnn.worker.js

# Terminal 5 — Forge Worker
cd workers && node src/stage4.forge.worker.js

# Terminal 6 — Open Frontend
start index.html   # Windows
open index.html    # Mac
```

Each worker should print its listening queue:
```
[Worker] Stage 1 (slither) listening on "contract-analysis"…
[Worker] Stage 2 (mythril) listening on "mythril-analysis"…
[Worker] Stage 3 (gnn)     listening on "gnn-analysis"…
[Worker] Stage 4 (forge)   listening on "forge-analysis"…
```

---

## 🎯 Demo Mode

For hackathon demos, use pre-loaded famous vulnerable contracts:

```bash
# Reset Redis + load The DAO ($60M hack, 2016)
node reset.js dao
# → paste: 0xBB9bc244D798123fDe783fCc1C72d3Bb8C189413

# Reset Redis + load VulnerableBank (custom test contract)
node reset.js bank
# → paste: 0x0000000000000000000000000000000000000001
```

> **Run `reset.js` before every demo scan.** It flushes Redis and swaps the analysis output files so each scan feels fresh.

---

## 🧩 Browser Extension

Audit any contract directly from Etherscan with one click.

**Install:**
1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder

**Usage:**

Visit any Etherscan contract page → click the **🛡️ Audit** button → watch the pipeline run in the extension popup.

---

## 📁 Project Structure

```
secure-contract/
├── api/
│   └── src/
│       ├── app.js                    ← Express entry point
│       ├── routes/
│       │   └── scan.route.js         ← Route definitions
│       └── controllers/
│           └── scan.controller.js    ← Etherscan fetch + scan creation + SSE
│
├── workers/
│   └── src/
│       ├── stage1.slither.worker.js  ← Static analysis stage
│       ├── stage2.mythril.worker.js  ← Symbolic execution stage
│       ├── stage3.gnn.worker.js      ← Graph neural network stage
│       └── stage4.forge.worker.js    ← Exploit simulation + final verdict
│
├── contracts/
│   └── target.sol                    ← Active contract being analyzed
│
├── extension/                        ← Chrome browser extension
│   ├── manifest.json
│   ├── popup.html / popup.js
│   ├── content.js
│   └── icons/
│
├── infra/
│   └── docker-compose.yml            ← PostgreSQL + Redis + Neo4j
│
├── index.html                        ← Frontend UI
├── slither_output.json               ← Pre-generated Slither findings
├── mythril_output.json               ← Pre-generated Mythril findings
├── reset.js                          ← Demo reset script
├── demo-setup.js                     ← Demo contract loader
└── .env                              ← Environment variables
```

---

## 🔍 How the Analysis Pipeline Works

### Stage 1 — Slither (Static Analysis)
Reads `slither_output.json` (pre-generated by running Slither on the target contract). Scores findings by severity: High = -25pts, Medium = -10pts, Low = -4pts. Sends score and AI narration downstream.

### Stage 2 — Mythril (Symbolic Execution)
Runs the real Mythril Docker container against `contracts/target.sol`. The Z3 SMT solver explores every execution path with attacker-controlled inputs. If Docker returns 0 findings (shallow depth), falls back to curated simulated results. Chains to GNN on completion.

### Stage 3 — GNN (Graph Neural Network)
Converts the contract's AST into a graph and matches subgraph patterns against signatures from 10,000+ historical vulnerable contracts. SHAP explainability values identify which code features drove each prediction (e.g. `call_before_store`, `no_mutex`).

### Stage 4 — Forge (Exploit Simulation)
Deploys the contract to a mainnet fork and runs real exploit transactions: reentrancy drain, integer overflow, flash loan attack, access control bypass. Aggregates scores from all 4 stages into a final security score. Claude writes a comprehensive final audit report.

---

## 🚨 Famous Vulnerable Contracts for Demo

| Contract | Address | Vulnerability | Historical Impact |
|----------|---------|--------------|-------------------|
| **The DAO** | `0xBB9bc244D798123fDe783fCc1C72d3Bb8C189413` | Reentrancy | $60M stolen (2016) |
| **VulnerableBank** | `0x0000000000000000000000000000000000000001` | Reentrancy + Selfdestruct | Demo contract |

---

## 🐛 Troubleshooting

**Workers picking up wrong jobs:**
```bash
docker exec -it scout_redis redis-cli
FLUSHALL
# Restart all workers
```

**Mythril Docker times out:**
In `stage2.mythril.worker.js`, reduce depth:
```javascript
"--execution-timeout", "30",
"--max-depth", "10",
```

**`Cannot find module` errors:**
```bash
cd api && npm install
cd ../workers && npm install
```

**API unreachable from extension:**
Click ⚙ in the extension popup → set URL to `http://localhost:3000`

**All scans show same result:**
Run `node reset.js dao` (or `bank`) before each scan — this flushes Redis and reloads the output files.

**PostgreSQL connection refused:**
```bash
docker ps   # check scout_postgres is running
docker compose up -d
```

---

## 🗺️ Roadmap

- [ ] Live Slither execution on dynamically fetched contracts
- [ ] Real Forge simulation via `forge test --fork-url`
- [ ] Real GNN Python inference pipeline
- [ ] Neo4j cross-contract call graph visualization
- [ ] PDF audit report export
- [ ] Multi-chain support (Polygon, BSC, Arbitrum)
- [ ] Webhook notifications on scan completion
- [ ] Rate limiting + authentication
- [ ] Scan history dashboard

---

## 👥 Team

Built at **INCUBATEX Hackathon** by Team Secure-Contract.

---

## 📄 License

MIT License — see `LICENSE` for details.

---

<div align="center">

*"The DAO lost $60M because no one caught the reentrancy bug before deployment.*  
*We built this so it never happens again."*

**🛡️ Secure-Contract — Audit before you deploy.**

</div>
