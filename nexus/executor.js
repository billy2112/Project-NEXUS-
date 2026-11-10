"use strict";

const crypto = require("crypto");
const { sha256, now, TaskState, SandboxType, VerificationMethod } = require("./types");

class Checkpoint {
  constructor({ taskId, seq, statePayload, outputPartial, timestamp = now() } = {}) {
    this.taskId = taskId;
    this.seq = seq;
    this.statePayload = statePayload;
    this.outputPartial = outputPartial;
    this.timestamp = timestamp;
    this.cid = this.computeCid();
  }
  computeCid() {
    const data = JSON.stringify({ taskId: this.taskId, seq: this.seq, state: this.statePayload, output: this.outputPartial });
    return `cid:${sha256(data)}`;
  }
}

class Sandbox {
  run(microWorkload, workdir) {
    throw new Error("Sandbox.run() must be implemented");
  }
}

class StubSandbox extends Sandbox {
  constructor({ latencyS = 0.05 } = {}) {
    super();
    this.latencyS = latencyS;
  }
  run(microWorkload, workdir) {
    const start = Date.now();
    while (Date.now() - start < this.latencyS * 1000) {}
    return `ipfs://output:${microWorkload.id}:${crypto.randomBytes(4).toString("hex")}`;
  }
}

class WasmSandbox extends Sandbox {
  constructor({ wasmtimePath = null } = {}) {
    super();
    this.wasmtimePath = wasmtimePath;
  }
  async run(microWorkload, workdir) {
    // Stub: in production, invoke wasmtime to run the module
    await new Promise((r) => setTimeout(r, 50));
    return `ipfs://wasm-out:${microWorkload.id}:${crypto.randomBytes(4).toString("hex")}`;
  }
}

class FirecrackerSandbox extends Sandbox {
  constructor({ socketPath = "/tmp/firecracker.socket" } = {}) {
    super();
    this.socketPath = socketPath;
  }
  async run(microWorkload, workdir) {
    // Stub: in production, drive Firecracker API via vsock
    await new Promise((r) => setTimeout(r, 300));
    return `ipfs://fc-out:${microWorkload.id}:${crypto.randomBytes(4).toString("hex")}`;
  }
}

class Executor {
  constructor({ nodeId, sandbox = null } = {}) {
    this.nodeId = nodeId;
    this.sandbox = sandbox || new StubSandbox();
    this.checkpoints = {};
    this.running = new Map(); // taskId -> promise
  }

  async execute(task, microWorkload, checkpointIntervalS = 1) {
    task.state = TaskState.RUNNING;
    task.startedAt = now();

    const workdir = `/tmp/nexus/${task.id}`;
    let seq = 0;
    let lastCid = null;
    for (let step = 0; step < 3; step++) {
      const ckpt = new Checkpoint({
        taskId: task.id,
        seq: seq++,
        statePayload: JSON.stringify({ step, node: this.nodeId }),
        outputPartial: `partial-out-${step}`,
      });
      lastCid = ckpt.cid;
      if (!this.checkpoints[task.id]) this.checkpoints[task.id] = [];
      this.checkpoints[task.id].push(ckpt);
      task.checkpointCid = lastCid;
      task.state = TaskState.CHECKPOINTED;
    }

    const outputUri = await this.sandbox.run(microWorkload, workdir);
    task.state = TaskState.COMPLETED;
    task.completedAt = now();
    task.resultCid = outputUri;

    const result = {
      taskId: task.id,
      nodeId: this.nodeId,
      outputUri,
      metrics: {
        durationS: (task.completedAt || 0) - (task.startedAt || 0),
        checkpoints: seq,
      },
      checkpointCid: lastCid,
    };
    return result;
  }

  resumeFromCheckpoint(taskId, cid) {
    const ckpts = this.checkpoints[taskId] || [];
    return ckpts.find((c) => c.cid === cid) || null;
  }
}

class Task {
  constructor({ id, microWorkloadId, nodeId, state = TaskState.PENDING } = {}) {
    this.id = id;
    this.microWorkloadId = microWorkloadId;
    this.nodeId = nodeId;
    this.state = state;
    this.assignedAt = now();
    this.startedAt = null;
    this.completedAt = null;
    this.checkpointCid = null;
    this.resultCid = null;
    this.failureCount = 0;
  }
  markRunning() { this.state = TaskState.RUNNING; this.startedAt = now(); }
  markCompleted(resultCid) { this.state = TaskState.COMPLETED; this.completedAt = now(); this.resultCid = resultCid; }
  markFailed() { this.state = TaskState.FAILED; this.failureCount += 1; }
}

module.exports = { Executor, Checkpoint, Sandbox, StubSandbox, WasmSandbox, FirecrackerSandbox, Task };
