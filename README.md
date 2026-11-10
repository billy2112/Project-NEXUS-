# Project NEXUS — Global Brain of Computers

**Live demo:** https://billy2112.github.io/Project-NEXUS-/docs/

A globally distributed, decentralized computational network that pools
heterogeneous compute resources (CPUs, GPUs, NPUs, edge devices, enterprise
servers) into a unified, self-organizing "Global Brain."

## What it does

* **Heterogeneous resource pooling** — nodes register capabilities (CPU/GPU/TPU/NPU, ZK-proof, rendering, federated learning) with telemetry.
* **Autonomous discovery** — Kademlia-inspired DHT + GossipSub-style heartbeat, NAT-traversal status, client/server mode.
* **Intelligent scheduling** — weighted resource-matching engine (capability, telemetry, reputation, geo-proximity, load, cost) with DAG-aware decomposition, reassignment on failure, and speculative handling.
* **Sandboxed execution** — Wasm, Firecracker microVM, Docker, and TEE sandbox backends with periodic checkpointing to content-addressed storage.
* **Verifiable computation** — zk-SNARK / zk-STARK / signed-hash / TEE-attestation / collaborative zk proof verification.
* **Incentives** — reputation scoring (uptime, completion, verification, latency) + credit ledger with micro-metering (compute/GPU cycles, storage, bandwidth).
* **Web interface** — responsive dashboard (desktop + mobile) with live topology, node telemetry, job submission, task execution, and credits/reputation tables via WebSocket.

## Contents

```
PROJECT_NEXUS_BLUEPRINT.md   # full technical blueprint (architecture, network, scheduling,
                              # execution/verification, security, incentives)
server.js                    # Express + Socket.io backend (REST API + real-time events)
nexus/                       # core modules
  types.js                   # shared constants/types
  node.js                    # node identity, capabilities, telemetry, reputation record
  discovery.js               # Kademlia DHT discovery + registration + GossipSub pub/sub
  scheduler.js               # weighted resource matching + DAG scheduling + reassignment
  executor.js                # sandboxed execution (Wasm/Firecracker/Stub) + checkpointing
  verification.js            # proof-of-execution verification (zk/STARK/signed-hash/TEE/collaborative)
  storage.js                 # IPFS-style content-addressed store
  reputation.js              # reputation engine + credit ledger
  node_app.js                # standalone CLI demo (heartbeat + scheduling)
public/                      # responsive web interface (desktop + mobile)
  index.html, style.css, app.js
test_integration.js          # core integration tests
test_http.js                 # HTTP API end-to-end test
package.json                 # Node.js entry point & scripts
```

## Quick Start

```bash
# install dependencies
npm install

# start the backend server (serves the web UI at http://localhost:3000)
npm start

# run the standalone CLI demo
npm run demo

# run core integration tests
npm test
```

Open `http://localhost:3000` in a browser (desktop or mobile). Use the sidebar to navigate Dashboard, Nodes, Jobs, Topology, and Credits. Register nodes, submit jobs, and watch tasks schedule, execute, and verify in real time over WebSocket.

## API

* `GET /api/health` — service health
* `GET /api/stats` — cluster + storage + credit stats
* `GET /api/nodes` — list nodes
* `POST /api/nodes` — register a node
* `POST /api/nodes/:id/heartbeat` — submit telemetry
* `GET /api/jobs` — list jobs
* `POST /api/jobs` — submit a job
* `GET /api/jobs/:id` — job + tasks
* `GET /api/reputation` — reputation scores
* `GET /api/credits` — credit balances

Socket.io emits real-time events: `network:state`, `node:joined`, `node:heartbeat`, `task:assigned`, `task:running`, `task:completed`, `task:failed`, `task:reassigned`, `job:submitted`.

## Roadmap (production)

1. Wire `Discovery` to libp2p Kademlia DHT + GossipSub with Noise-encrypted QUIC transport.
2. Add NAT traversal (AutoNAT + Circuit Relay) and client/server DHT modes.
3. Replace stub sandboxes with real Wasmtime, Firecracker microVMs, and Docker.
4. Implement real zk-SNARK/STARK verification and TEE remote attestation.
5. Back storage with IPFS; add replication + erasure coding for checkpoints.
6. Add on-chain credit settlement, reputation-weighted governance, and slashing.
