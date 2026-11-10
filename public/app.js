"use strict";

const socket = io({ transports: ["websocket", "polling"] });
const connStatus = document.getElementById("connStatus");
const connDot = connStatus.querySelector(".dot");

// Navigation
const sections = document.querySelectorAll(".section");
const navLinks = document.querySelectorAll(".nav-link");
const menuToggle = document.getElementById("menuToggle");
const navLinksEl = document.getElementById("navLinks");

function showSection(id) {
  sections.forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  navLinks.forEach((l) => l.classList.toggle("active", l.dataset.section === id));
  if (navLinksEl.classList.contains("open")) navLinksEl.classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
navLinks.forEach((l) => {
  l.addEventListener("click", (e) => {
    e.preventDefault();
    showSection(l.dataset.section);
  });
});
menuToggle.addEventListener("click", () => navLinksEl.classList.toggle("open"));

// Socket events
socket.on("connect", () => {
  connDot.classList.add("connected");
  connStatus.querySelector("span:last-child").textContent = "Connected";
});
socket.on("disconnect", () => {
  connDot.classList.remove("connected");
  connStatus.querySelector("span:last-child").textContent = "Disconnected";
});

// Renderers
function escapeHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}
function shortId(id) {
  if (!id) return "—";
  return id.length > 16 ? id.slice(0, 14) + "…" : id;
}
function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function pct(n) {
  return (n * 100).toFixed(0) + "%";
}

let activityFeed = document.getElementById("activityFeed");
function addActivity(html, meta) {
  const div = document.createElement("div");
  div.className = "feed-item";
  div.innerHTML = `<span>${html}</span>${meta ? `<span class="meta">${meta}</span>` : ""}`;
  if (activityFeed.children.length === 1 && activityFeed.children[0].classList.contains("empty")) {
    activityFeed.innerHTML = "";
  }
  activityFeed.prepend(div);
  while (activityFeed.children.length > 60) activityFeed.lastChild.remove();
}

// Nodes
function renderNodes(nodeList) {
  const body = document.getElementById("nodesBody");
  body.innerHTML = "";
  if (!nodeList.length) {
    body.innerHTML = `<tr><td colspan="9" style="color:var(--text-muted)">No nodes registered.</td></tr>`;
    return;
  }
  for (const n of nodeList) {
    const tr = document.createElement("tr");
    const caps = (n.capabilities || []).map((c) => `${c.type}×${c.count}`).join(", ") || "—";
    const tel = n.telemetry || {};
    const rep = (n.reputation || 0).toFixed(2);
    const repColor = rep >= 0.8 ? "var(--success)" : rep >= 0.5 ? "var(--warn)" : "var(--danger)";
    const connected = n.connected ? "Online" : "Offline";
    const connectedClass = n.connected ? "state-running" : "state-failed";
    tr.innerHTML = `
      <td><code>${shortId(n.nodeId)}</code></td>
      <td>${escapeHtml(n.geoRegion || "unknown")}</td>
      <td style="font-size:0.75rem">${escapeHtml(caps)}</td>
      <td>${tel.cpuUtil !== undefined ? tel.cpuUtil.toFixed(0) + "%" : "—"}</td>
      <td>${tel.gpuUtil !== undefined ? tel.gpuUtil.toFixed(0) + "%" : "—"}</td>
      <td>${tel.memUsedMib !== undefined ? (tel.memUsedMib / 1024).toFixed(1) + " GiB" : "—"}</td>
      <td>${tel.activeTasks !== undefined ? tel.activeTasks : 0}</td>
      <td><span class="state-badge" style="color:${repColor}">${rep}</span></td>
      <td><span class="state-badge ${connectedClass}">${connected}</span></td>
    `;
    body.appendChild(tr);
  }
}

