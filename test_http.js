"use strict";

const http = require("http");

const BASE = "http://localhost:3000";

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname, method, headers: {} };
    if (body) opts.headers["Content-Type"] = "application/json";
    const r = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  // 1. Register two nodes
  const n1 = await req("POST", "/api/nodes", {
    nodeId: "node:alpha",
    geoRegion: "us-east",
    capabilities: [{ type: "cpu", count: 4 }, { type: "gpu", count: 1 }],
    sandboxTypes: ["wasm", "firecracker"],
    stakeCredits: 50,
  });
  console.log("node1:", n1.status, JSON.parse(n1.body).nodeId);

  const n2 = await req("POST", "/api/nodes", {
    nodeId: "node:beta",
    geoRegion: "eu-west",
    capabilities: [{ type: "cpu", count: 8 }, { type: "gpu", count: 2 }],
    sandboxTypes: ["wasm"],
    stakeCredits: 30,
  });
  console.log("node2:", n2.status, JSON.parse(n2.body).nodeId);

  // 2. Heartbeats
  await req("POST", "/api/nodes/node:alpha/heartbeat", { seq: 1, cpuUtil: 20, gpuUtil: 30, activeTasks: 0, maxConcurrentTasks: 4, latencyMs: 10 });
  await req("POST", "/api/nodes/node:beta/heartbeat", { seq: 1, cpuUtil: 10, gpuUtil: 10, activeTasks: 0, maxConcurrentTasks: 8, latencyMs: 20 });

  // 3. Submit job
  const job = await req("POST", "/api/jobs", {
    submitterId: "user:web",
    requirements: { computeType: "gpu", minCores: 2, minMemMib: 4096, minGpuMemMib: 8192 },
    numPartitions: 2,
    requiresSequential: false,
    estimatedRuntimeS: 300,
    budgetCredits: 1000,
    privacyLevel: "public",
    verificationMethod: "signed-hash",
  });
  console.log("job:", job.status, JSON.parse(job.body).job.id);

  // 4. Wait briefly for scheduling + execution
  await new Promise((r) => setTimeout(r, 1500));

  // 5. Check job state
  const j = await req("GET", "/api/jobs/" + JSON.parse(job.body).job.id);
  const jd = JSON.parse(j.body);
  console.log("job state:", jd.job.state, "tasks:", jd.tasks.length);
  for (const t of jd.tasks) {
    console.log("  task", t.id.slice(-6), t.state, "->", t.nodeId.slice(-6));
  }

  // 6. Stats
  const st = await req("GET", "/api/stats");
  console.log("stats:", st.body);

  // 7. Reputation
  const rep = await req("GET", "/api/reputation");
  console.log("reputation:", rep.body);

  // 8. Credits
  const cr = await req("GET", "/api/credits");
  console.log("credits:", cr.body);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
