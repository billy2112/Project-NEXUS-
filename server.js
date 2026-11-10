"use strict";

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const {
  generateId, sha256, now, ComputeType, PrivacyLevel,
  TaskState, VerificationMethod, SandboxType, NodeMode,
} = require("./nexus/types");
const { NodeRecord, Capability, Telemetry, generateNodeId } = require("./nexus/node");
const { Discovery, HEARTBEAT_TTL_S } = require("./nexus/discovery");
const { Scheduler } = require("./nexus/scheduler");
const { Executor, StubSandbox, WasmSandbox, FirecrackerSandbox, Task } = require("./nexus/executor");
const { Verifier } = require("./nexus/verification");
const { IpfsStore } = require("./nexus/storage");
const { ReputationEngine, CreditLedger } = require("./nexus/reputation");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, transports: ["websocket", "polling"] });

// ---- Global state ----
const discovery = new Discovery({ mode: NodeMode.SERVER });
const scheduler = new Scheduler(discovery);
const executor = new Executor({ nodeId: "nexus-coordinator", sandbox: new StubSandbox() });
const wasmExecutor = new Executor({ nodeId: "nexus-coordinator-wasm", sandbox: new WasmSandbox() });
const fcExecutor = new Executor({ nodeId: "nexus-coordinator-fc", sandbox: new FirecrackerSandbox() });
const verifier = new Verifier();
const storage = new IpfsStore();
const reputation = new ReputationEngine();
const credits = new CreditLedger();

const nodes = new Map(); // nodeId -> { record, telemetry, socketId, executor }
const jobs = new Map(); // jobId -> job
const tasks = new Map(); // taskId -> task
const jobResults = new Map(); // jobId -> { results[], proofs[], verified }

const PORT = process.env.PORT || 3000;

// ---- Helpers ----
function broadcast(event, data) {
  io.emit(event, data);
}

function nodeSnapshot(nodeId) {
  const n = nodes.get(nodeId);
  if (!n) return null;
  const rec = n.record.toDict();
  rec.telemetry = n.telemetry ? n.telemetry.toDict() : null;
  rec.connected = !!n.socketId;
  rec.tasks = scheduler.getTasksForNode(nodeId).length;
  return rec;
}

function allNodesSnapshot() {
  return Array.from(nodes.keys()).map((id) => nodeSnapshot(id));
}

function emitNetworkState() {
  broadcast("network:state", {
    nodes: allNodesSnapshot(),
    nodeCount: nodes.size,
    jobCount: jobs.size,
    taskCount: tasks.size,
    timestamp: now(),
  });
}

function createMicroWorkloads(job) {
  const mws = [];
  const numPartitions = job.numPartitions || 1;
  for (let i = 0; i < numPartitions; i++) {
    mws.push({
      id: `${job.id}:mw:${i}`,
      parentJob: job.id,
      index: i,
      inputs: [job.inputDataUri],
      outputs: [`${job.outputDataUri}:part:${i}`],
      requirements: job.requirements,
      dependsOn: job.requiresSequential ? (i > 0 ? [`${job.id}:mw:${i - 1}`] : []) : [],
      estimatedRuntimeS: job.estimatedRuntimeS || 300,
    });
  }
  return mws;
}

// ---- REST API ----

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: now(), version: "1.0.0" });
});

// Stats
app.get("/api/stats", (req, res) => {
  res.json({
    nodes: nodes.size,
    jobs: jobs.size,
    tasks: tasks.size,
    storage: storage.stats(),
    credits: credits.stats(),
    timestamp: now(),
  });
});

// Nodes
app.get("/api/nodes", (req, res) => {
  res.json({ nodes: allNodesSnapshot() });
});

