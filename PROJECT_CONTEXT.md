## PROJECT_CONTEXT.md (Finalized)

> **Copy and paste this entire block into your `PROJECT_CONTEXT.md` file.**

# Project Context: Secure-Contract (INCUBATEX Hackathon)

## 1. Project Overview

An AI-driven smart contract risk analysis platform providing **Incremental Narration**. It uses a multi-layered security stack (Static, Symbolic, Simulation, and Graph-AI) to detect vulnerabilities and explain them in real-time as results arrive.

## 2. Technical Stack & Infrastructure

* **Backend:** Node.js (Express) in `/api`
* **Workers:** Node.js (BullMQ) in `/workers`
* **Databases:**
* **PostgreSQL:** Port `5433` (Used to avoid local Windows conflicts).
* **Redis:** Port `6379` (BullMQ state management).
* **Neo4j:** Port `7474` (UI) / `7687` (Bolt) for relationship mapping.


* **Infrastructure:** Managed via Docker Compose in `/infra`.

---

## 3. Core Features & Logic Flow

### **Incremental Narration Workflow**

1. **API:** Accepts contract  Creates `pending` entry in Postgres  Pushes job to BullMQ.
2. **Worker (Stage 1):** Runs **Slither**.
* Updates `scans` table with Slither JSON.
* Calls LLM Abstraction Layer to narrate Slither findings.
* Pushes narration to Frontend via **SSE (Server-Sent Events)**.


3. **Worker (Stage 2):** Executes **GNN Python Script** & **Mythril**.
* Repeats the update/narrate/push cycle.


4. **Worker (Stage 3):** Runs **Foundry (Forge)** simulation.
* Finalizes the scan, calculates the final security score, and sends the "Final Verdict" narration.



---

## 4. Database Schema (PostgreSQL)

**Table:** `scans`
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `UUID` | Primary Key. |
| `contract_address` | `TEXT` | The 0x address. |
| `status` | `TEXT` | `pending`, `processing`, `completed`, `failed`. |
| `results` | `JSONB` | Stores raw tool output: `{ slither: {}, forge: {}, gnn: {} }`. |
| `narration_log` | `JSONB` | Array of incremental LLM summaries: `[{ stage: 'slither', text: '...' }]`. |
| `final_score` | `INTEGER` | 0-100 rating. |

---

## 5. API Endpoints

* `POST /api/v1/scans`: Initiates a scan.
* `GET /api/v1/scans/:id`: Fetches current results.
* `GET /api/v1/scans/:id/stream`: **SSE Connection** for real-time narration updates.
* `GET /health`: Returns status of DB (5433), Redis, and Neo4j.

---

## 6. Worker & Tool Execution Logic

* **Python Integration:** The Node.js worker will use the `child_process` or `spawn` module to execute the GNN Python script (`python3 scripts/gnn_analyze.py`).
* **LLM Abstraction:** Use a provider-agnostic wrapper (e.g., LangChain or a custom class) to switch between Anthropic (Claude) and Google (Gemini).
* **Concurrency:** Jobs are processed sequentially per worker to manage heavy Forge/Mythril CPU usage.

---

## 7. Analysis Tool Integration (Detailed)

| Tool | Category | Implementation Method | Purpose |
| --- | --- | --- | --- |
| **Slither** | Static Analysis | CLI (via Docker/Worker) | Fast detection of common bugs (reentrancy, shadowing). |
| **Mythril** | Symbolic Exec | CLI (via Docker/Worker) | Finds complex logic errors by exploring paths. |
| **Forge** | Simulation | Foundry CLI | Runs "Cheatcodes" to simulate exploits in a local fork. |
| **GNN** | Graph-AI | **Python Script Execution** | Pattern recognition of vulnerable AST structures. |
| **Neo4j** | Relationship | Cypher Queries | Maps identity matching and contract-to-contract calls. |
| **XAI (SHAP)** | Explainability | Python (via GNN Script) | Explains *why* the GNN flagged a specific line. |

---

## 8. Development Guidelines

* **Frontend Connection:** Use `EventSource` in React/Next.js to listen to the `/stream` endpoint.
* **Error Handling:** If a tool (e.g., Mythril) fails, the worker must still proceed to the next tool and notify the LLM of the partial failure.
* **Pathing:** Always load `.env` from the root: `require('dotenv').config({ path: '../../.env' })`.