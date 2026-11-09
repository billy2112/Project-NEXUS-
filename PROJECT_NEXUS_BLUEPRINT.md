# Project NEXUS — Global Brain of Computers

## Executive Summary

Project NEXUS is a globally distributed, decentralized computational network that pools heterogeneous compute resources (consumer GPUs, CPUs, edge devices, enterprise servers, NPUs) into a unified, self-organizing "Global Brain." Nodes autonomously discover one another, advertise capabilities, receive intelligently scheduled workloads, execute them in sandboxed isolation, and produce cryptographically verifiable results — all coordinated through a peer-to-peer control plane with a reputation-based incentive layer.

---

## 1. System Architecture Overview

### 1.1 Core Abstractions

| Abstraction | Description |
|-------------|-------------|
| **Node** | A registered compute participant contributing CPU/GPU/NPU cycles, storage, bandwidth, and specialized accelerators. |
| **Capability Tag** | Machine-readable descriptor of what a node can execute (e.g., `cuda:12`, `tpu-v4`, `zk-proof`, `federated-learning`). |
| **Job** | User-submitted computational unit with requirements (latency, memory, geo, compute type, privacy level). |
| **Micro-workload** | A decomposed fragment of a Job, scheduled to a single Node with inputs, outputs, and verification metadata. |
| **Task** | The runtime representation of a Micro-workload assigned to a Node, including lifecycle state and checkpoint data. |
| **Proof of Execution** | Cryptographic attestation (zk-SNARK/STARK or signed hash chain) that a Node correctly executed a Task. |
| **Reputation Score** | On-chain/off-chain trust metric derived from uptime, completion rate, verification pass rate, and latency SLA adherence. |

### 1.2 Component Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CLIENT / JOB SUBMITTER                            │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │ Job Author  │──│ Job Submitter   │──│ Reputation / Wallet    │ │
│  │ (SDK/API)   │  │ CLI / Gateway   │  │ (Credit Metering)       │ │
│  └─────────────┘  └─────────────────┘  └─────────────────────────┘ │
└──────────────┬─────────────────────────────────────────────────────┘
               │ gRPC / HTTP
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COORDINATOR PLANE (Bootstrap / Super-Nodes)       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │   DHT Bootstrap  │  │  Reputation DB   │  │   Credit Ledger  │   │
│  │  (Kademlia entry)│  │   (scores, SLAs) │  │   (micro-payments)│   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
└──────────────┬─────────────────────────────────────────────────────┘
               │ libp2p / GossipSub
     ┌─────────┴─────────┐
     ▼                   ▼
┌───────────┐     ┌───────────┐     ┌───────────┐
│  NODE A   │     │  NODE B   │     │  NODE C   │
│ (GPU)     │     │ (CPU+TPU) │     │ (Edge/CPU)│
│           │     │           │     │           │
│ ┌─────────┐ │   ┌─────────┐ │   ┌─────────┐ │
│ │ Heartbeat│ │   │ Heartbeat│ │   │ Heartbeat│ │
│ │ Telemetry│ │   │ Telemetry│ │   │ Telemetry│ │
│ └─────────┘ │   └─────────┘ │   └─────────┘ │
│ ┌─────────────────────────┐ │   ┌─────────────────────────┐ │
│ │ Sandbox (Wasm/Firecracker)│ │   │ Sandbox (Wasm/Docker)   │ │
│ └─────────────────────────┘ │   └─────────────────────────┘ │
│ ┌─────────────────────────┐ │   ┌─────────────────────────┐ │
│ │ Task Executor           │ │   │ Task Executor           │ │
│ │ (run + checkpoint)      │ │   │ (run + checkpoint)      │ │
│ └─────────────────────────┘ │   └─────────────────────────┘ │
│ ┌─────────────────────────┐ │   ┌─────────────────────────┐ │
│ │ Proof Generator         │ │   │ Proof Generator         │ │
│ │ (zk-SNARK/STARK stub)   │ │   │ (zk-SNARK/STARK stub)   │ │
│ └─────────────────────────┘ │   └─────────────────────────┘ │
└───────────┬───────────────┘   └───────────┬───────────────┘
            │ GossipSub mesh / direct stream      │
            └───────────────────────┬───────────┘
                                    ▼
                            ┌─────────────────┐
                            │ Result Aggregator│
                            │ (reassemble +   │
                            │  verify proofs) │
                            └─────────────────┘