app.post("/api/nodes", (req, res) => {
  try {
    const { nodeId, geoRegion, capabilities, multiaddrs, mode, sandboxTypes, stakeCredits = 0 } = req.body;
    const id = nodeId || generateNodeId();
    const caps = (capabilities || [
      { type: ComputeType.CPU, count: 2 },
      { type: ComputeType.GPU, count: 1 },
    ]).map((c) => new Capability(c));

    const record = new NodeRecord({
      nodeId: id,
      multiaddrs: multiaddrs || [`/ip4/127.0.0.1/tcp/0/p2p/${id}`],
      capabilities: caps,
      reputation: 1.0,
      geoRegion: geoRegion || "unknown",
      bandwidthMbps: 100,
      priceCreditsPerCycle: 1.0,
      stakeCredits,
      mode: mode || NodeMode.CLIENT,
      sandboxTypes: sandboxTypes || [SandboxType.WASM],
    });
    discovery.register(record);

    nodes.set(id, {
      record,
      telemetry: new Telemetry({ nodeId: id }),
      socketId: null,
      executor: new Executor({ nodeId: id, sandbox: new StubSandbox() }),
    });

    credits.ensure(id);
    reputation.get(id);

    broadcast("node:joined", nodeSnapshot(id));
    emitNetworkState();
    res.status(201).json({ nodeId: id, record: record.toDict() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/nodes/:nodeId", (req, res) => {
  const snap = nodeSnapshot(req.params.nodeId);
  if (!snap) return res.status(404).json({ error: "node not found" });
  res.json({ node: snap });
});

// Telemetry / heartbeat
app.post("/api/nodes/:nodeId/heartbeat", (req, res) => {
  const n = nodes.get(req.params.nodeId);
  if (!n) return res.status(404).json({ error: "node not found" });
  const t = req.body || {};
  const telemetry = new Telemetry({
    nodeId: req.params.nodeId,
    seq: t.seq || 0,
    cpuUtil: t.cpuUtil ?? 25,
    gpuUtil: t.gpuUtil ?? 40,
    memUsedMib: t.memUsedMib ?? 2048,
    memTotalMib: t.memTotalMib ?? 8192,
    netRxMbps: t.netRxMbps ?? 50,
    netTxMbps: t.netTxMbps ?? 50,
    latencyMs: t.latencyMs ?? 10,
    activeTasks: t.activeTasks ?? scheduler.getTasksForNode(req.params.nodeId).length,
    maxConcurrentTasks: t.maxConcurrentTasks ?? 4,
    uptimeS: t.uptimeS ?? now(),
    natStatus: t.natStatus,
  });
  n.telemetry = telemetry;
  scheduler.updateTelemetry(telemetry);
  discovery.ingestHeartbeat(req.params.nodeId, n.record.multiaddrs, telemetry);
  reputation.update(req.params.nodeId, { type: "heartbeat", latencyMs: telemetry.latencyMs });
  broadcast("node:heartbeat", { nodeId: req.params.nodeId, telemetry: telemetry.toDict() });
  emitNetworkState();
  res.json({ ok: true, seq: telemetry.seq });
});

// Jobs
app.post("/api/jobs", (req, res) => {
  try {
    const {
      submitterId,
      requirements,
      inputDataUri,
      outputDataUri,
      budgetCredits,
      deadline,
      numPartitions = 1,
      requiresSequential = false,
      estimatedRuntimeS = 300,
      privacyLevel = PrivacyLevel.PUBLIC,
      verificationMethod = VerificationMethod.SIGNED_HASH,
    } = req.body;

    const jobId = generateId("job");
    const job = {
      id: jobId,
      submitterId: submitterId || "user:web",
      requirements: requirements || { computeType: ComputeType.CPU, minCores: 1, minMemMib: 512 },
      inputDataUri: inputDataUri || "ipfs://QmExampleInput",
      outputDataUri: outputDataUri || `ipfs://QmOutput:${jobId}`,
      budgetCredits: budgetCredits || 1000,
      deadline: deadline || now() + 3600,
      numPartitions,
      requiresSequential,
      estimatedRuntimeS,
      privacyLevel,
      verificationMethod,
      state: "submitted",
      createdAt: now(),
      microWorkloads: [],
    };

    const mws = createMicroWorkloads({ ...job, numPartitions, requiresSequential, estimatedRuntimeS });
    job.microWorkloads = mws;
    scheduler.registerJobDag(jobId, mws);
    jobs.set(jobId, job);

    // Initial credit escrow (simulate)
    const cost = credits.getMeteredCost({ cpuSeconds: numPartitions * estimatedRuntimeS });
    if (submitterId) credits.debit(submitterId, cost, "job_escrow", jobId);

    broadcast("job:submitted", { job });
    emitNetworkState();

    // Auto-schedule ready micro-workloads
    scheduleReady(jobId);

    res.status(201).json({ job });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/jobs", (req, res) => {
  res.json({ jobs: Array.from(jobs.values()) });
});

app.get("/api/jobs/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  const jobTasks = Array.from(tasks.values()).filter((t) => t.parentJob === req.params.jobId);
  res.json({ job, tasks: jobTasks });
});

// Scheduler: manually trigger scheduling for a job
app.post("/api/jobs/:jobId/schedule", (req, res) => {
  const result = scheduleReady(req.params.jobId);
  res.json({ scheduled: result });
});

function scheduleReady(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { scheduled: 0, reason: "job not found" };

  const completed = new Set(
    Array.from(tasks.values())
      .filter((t) => t.parentJob === jobId && t.state === TaskState.COMPLETED)
      .map((t) => t.microWorkloadId)
  );

  const scheduledBefore = new Set(
    Array.from(tasks.values()).filter((t) => t.parentJob === jobId).map((t) => t.microWorkloadId)
  );

  const readyMwIds = scheduler.getReadyTasks(jobId, completed);
  let scheduled = 0;
  for (const mwId of readyMwIds) {
    if (scheduledBefore.has(mwId)) continue;
    const mw = job.microWorkloads.find((m) => m.id === mwId);
    if (!mw) continue;
    const outcome = scheduler.schedule(mw, "web-user");
    if (!outcome) continue;
    const { decision, task } = outcome;
    task.parentJob = jobId;
    tasks.set(task.id, task);
    job.state = "scheduling";
    scheduled++;
    broadcast("task:assigned", { task, microWorkload: mw, decision, jobId });
    // Execute on assigned node
    executeTaskOnNode(task.id, mw);
  }
  if (scheduled > 0) emitNetworkState();
  return { scheduled };
}

async function executeTaskOnNode(taskId, microWorkload) {
  const task = tasks.get(taskId);
  if (!task) return;
  const node = nodes.get(task.nodeId);
  if (!node) {
    task.state = TaskState.FAILED;
    broadcast("task:failed", { taskId, reason: "node not found" });
    return;
  }

  task.state = TaskState.RUNNING;
  task.startedAt = now();
  broadcast("task:running", { taskId, nodeId: task.nodeId });

  try {
    const result = await node.executor.execute(task, microWorkload);
    task.state = TaskState.COMPLETED;
    task.completedAt = now();
    task.resultCid = result.outputUri;
    storage.add(result.outputUri);

    // Generate proof + verify
    const inputHash = sha256(microWorkload.inputs.join(","));
    const outputHash = sha256(inputHash + result.outputUri);
    const proof = verifier.generateProof({
      method: VerificationMethod.SIGNED_HASH,
      nodeId: task.nodeId,
      inputHash,
      outputHash,
      payload: `proof:${taskId}`,
    });
    const verdict = verifier.verify({ ...result, proof });
    if (!verdict.valid) {
      reputation.update(task.nodeId, { type: "verify_fail" });
      task.state = TaskState.FAILED;
      broadcast("task:verification_failed", { taskId, verdict });
      return;
    }
    reputation.update(task.nodeId, { type: "verify_pass" });

    // Reputation + credits (only after successful verification)
    reputation.update(task.nodeId, { type: "task_complete" });
    const cost = credits.getMeteredCost({ cpuSeconds: result.metrics.durationS || 1 });
    if (jobOwner(task.parentJob)) {
      credits.debit(jobOwner(task.parentJob), cost, "task_execution", taskId);
    }
    credits.credit(task.nodeId, cost, "task_reward", taskId);

    task.state = TaskState.VERIFIED;
    const job = jobs.get(task.parentJob);
    if (job) job.state = "completed";
    broadcast("task:completed", { task, result, proof, verdict, jobId: task.parentJob });
    emitNetworkState();

    // Schedule dependents
    scheduleReady(task.parentJob);
  } catch (e) {
    console.error("executeTaskOnNode error:", e);
    task.state = TaskState.FAILED;
    task.failureCount = (task.failureCount || 0) + 1;
    reputation.update(task.nodeId, { type: "task_fail" });
    broadcast("task:failed", { taskId, reason: e.message });
    // Reassign
    const mw = jobMicroWorkload(task.parentJob, task.microWorkloadId);
    if (mw && task.failureCount < 3) {
      setTimeout(() => {
        const reassigned = scheduler.reassignOnFailure(task, mw, "web-user");
        if (reassigned) {
          const { decision, task: newTask } = reassigned;
          newTask.parentJob = task.parentJob;
          tasks.set(newTask.id, newTask);
          broadcast("task:reassigned", { oldTaskId: taskId, newTask, decision });
          executeTaskOnNode(newTask.id, mw);
        }
      }, 1000);
    }
  }
}

function jobOwner(jobId) {
  const job = jobs.get(jobId);
  return job ? job.submitterId : null;
}

function jobMicroWorkload(jobId, mwId) {
  const job = jobs.get(jobId);
  return job ? job.microWorkloads.find((m) => m.id === mwId) : null;
}

// Reputation / credits
app.get("/api/reputation", (req, res) => {
  const out = {};
  for (const nodeId of nodes.keys()) out[nodeId] = reputation.get(nodeId);
  res.json({ scores: out });
});

app.get("/api/credits", (req, res) => {
  const out = {};
  for (const nodeId of nodes.keys()) out[nodeId] = credits.balance(nodeId);
  res.json({ balances: out, stats: credits.stats() });
});

app.post("/api/credits/transfer", (req, res) => {
  const { from, to, amount } = req.body;
  const ok = credits.transfer(from, to, amount, "transfer", "manual");
  res.json({ ok, fromBalance: credits.balance(from), toBalance: credits.balance(to) });
});

// ---- Socket.io ----
io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);
  socket.emit("network:state", { nodes: allNodesSnapshot(), nodeCount: nodes.size, timestamp: now() });

  socket.on("node:register", (data, cb) => {
    try {
      const id = data.nodeId || generateNodeId();
      const caps = (data.capabilities || [
        { type: ComputeType.CPU, count: 2 },
        { type: ComputeType.GPU, count: 1 },
      ]).map((c) => new Capability(c));
      const record = new NodeRecord({
        nodeId: id,
        multiaddrs: data.multiaddrs || [`/ip4/127.0.0.1/tcp/0/p2p/${id}`],
        capabilities: caps,
        reputation: 1.0,
        geoRegion: data.geoRegion || "unknown",
        bandwidthMbps: data.bandwidthMbps || 100,
        mode: data.mode || NodeMode.CLIENT,
        sandboxTypes: data.sandboxTypes || [SandboxType.WASM],
        stakeCredits: data.stakeCredits || 0,
      });
      discovery.register(record);
      nodes.set(id, { record, telemetry: new Telemetry({ nodeId: id }), socketId: socket.id, executor: new Executor({ nodeId: id, sandbox: new StubSandbox() }) });
      credits.ensure(id);
      socket.join(`node:${id}`);
      socket.data.nodeId = id;
      cb && cb({ ok: true, nodeId: id, record: record.toDict() });
      broadcast("node:joined", nodeSnapshot(id));
      emitNetworkState();
    } catch (e) { cb && cb({ ok: false, error: e.message }); }
  });

  socket.on("node:heartbeat", (data, cb) => {
    const nodeId = socket.data.nodeId || data.nodeId;
    const n = nodes.get(nodeId);
    if (!n) return cb && cb({ ok: false, error: "node not registered" });
    const telemetry = new Telemetry({
      nodeId,
      seq: data.seq || 0,
      cpuUtil: data.cpuUtil ?? 25,
      gpuUtil: data.gpuUtil ?? 40,
      memUsedMib: data.memUsedMib ?? 2048,
      memTotalMib: data.memTotalMib ?? 8192,
      netRxMbps: data.netRxMbps ?? 50,
      netTxMbps: data.netTxMbps ?? 50,
      latencyMs: data.latencyMs ?? 10,
      activeTasks: data.activeTasks ?? scheduler.getTasksForNode(nodeId).length,
      maxConcurrentTasks: data.maxConcurrentTasks ?? 4,
      uptimeS: data.uptimeS ?? now(),
      natStatus: data.natStatus,
    });
    n.telemetry = telemetry;
    scheduler.updateTelemetry(telemetry);
    discovery.ingestHeartbeat(nodeId, n.record.multiaddrs, telemetry);
    reputation.update(nodeId, { type: "heartbeat", latencyMs: telemetry.latencyMs });
    cb && cb({ ok: true, seq: telemetry.seq });
    broadcast("node:heartbeat", { nodeId, telemetry: telemetry.toDict() });
    emitNetworkState();
  });

  socket.on("disconnect", () => {
    const nodeId = socket.data.nodeId;
    if (nodeId && nodes.has(nodeId)) {
      const n = nodes.get(nodeId);
      n.socketId = null;
      broadcast("node:left", { nodeId });
      emitNetworkState();
    }
  });
});

// Stale node cleanup interval
setInterval(() => {
  const stale = discovery.staleNodes();
  for (const nodeId of stale) {
    if (nodes.has(nodeId) && !nodes.get(nodeId).socketId) {
      broadcast("node:suspect", { nodeId, reason: "heartbeat timeout" });
    }
  }
  if (stale.length) emitNetworkState();
}, 10000);

server.listen(PORT, () => {
  console.log(`Project NEXUS server listening on http://localhost:${PORT}`);
});

module.exports = { app, server, io, discovery, scheduler, verifier, storage, reputation, credits, nodes, jobs, tasks };