// Jobs
function renderJobs(jobList) {
  const body = document.getElementById("jobsBody");
  body.innerHTML = "";
  if (!jobList.length) {
    body.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted)">No jobs submitted.</td></tr>`;
    return;
  }
  for (const j of jobList) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${shortId(j.id)}</code></td>
      <td>${escapeHtml(j.submitterId || "—")}</td>
      <td>${escapeHtml(j.requirements ? j.requirements.computeType : "—")}</td>
      <td>${j.microWorkloads ? j.microWorkloads.length : 0}</td>
      <td><span class="state-badge state-${(j.state || "submitted").toLowerCase()}">${escapeHtml(j.state || "submitted")}</span></td>
      <td>${j.budgetCredits !== undefined ? j.budgetCredits : 0}</td>
      <td>${formatTime(j.createdAt)}</td>
    `;
    body.appendChild(tr);
  }
}

// Credits & reputation
function renderEconomy(nodeList) {
  const tSupply = document.getElementById("econTotalSupply");
  const tAccounts = document.getElementById("econAccountCount");
  const tTx = document.getElementById("econTxCount");
  const body = document.getElementById("creditsBody");
  body.innerHTML = "";

  let totalSupply = 0;
  for (const n of nodeList) {
    const tr = document.createElement("tr");
    const rep = (n.reputation || 0).toFixed(2);
    const stake = n.stakeCredits !== undefined ? n.stakeCredits : 0;
    totalSupply += stake;
    tr.innerHTML = `
      <td><code>${shortId(n.nodeId)}</code></td>
      <td>${stake}</td>
      <td><span class="state-badge">${rep}</span></td>
      <td>${stake}</td>
      <td>${escapeHtml(n.mode || "client")}</td>
    `;
    body.appendChild(tr);
  }
  if (tSupply) tSupply.textContent = totalSupply.toFixed(0);
  if (tAccounts) tAccounts.textContent = nodeList.length;
  if (tTx) tTx.textContent = "—";
}

// Network state
function renderNetwork(state) {
  // Stats
  document.getElementById("statNodes").textContent = state.nodeCount || 0;
  document.getElementById("statJobs").textContent = state.jobCount || 0;
  document.getElementById("statTasks").textContent = state.taskCount || 0;

  // Nodes table
  renderNodes(state.nodes || []);

  // Credits/reputation
  renderEconomy(state.nodes || []);

  // Topology
  renderTopology(state.nodes || []);

  // Activity
  if (state.nodes && state.nodes.length) {
    addActivity(`${state.nodeCount} nodes online`, formatTime(state.timestamp));
  }
}

// Topology SVG
function renderTopology(nodes) {
  const svg = document.getElementById("topologySvg");
  const w = svg.clientWidth || 700;
  const h = svg.clientHeight || 420;
  svg.innerHTML = "";

  if (!nodes.length) return;

  // Place nodes in a circle + jitter
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.35;
  const positions = [];
  for (let i = 0; i < nodes.length; i++) {
    const angle = (i / nodes.length) * 2 * Math.PI + Math.PI / 2;
    const jitter = (Math.random() - 0.5) * 40;
    positions.push({
      x: cx + Math.cos(angle) * (r + jitter),
      y: cy + Math.sin(angle) * (r + jitter),
    });
  }

  // Draw edges (mesh among server nodes, star-ish otherwise)
  const serverNodes = nodes.filter((n) => n.mode === "server");
  const edgePoints = serverNodes.length ? serverNodes : nodes;
  for (let i = 0; i < edgePoints.length; i++) {
    for (let j = i + 1; j < edgePoints.length; j++) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", positions[i].x);
      line.setAttribute("y1", positions[i].y);
      line.setAttribute("x2", positions[j].x);
      line.setAttribute("y2", positions[j].y);
      line.setAttribute("stroke", "#262c3a");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("opacity", "0.4");
      svg.appendChild(line);
    }
  }

  // Draw nodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const pos = positions[i];
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${pos.x},${pos.y})`);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", n.mode === "server" ? 14 : 10);
    circle.setAttribute("fill", n.mode === "server" ? "#3b82f6" : "#64748b");
    circle.setAttribute("stroke", n.connected ? "#22c55e" : "#ef4444");
    circle.setAttribute("stroke-width", "2");
    g.appendChild(circle);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", 0);
    label.setAttribute("y", n.mode === "server" ? 20 : 16);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-family", "JetBrains Mono, mono");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#e8eaed");
    label.textContent = shortId(n.nodeId);
    g.appendChild(label);

    svg.appendChild(g);
  }
}

