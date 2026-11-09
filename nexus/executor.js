"use strict";

const crypto = require("crypto");
const { Task, TaskState, TaskResult } = require("./task");

/**
 * Sandboxed execution stub and checkpointing for Project NEXUS.
 */

class Checkpoint {
  constructor({ taskId, seq, statePayload, outputPartial, timestamp = Date.now() / 1000 } = {}) {
    this.taskId = taskId;
    this.seq = seq;
    this.statePayload = statePayload;
    this.outputPartial = outputPartial;
    this.timestamp = timestamp;
    this.cid = this.computeCid();
  }

  computeCid() {
    const data = JSON.stringify({
      taskId: this.taskId,
      seq: this.seq,
      state: this.statePayload,
      output: this.outputPartial,
    });
    return "cid:" + crypto.createHash("sha256").update(data).digest("hex");
  }
}

class Sandbox {
  run(microWorkload, workdir) {
    throw new Error("Sandbox.run() must be implemented by a concrete backend");
  }
}

class StubSandbox extends Sandbox {
  constructor({ latencyS = 0.05 } = {}) {
    super();
    this.latencyS = latencyS;
  }

  run(microWorkload, workdir) {
    const start = Date.now();
    while (Date.now() - start < this.latencyS * 1000) {
      // busy-wait sim (acceptable for a stub demo)
    }
    return `ipfs://output:${microWorkload.id}:${crypto.randomBytes(4).toString("hex")}`;
  }
}

class Executor {
  constructor({ nodeId, sandbox = null } = {}) {
    this.nodeId = nodeId;
    this.sandbox = sandbox || new StubSandbox();
    this.checkpoints = {}; // taskId -> Checkpoint[]
  }

  execute(task, microWorkload, checkpointIntervalS = 1) {
    task.state = TaskState.RUNNING;
    task.startedAt = Date.now() / 1000;

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

    const outputUri = this.sandbox.run(microWorkload, workdir);
    task.markCompleted(outputUri);

    const result = new TaskResult({
      taskId: task.id,
      nodeId: this.nodeId,
      outputUri,
      metrics: {
        durationS: (task.completedAt || 0) - (task.startedAt || 0),
        checkpoints: seq,
      },
    });
    return result;
  }

  resumeFromCheckpoint(taskId, cid) {
    const ckpts = this.checkpoints[taskId] || [];
    return ckpts.find((c) => c.cid === cid) || null;
  }
}

module.exports = { Executor, Checkpoint, Sandbox, StubSandbox };
