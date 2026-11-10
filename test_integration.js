"use strict";

const assert = require("assert");
const {
  generateId, sha256, now, ComputeType, PrivacyLevel,
  TaskState, VerificationMethod, SandboxType, NodeMode,
} = require("./nexus/types");
const { NodeRecord, Capability, Telemetry } = require("./nexus/node");
const { Discovery } = require("./nexus/discovery");
const { Scheduler } = require("./nexus/scheduler");
const { Executor, StubSandbox, Task } = require("./nexus/executor");
const { Verifier } = require("./nexus/verification");
const { IpfsStore } = require("./nexus/storage");
const { ReputationEngine, CreditLedger } = require("./nexus/reputation");

// 1. Types
assert.strictEqual(typeof generateId("job"), "string");
assert.strictEqual(sha256("nexus").length, 64);
assert(ComputeType.GPU === "gpu");
assert(TaskState.COMPLETED === "completed");
console.log("✓ types");

// 2. Node + capability
const cap = new Capability({ type: ComputeType.GPU, count: 2 });
assert(cap.matches(new Capability({ type: ComputeType.GPU, count: 1 })));
assert(!cap.matches(new Capability({ type: ComputeType.CPU, count: 1 })));
const rec = new NodeRecord({ nodeId: "node:test", capabilities: [cap], geoRegion: "us-east" });
assert(rec.hasCapability(ComputeType.GPU, 1));
assert(rec.hasCapability(ComputeType.GPU, 2));
assert(!rec.hasCapability(ComputeType.GPU, 3));
assert.deepStrictEqual(rec.toDict().nodeId, "node:test");
console.log("✓ node + capability");

// 3. Discovery
const disc = new Discovery({ nodeId: "node:bootstrap", mode: NodeMode.SERVER });
disc.register(rec);
assert.strictEqual(disc.getRecord("node:test").nodeId, "node:test");
const found = disc.lookupByCapability({ capType: ComputeType.GPU, minCount: 1 });
assert.strictEqual(found.length, 1);
const empty = disc.lookupByCapability({ capType: ComputeType.TPU });
assert.strictEqual(empty.length, 0);
disc.ingestHeartbeat("node:test", ["/ip4/127.0.0.1/tcp/0"]);
assert(disc.staleNodes().length === 0);
console.log("✓ discovery");

// 4. Scheduler scoring & assignment
const sched = new Scheduler(disc);
const tel = new Telemetry({ nodeId: "node:test", cpuUtil: 20, gpuUtil: 30, activeTasks: 0, maxConcurrentTasks: 4 });
sched.updateTelemetry(tel);
const mw = {
  id: "job1:mw:0",
  parentJob: "job1",
  index: 0,
  inputs: ["ipfs://QmIn"],
  outputs: ["ipfs://QmOut:0"],
  requirements: { computeType: ComputeType.GPU, minCores: 1 },
  dependsOn: [],
  estimatedRuntimeS: 300,
};
const out = sched.schedule(mw, "us-east");
assert(out);
assert.strictEqual(out.decision.nodeId, "node:test");
assert.ok(out.decision.score > 0);
assert.ok(out.task);
assert.strictEqual(out.task.state, TaskState.ASSIGNED);
// No more capacity after assigning to a full node
const fullTel = new Telemetry({ nodeId: "node:test", cpuUtil: 10, gpuUtil: 10, activeTasks: 4, maxConcurrentTasks: 4 });
sched.updateTelemetry(fullTel);
const noCap = sched.schedule(mw, "us-east");
assert.strictEqual(noCap, null);
console.log("✓ scheduler");

// 5. Reassignment
const rec2 = new NodeRecord({
  nodeId: "node:b",
  capabilities: [new Capability({ type: ComputeType.GPU, count: 1 })],
  geoRegion: "us-east",
});
disc.register(rec2);
const tel2 = new Telemetry({ nodeId: "node:b", cpuUtil: 10, gpuUtil: 10, activeTasks: 0, maxConcurrentTasks: 4 });
sched.updateTelemetry(tel2);
const failedTask = { state: TaskState.ASSIGNED, nodeId: "node:test", failureCount: 0, microWorkloadId: mw.id };
const reassigned = sched.reassignOnFailure(failedTask, mw, "us-east");
assert(reassigned);
assert.strictEqual(reassigned.task.nodeId, "node:b");
assert.strictEqual(failedTask.state, TaskState.REASSIGNED);
console.log("✓ reassignment");

// 6. Executor + checkpointing
(async () => {
const exec = new Executor({ nodeId: "node:exec", sandbox: new StubSandbox({ latencyS: 0.01 }) });
const t = new Task({ id: "task:1", microWorkloadId: mw.id, nodeId: "node:exec" });
const result = await exec.execute(t, mw);
assert.strictEqual(t.state, TaskState.COMPLETED);
assert.ok(result.outputUri.startsWith("ipfs://"));
assert.ok(result.checkpointCid);
assert.strictEqual(exec.checkpoints[t.id].length, 3);
const resumed = exec.resumeFromCheckpoint(t.id, result.checkpointCid);
assert(resumed);
console.log("✓ executor + checkpointing");

// 7. Verification
const verifier = new Verifier();
const inputHash = sha256("in");
const outputHash = sha256(inputHash + result.outputUri);
const proof = verifier.generateProof({
  method: VerificationMethod.SIGNED_HASH,
  nodeId: "node:exec",
  inputHash,
  outputHash,
  payload: "stub",
});
const verdict = verifier.verify({ ...result, proof });
assert(verdict.valid);
assert.strictEqual(verdict.method, VerificationMethod.SIGNED_HASH);
// zk-stark
const starkProof = verifier.generateProof({ method: VerificationMethod.ZK_STARK, nodeId: "n", inputHash, outputHash, payload: "x" });
const starkVerdict = verifier.verify({ ...result, proof: starkProof });
assert(starkVerdict.valid);
// No proof -> re-exec
const noProof = verifier.verify({ ...result, proof: undefined });
assert.strictEqual(noProof.method, VerificationMethod.RE_EXEC);
console.log("✓ verification");

// 8. Storage
const store = new IpfsStore();
const cid = store.add({ hello: "world" });
assert(store.get(cid));
assert(store.pin(cid, "node:1"));
assert.strictEqual(store.stats().totalObjects, 1);
console.log("✓ storage (IPFS)");

// 9. Reputation
const rep = new ReputationEngine();
rep.update("node:a", { type: "task_complete" });
rep.update("node:a", { type: "verify_pass" });
rep.update("node:a", { type: "task_fail" });
const score = rep.compute("node:a");
assert.ok(score >= 0 && score <= 1);
console.log("✓ reputation:", score.toFixed(3));

// 10. Credits
const ledger = new CreditLedger();
ledger.credit("node:a", 100, "reward", "task:1");
assert.strictEqual(ledger.balance("node:a"), 100);
const ok = ledger.debit("node:a", 30, "cost", "task:2");
assert(ok);
assert.strictEqual(ledger.balance("node:a"), 70);
const fail = ledger.debit("node:a", 1000, "cost", "task:3");
assert(!fail);
assert.strictEqual(ledger.balance("node:a"), 70);
const cost = ledger.getMeteredCost({ cpuSeconds: 10, gpuSeconds: 5 });
assert.ok(cost > 0);
console.log("✓ credits:", ledger.balance("node:a"), "metered cost:", cost.toFixed(4));

console.log("\nAll core integration tests passed ✅");
})();
