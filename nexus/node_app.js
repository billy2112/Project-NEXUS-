"use strict";

const crypto = require("crypto");
const { Discovery } = require("./discovery");
const { NodeRecord, Telemetry } = require("./node");
const { Capability, ComputeType, TaskState } = require("./task");
const { Scheduler } = require("./scheduler");
const { Executor, StubSandbox } = require("./executor");
const { Verifier, VerificationMethod } = require("./verification");
const { Task } = require("./task");

/**
 * Heartbeat broadcaster and basic task distribution demo for Project NEXUS.
 *
 * Run: node nexus/node_app.js
 */

class NexusNode {
  constructor({ nodeId, geoRegion = "us-east", capabilities = null } = {}) {
    this.nodeId = nodeId || require("./index").generateNodeId();
    this.geoRegion = geoRegion;
    this.capabilities =
      capabilities ||
      [
        new Capability({ type: ComputeType.CPU, version: "1.0", count: 4 }),
        new Capability({ type: ComputeType.GPU, version: "cuda:12", count: 1 }),
      ];
    this.discovery = new Discovery({ nodeId: this.nodeId });
    this.scheduler = new Scheduler(this.discovery);
    this.executor = new Executor({ nodeId: this.nodeId });
    this.verifier = new Verifier();
    this._running = false;
    this._heartbeatInterval = 5;
    this.telemetrySeq = 0;
  }

  start() {
    const record = new NodeRecord({
      nodeId: this.nodeId,
      multiaddrs: [`/ip4/127.0.0.1/tcp/0/p2p/${this.nodeId}`],
      capabilities: this.capabilities,
      reputation: 1.0,
      geoRegion: this.geoRegion,
      bandwidthMbps: 100,
    });
    this.discovery.register(record);
    this._running = true;
    this._interval = setInterval(() => this._heartbeat(), this._heartbeatInterval * 1000);
    this._heartbeat();
    console.log(`[NEXUS] Node ${this.nodeId} started in ${this.geoRegion}`);
    console.log(
      `[NEXUS] Capabilities: ${this.capabilities.map((c) => c.type).join(", ")}`
    );
    return this;
  }

  stop() {
    this._running = false;
    if (this._interval) clearInterval(this._interval);
    console.log(`[NEXUS] Node ${this.nodeId} stopped`);
  }

  _heartbeat() {
    if (!this._running) return;
    this.telemetrySeq += 1;
    const tel = new Telemetry({
      nodeId: this.nodeId,
      seq: this.telemetrySeq,
      cpuUtil: 25,
      gpuUtil: 40,
      memUsedMib: 2048,
      memTotalMib: 8192,
      netRxMbps: 50,
      netTxMbps: 50,
      latencyMs: 10,
      activeTasks: this.scheduler.getTasksForNode(this.nodeId).length,
      maxConcurrentTasks: 4,
      uptimeS: Date.now() / 1000,
    });
    this.scheduler.updateTelemetry(tel);
    this.discovery.ingestHeartbeat(this.nodeId, [
      `/ip4/127.0.0.1/tcp/0/p2p/${this.nodeId}`,
    ]);
    console.log(
      `[NEXUS] Heartbeat seq=${tel.seq} cpu=${tel.cpuUtil}% gpu=${tel.gpuUtil}% tasks=${tel.activeTasks}`
    );
  }