```

### 1.3 Component Interaction Flow

1. **Node Join**: Node connects to bootstrap peers, registers capabilities via Kademlia DHT PUT, begins broadcasting heartbeat + telemetry via GossipSub.
2. **Job Submission**: Submitter sends Job to Coordinator with requirements + encrypted input data + payment credit.
3. **Decomposition**: Scheduler splits Job into Micro-workloads based on data parallelism / task graph dependencies.
4. **Matching**: Resource Matching Engine scores candidate Nodes using capability tags, telemetry (CPU/GPU util, latency, bandwidth), geo-proximity, and reputation.
5. **Dispatch**: Micro-workloads streamed to assigned Nodes via libp2p streams; each Node allocates a sandbox.
6. **Execution**: Node runs workload in Wasm micro-runtime or Firecracker microVM, writes periodic checkpoints to distributed storage (IPFS).
7. **Verification**: Node produces a Proof of Execution; Coordinator/aggregator verifies via zk-SNARK/STARK or re-execution sampling.
8. **Aggregation**: Results reassembled, integrity-checked, and delivered to Submitter; credits settled via ledger; reputation updated.

---

## 2. Network & Node Management

### 2.1 P2P Topology

- **Overlay**: Structured Kademlia DHT for capability lookup + unstructured GossipSub for heartbeat/telemetry broadcast.
- **Bootstrap**: Hardcoded bootstrap peer list; nodes perform Kademlia FIND_NODE to populate routing tables (k-buckets).
- **NAT Traversal**: libp2p AutoNAT + Circuit Relay (hole punching via STUN/TURN fallback). Relay nodes advertise `relay` capability tag.
- **Transport**: QUIC (primary) with TCP fallback; Noise protocol for authenticated, encrypted channels.

### 2.2 Discovery Protocol

**Registration (DHT PUT):**
- Key: `sha256(nodeID)`
- Value: NodeRecord `{nodeID, multiaddrs[], capabilities[], reputation, geoRegion, bandwidthMbps, lastSeen}`

**Lookup (DHT GET / FIND_NODE):**
- Query by capability tag: `cap:<tag>` → set of candidate nodeIDs
- Filter by telemetry freshness (heartbeat < TTL) and reputation threshold

**Heartbeat:**
- Interval: 15s default, adaptive (5s–60s) based on churn
- Payload: `{nodeID, seq, cpuUtil, gpuUtil, memUsedMiB, memTotalMiB, netRxMbps, netTxMbps, latencyMs, activeTasks, capabilities[]}`
- Channel: GossipSub topic `nexus/heartbeat/<region>`

### 2.3 Telemetry Specification

| Field | Type | Unit | Freshness SLA |
|-------|------|------|---------------|
| cpuUtil | float32 | % | 15s |
| gpuUtil | float32 | % | 15s |
| memUsedMiB | uint32 | MiB | 15s |
| netRxMbps | float32 | Mbps | 30s |
| latencyMs | uint16 | ms | 30s |
| uptimeS | uint64 | s | 60s |
| activeTasks | uint16 | count | 15s |

### 2.4 Churn Handling

- **Join**: DHT PUT node record + subscribe to region heartbeat topic.
- **Leave (graceful)**: Node sends `NodeDeparture` to neighbors; coordinator migrates its active tasks with checkpoint state.
- **Leave (ungraceful / crash)**: Heartbeat timeout (3× interval) → coordinator marks node suspect → task reassignment after `failureDetectionTimeout` (default 45s).

---

## 3. Workload Decomposition & Scheduler Design

### 3.1 Job Model

```
Job {
    jobID: UUID
    submitterID: PubKey
    requirements: Req {
        computeType: {cpu | gpu | tpu | npu | zk-proof | render}
        minCores: uint
        minMemMiB: uint
        minGpuMemMiB: uint
        maxLatencyMs: uint
        geoRegion: string[]
        privacyLevel: {public | encrypted | tee-required}
    }
    dag: TaskGraph {
        nodes: [MicroWorkload]
        edges: [(parent, child, dataVolumeMiB)]
    }
    inputData: ContentAddressedURI (IPFS CID)
    outputData: ContentAddressedURI
    budgetCredits: uint
    deadline: Timestamp
}
```

### 3.2 Decomposition Algorithm

**Data-parallel split** (map-reduce style):
```
split(job, nPartitions):
    chunks = partition(job.inputData, nPartitions)
    for i, chunk in chunks:
        mw = MicroWorkload(
            id = hash(jobID || i),
            parentJob = jobID,
            index = i,
            inputs = [chunk],
            outputs = [tempCID_i],
            requirements = job.requirements,
            dependsOn = []
        )
    return [mw_0 ... mw_{n-1}]