// Socket handlers
socket.on("network:state", (state) => {
  renderNetwork(state);
});
socket.on("node:joined", (node) => {
  addActivity(`Node joined <code>${shortId(node.nodeId)}</code>`, formatTime(Date.now() / 1000));
  socket.emit("get:state", {}, (s) => { if (s) renderNetwork(s); });
});
socket.on("node:left", (data) => {
  addActivity(`Node left <code>${shortId(data.nodeId)}</code>`);
});
socket.on("node:heartbeat", (data) => {
  const el = document.getElementById("healthHeartbeat");
  if (el) el.textContent = `last ${formatTime(Date.now() / 1000)}`;
});
socket.on("task:assigned", (data) => {
  addActivity(`Task assigned <code>${shortId(data.task.id)}</code> → <code>${shortId(data.task.nodeId)}</code>`);
});
socket.on("task:running", (data) => {
  addActivity(`Task running on <code>${shortId(data.nodeId)}</code>`);
});
socket.on("task:completed", (data) => {
  addActivity(`Task completed & verified <code>${shortId(data.task.id)}</code> (conf ${(data.verdict.confidence * 100).toFixed(0)}%)`);
});
socket.on("task:failed", (data) => {
  addActivity(`Task failed <code>${shortId(data.taskId)}</code>: ${escapeHtml(data.reason || "unknown")}`);
});
socket.on("task:reassigned", (data) => {
  addActivity(`Task reassigned → <code>${shortId(data.newTask.nodeId)}</code>`);
});
socket.on("job:submitted", (data) => {
  addActivity(`Job submitted <code>${shortId(data.job.id)}</code> (${data.job.numPartitions} partitions)`);
});
socket.on("node:suspect", (data) => {
  addActivity(`⚠ Node suspect <code>${shortId(data.nodeId)}</code> (heartbeat timeout)`, "warning");
});

// Request initial state
socket.on("connect", () => {
  socket.emit("get:state", {}, (s) => { if (s) renderNetwork(s); });
});

// Actions
async function registerNode() {
  const geo = prompt("Geo region (e.g. us-east):", "us-east");
  if (geo === null) return;
  const caps = prompt("Capabilities (comma-separated, e.g. cpu:2,gpu:1):", "cpu:2,gpu:1");
  if (caps === null) return;
  const capList = caps.split(",").map((c) => {
    const [type, count = 1] = c.trim().split(":");
    return { type, count: parseInt(count) || 1 };
  }).filter((c) => c.type);
  try {
    const res = await apiPost("/api/nodes", {
      geoRegion: geo,
      capabilities: capList,
      mode: "client",
      sandboxTypes: ["wasm"],
      stakeCredits: 10,
    });
    addActivity(`Registered node <code>${shortId(res.nodeId)}</code>`);
    renderNetwork({ nodeCount: 1, nodes: [res.record], jobCount: 0, taskCount: 0, timestamp: Date.now() / 1000 });
  } catch (e) {
    alert("Failed to register node: " + e.message);
  }
}

function showJobForm() {
  document.getElementById("jobFormCard").style.display = "block";
  document.getElementById("jobFormCard").scrollIntoView({ behavior: "smooth" });
}
function hideJobForm() {
  document.getElementById("jobFormCard").style.display = "none";
}

document.getElementById("jobForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    submitterId: fd.get("submitterId"),
    requirements: {
      computeType: fd.get("computeType"),
      minCores: parseInt(fd.get("minCores") || 1),
      minMemMib: parseInt(fd.get("minMemMib") || 512),
      minGpuMemMib: parseInt(fd.get("minGpuMemMib") || 0),
      maxLatencyMs: parseInt(fd.get("maxLatencyMs") || 5000),
      geoRegion: [],
      privacyLevel: fd.get("privacyLevel"),
    },
    numPartitions: parseInt(fd.get("numPartitions") || 1),
    requiresSequential: fd.get("requiresSequential") === "true",
    estimatedRuntimeS: parseInt(fd.get("estimatedRuntimeS") || 300),
    budgetCredits: parseInt(fd.get("budgetCredits") || 1000),
    privacyLevel: fd.get("privacyLevel"),
    verificationMethod: fd.get("verificationMethod"),
  };
  try {
    const res = await apiPost("/api/jobs", body);
    addActivity(`Job submitted <code>${shortId(res.job.id)}</code> — ${res.job.numPartitions} partitions`);
    hideJobForm();
    e.target.reset();
  } catch (err) {
    alert("Failed to submit job: " + err.message);
  }
});

// API helpers
async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Periodic refresh
setInterval(() => {
  fetch("/api/stats").then((r) => r.json()).then((s) => {
    document.getElementById("statCredits").textContent = (s.credits && s.credits.totalSupply !== undefined) ? s.credits.totalSupply.toFixed(0) : "—";
  }).catch(() => {});
}, 5000);