  executeTask(task, microWorkload) {
    const result = this.executor.execute(task, microWorkload);
    const inputHash = crypto
      .createHash("sha256")
      .update(microWorkload.inputs.join(","))
      .digest("hex");
    const outputHash = crypto
      .createHash("sha256")
      .update(inputHash + result.outputUri)
      .digest("hex");
    const proof = this.verifier.generateProof({
      method: VerificationMethod.SIGNED_HASH,
      nodeId: this.nodeId,
      inputHash,
      outputHash,
      payload: "stub-proof-payload",
    });
    result.proof = proof;
    const verdict = this.verifier.verify(result);
    console.log(
      `[NEXUS] Task ${task.id} executed on ${this.nodeId}: output=${result.outputUri} verified=${verdict.valid} confidence=${verdict.confidence.toFixed(2)}`
    );
    return { result, verdict };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDemo() {
  console.log("=".repeat(60));
  console.log("Project NEXUS - Starter Code Demo");
  console.log("=".repeat(60));

  const nodeA = new NexusNode({ geoRegion: "us-east" });
  const nodeB = new NexusNode({ geoRegion: "eu-west" });
  nodeA.start();
  nodeB.start();

  await sleep(1100);

  const recA = nodeA.discovery.getRecord(nodeA.nodeId);
  const recB = nodeB.discovery.getRecord(nodeB.nodeId);
  if (recA) {
    nodeB.discovery.register(recA);
    nodeB.scheduler.updateTelemetry(
      new Telemetry({
        nodeId: recA.nodeId,
        seq: 1,
        cpuUtil: 10,
        gpuUtil: 10,
        memUsedMib: 1024,
        memTotalMib: 8192,
        activeTasks: 0,
        maxConcurrentTasks: 4,
        geoRegion: "us-east",
      })
    );
  }
  if (recB) {
    nodeA.discovery.register(recB);
    nodeA.scheduler.updateTelemetry(
      new Telemetry({
        nodeId: recB.nodeId,
        seq: 1,
        cpuUtil: 30,
        gpuUtil: 30,
        memUsedMib: 2048,
        memTotalMib: 16384,
        activeTasks: 0,
        maxConcurrentTasks: 4,
        geoRegion: "eu-west",
      })
    );
  }

  const jobId = `job:${crypto.randomBytes(8).toString("hex")}`;
  const reqs = {
    computeType: ComputeType.GPU,
    minCores: 2,
    minMemMib: 4096,
    minGpuMemMib: 8192,
    maxLatencyMs: 2000,
    geoRegion: ["us-east", "eu-west"],
    privacyLevel: "public",
  };
  const job = {
    id: jobId,
    submitterId: "submitter:alice",
    requirements: reqs,
    microWorkloads: [
      {
        id: `${jobId}:mw:0`,
        parentJob: jobId,
        index: 0,
        inputs: ["ipfs://QmExampleInputData"],
        outputs: ["ipfs://QmExampleOutput:part:0"],
        requirements: reqs,
        estimatedRuntimeS: 300,
      },
      {
        id: `${jobId}:mw:1`,
        parentJob: jobId,
        index: 1,
        inputs: ["ipfs://QmExampleInputData"],
        outputs: ["ipfs://QmExampleOutput:part:1"],
        requirements: reqs,
        estimatedRuntimeS: 300,
      },
    ],
  };

  console.log(
    `\n[NEXUS] Job ${job.id} submitted with ${job.microWorkloads.length} micro-workloads\n`
  );

  for (const mw of job.microWorkloads) {
    const outcome = nodeA.scheduler.schedule(mw, "us-east");
    const decision = outcome ? outcome.decision : null;
    if (!decision) {
      console.log(`[NEXUS] No candidate for ${mw.id}`);
      continue;
    }
    console.log(
      `[NEXUS] Scheduled ${mw.id} -> ${decision.nodeId} (score=${decision.score.toFixed(3)}) [${decision.reason}]`
    );
    const target = decision.nodeId === nodeA.nodeId ? nodeA : nodeB;
    const task = new Task({
      id: `task:${mw.id}`,
      microWorkloadId: mw.id,
      nodeId: decision.nodeId,
      state: TaskState.ASSIGNED,
    });
    target.executeTask(task, mw);
  }

  nodeA.stop();
  nodeB.stop();
  console.log("\n[NEXUS] Demo complete.");
}

if (require.main === module) {
  runDemo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { NexusNode, runDemo };