```

**DAG-aware split** (pipeline):
- Topologically sort TaskGraph
- Emit Micro-workloads in dependency order; schedule child only after parent proof verified
- Edge data volume informs placement preference (co-locate high-volume edges)

### 3.3 Resource Matching Engine (Scoring)

Candidate score for node N on micro-workload MW:

```
score(N, MW) = w1*capabilityMatch + w2*telemetryScore + w3*reputationScore
             + w4*geoProximity - w5*currentLoad - w6*costPerCycle

where:
  capabilityMatch    = 1.0 if N.capabilities ⊇ MW.requirements else 0.0
  telemetryScore     = 1 - max(cpuUtil, gpuUtil)/100   (higher is better)
  reputationScore    = normalize(N.reputation, 0..1)
  geoProximity       = 1 / (1 + latencyMs(N, submitter))
  currentLoad        = N.activeTasks / N.maxConcurrentTasks
  costPerCycle       = N.priceCreditsPerCycle
```

Weights (tunable): w1=0.30, w2=0.20, w3=0.20, w4=0.15, w5=0.10, w6=0.05.

Scheduler picks top-K candidates, assigns MW to highest-scoring available node, falls back through list on rejection.

### 3.4 Load Balancing & Reassignment

- **Least-loaded first**: among equally-scoring nodes, pick min(activeTasks/maxConcurrentTasks).
- **Speculative execution**: for tail-latency-critical tasks, dispatch duplicate to 2nd candidate if no progress checkpoint within `speculationThreshold` (default 50% of estimated runtime).
- **Reassignment**: on node failure/suspect, reschedule micro-workload from latest checkpoint to next candidate; increment failure count on original node's reputation.

---

## 4. Execution & Verification Protocol

### 4.1 End-to-End Job Lifecycle

```
Job Submission
    │
    ▼
┌─────────────────┐
│ Decomposition   │──► Micro-workloads + DAG
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Matching Engine │──► Node assignment per MW
└────────┬────────┘
         │  gRPC stream
         ▼
┌─────────────────┐   ┌─────────────────┐
│ Node: Dispatch  │──►│ Sandbox Allocate│
│ (receive MW)    │   │ (Wasm/Firecracker)│
└────────┬────────┘   └────────┬────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│ Execute +       │   │ Checkpoint      │
│ stream output   │──►│ (IPFS, periodic)│
└────────┬────────┘   └────────┬────────┘
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌─────────────────┐
│ Proof Generate  │──►│ Proof Verify    │
│ (zk-SNARK/STARK │   │ (coordinator /  │
│  or signed hash)│   │  re-exec sample)│
└────────┬────────┘   └────────┬────────┘
         │                     │
         ▼                     ▼
┌───────────────────────────────────────────┐
│ Result Aggregator (reassemble, integrity) │
└────────────────┬──────────────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Credit settle   │──► Reputation update
        │ + deliver output│──► to submitter
        └─────────────────┘
