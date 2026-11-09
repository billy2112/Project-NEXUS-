# Project NEXUS — Global Brain of Computers

A globally distributed, decentralized computational network that pools
heterogeneous compute resources (CPUs, GPUs, NPUs, edge devices, enterprise
servers) into a unified, self-organizing "Global Brain."

## Contents

- `PROJECT_NEXUS_BLUEPRINT.md` — comprehensive technical blueprint
  (architecture, network, scheduling, execution/verification, security,
  incentives)
- `nexus/` — starter code skeleton (Python, stdlib-only)
  - `node.py` — node identity, capabilities, telemetry
  - `discovery.py` — Kademlia-inspired discovery & registration
  - `task.py` — Job / MicroWorkload / Task / ProofOfExecution models
  - `scheduler.py` — resource matching engine & scheduling
  - `executor.py` — sandboxed execution + checkpointing stub
  - `verification.py` — proof-of-execution verification stub
  - `node_app.py` — heartbeat broadcast + task distribution demo
- `requirements.txt` — (none, stdlib only)

## Quick Start

```bash
python -m nexus.node_app
```

The demo launches two nodes that broadcast heartbeats, registers capabilities,
submits a job, schedules micro-workloads via the scoring engine, executes them
in a stub sandbox, and verifies results with a proof-of-execution stub.

## Roadmap (production)

1. Replace in-memory `Discovery` with libp2p Kademlia DHT + GossipSub
2. Add NAT traversal (AutoNAT + Circuit Relay) and Noise-encrypted QUIC transport
3. Replace `StubSandbox` with Wasm (wasmtime), Firecracker microVMs, or Docker
4. Implement real zk-SNARK/STARK verification and TEE attestation
5. Add IPFS content-addressed storage for checkpoints and outputs
6. Add credit ledger, reputation-weighted governance, and slashing