```

### 4.2 Sandbox Options (ordered by isolation vs. overhead)

| Sandbox | Use Case | Isolation | Startup | Best For |
|---------|----------|-----------|---------|----------|
| Wasm (wasmtime/wasmer) | General compute, AI inference | Process-level | ~10ms | Stateless micro-workloads |
| Firecracker microVM | Strong isolation, multi-tenant | VM-level (KVM) | ~125ms | Untrusted, long-running |
| Docker/containerd | GPU passthrough, legacy | Namespace/cgroup | ~1-3s | Specialized hardware (GPU render) |
| TEE/SGX enclave | Sensitive data, SMPC | Hardware-enforced | ~seconds | Privacy-sensitive jobs |

### 4.3 Verification Methods

1. **zk-SNARK/STARK**: Node proves correct execution succinctly; coordinator verifies in constant time. Best for high-value, low-trust jobs.
2. **Proof of Execution (signed hash chain)**: Node signs `H(input || intermediateState || output)` at each checkpoint; coordinator spot-checks.
3. **Re-execution sampling**: Coordinator re-runs 1–5% of micro-workloads on independent nodes; mismatches trigger slashing.
4. **TEE attestation**: Remote attestation quote (Intel SGX/TDX, AMD SEV) confirms code ran inside enclave.

### 4.4 Checkpointing

- Interval: every `checkpointIntervalS` (default 30s) or at micro-workload milestones
- State: serialized executor state + partial output, written to IPFS (content-addressed)
- On reassignment: new node fetches latest checkpoint CID, resumes from there

---

## 5. Security & Fault-Tolerance Matrix

| Threat | Impact | Mitigation |
|--------|--------|------------|
| Node dropping mid-task | Incomplete results, latency | Checkpointing + task reassignment; speculative execution for stragglers |
| Malicious / incorrect results | Corrupted output | zk-SNARK/STARK verification + re-execution sampling + slashing |
| Data leak / exfiltration | Privacy breach | End-to-end encryption (TLS 1.3 + Noise), per-job symmetric keys, TEEs for sensitive data |
| Sybil attack (fake nodes) | Gaming reputation/rewards | Proof-of-Useful-Work + reputation decay, invite-only bootstrap, stake requirement, device attestation |
| Eclipse attack | Isolation from network | Kademlia k-bucket diversity, multiple bootstrap peers, GossipSub mesh diversity |
| Replay / MITM | Tampered control plane | Noise authenticated channels, per-message nonces, timestamps |
| Coordinator single point of failure | Scheduling outage | Multi-coordinator quorum (Raft), DHT-distributed scheduling fallback |
| Storage node failure | Lost checkpoints | IPFS replication factor ≥3, erasure coding |

---

## 6. Incentive Mechanism & Governance

### 6.1 Reputation Score

```
reputation = 0.40*uptimeScore + 0.25*completionRate
           + 0.20*verificationPassRate + 0.15*latencySLAScore
```
- Decay factor: 0.99 per day of inactivity
- Slashing: verified malicious behavior → reputation reset + stake slashed

### 6.2 Credit / Tokenomics

- **Metering units**: computeCycle (CPU-second), gpuCycle (GPU-second), gbHour (storage), mb (bandwidth)
- **Pricing**: node sets `priceCreditsPerCycle`; submitter budget caps max spend
- **Settlement**: escrow at job submission; release on proof verification; micropayments batched
- **Governance**: reputation-weighted voting on protocol parameters (weights, slashing, bootstrap list)

---

## 7. Starter Code Skeleton

The `nexus/` package implements:
- `Node`: libp2p-style peer with heartbeat broadcast and telemetry
- `Discovery`: Kademlia-inspired capability registration/lookup
- `Task`: micro-workload model
- `Scheduler`: basic scoring and assignment
- `Executor`: sandboxed execution stub with checkpointing
- `Verifier`: proof-of-execution stub

See `nexus/node.py` for the entry point demonstrating heartbeat broadcasting and basic task distribution.
