#!/usr/bin/env node
// A fake OATS_CLI_BIN for unit tests ONLY. It models the real kernel 0.34.0's
// output shapes AND its refusals, so a test cannot pass on a call the real
// binary would refuse (integrations lesson):
//   - `status --json`, `capture --home`, `recall … --json` answer bare JSON;
//     everything else answers { schemaVersion: 1, ok, result | error };
//   - `capture --home` exits 1 with a JSON body on failure; `recall` with an
//     unknown thread or --until id prints to stderr only and exits 1;
//   - spawn refuses what bin/oats.mjs refuses: unknown flags, --relation
//     unrelated with --relative-to, a relation without --relative-to,
//     --parent with --relation, --name with --purpose, unknown souls and
//     anchors, names over 64 characters (with details.maxPurpose), taken
//     names, unknown --base refs, and an apply whose --expect-decision does
//     not match (E_DECISION_STALE with the fresh decision);
//   - `session upload` stores <home>/.oats-attachments/<basename> 0600,
//     taking name-2 when taken; `session input` needs a launched instance.
// State lives in the JSON file FAKE_OATS_STATE; every call is appended to
// FAKE_OATS_LOG with its argv, cwd and environment variable names.
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";

const statePath = process.env.FAKE_OATS_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const argv = process.argv.slice(2);
if (process.env.FAKE_OATS_LOG) appendFileSync(process.env.FAKE_OATS_LOG, JSON.stringify({ argv, cwd: process.cwd(), env: Object.keys(process.env).sort() }) + "\n");

const ok = (result) => { process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: true, result }) + "\n"); process.exit(0); };
const refuse = (code, message, details) => { process.stdout.write(JSON.stringify({ schemaVersion: 1, ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } }) + "\n"); process.exit(1); };
const bare = (value, exit = 0) => { process.stdout.write(JSON.stringify(value, null, 2) + "\n"); process.exit(exit); };
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };
const has = (name) => argv.includes(`--${name}`);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const agentDirOf = (soul) => soul.includes("/") ? soul.replace(".", "-").replace("/", "--") : soul;
const sha = (b) => createHash("sha256").update(b).digest("hex");

const [cmd, sub] = argv;

if (cmd === "status") {
  const agents = new Map();
  for (const inst of Object.values(state.instances)) {
    if (!agents.has(inst.agent)) agents.set(inst.agent, { name: inst.agent, instances: [] });
    agents.get(inst.agent).instances.push({ agent: inst.agent, instance: inst.name, home: inst.home, work: inst.work ?? "directory", running: inst.running === true });
  }
  bare({ root: state.agentsRoot, agents: [...agents.values()], workspace: { reachable: true } });
}

if (cmd === "capture") {
  const home = flag("home");
  const c = state.capture?.[home];
  if (!c) bare({ home, owner: "test", appended: null, skipped: false, held: 0, incomplete: 0, failed: 1, ignored: 0, status: "failed", complete: false, sessions: [], sourceRoots: "launch-history", error: "no sessions recorded for this home" }, 1);
  bare({ home, owner: "test", appended: 0, skipped: false, held: 0, incomplete: c.complete ? 0 : 1, failed: 0, ignored: 0, status: c.complete ? "complete" : "incomplete", complete: c.complete, sessions: c.sessions.map((s) => ({ thread: s.thread, source: "cc", sessionId: s.sessionId, path: "/x", cwd: home, stream: `test~claude.${s.sessionId}`, turns: s.ids.length, firstTurnId: s.ids[0], lastTurnId: s.ids.at(-1), lastTs: "2026-10-01T00:00:00Z" })), sourceRoots: "launch-history" });
}

if (cmd === "recall") {
  const thread = flag("thread");
  const ids = Object.values(state.capture || {}).flatMap((c) => c.sessions).find((s) => s.thread === thread)?.ids;
  if (!ids) { process.stderr.write(`--until: no turn in thread ${thread}\n`); process.exit(1); }
  const until = flag("until");
  let end = ids.length;
  if (until) { const i = ids.indexOf(until); if (i < 0) { process.stderr.write(`--until: no turn ${until} in thread ${thread}\n`); process.exit(1); } end = i + 1; }
  bare({ thread, total: ids.length, from: 0, to: end, remaining: 0, turns: ids.slice(0, end).map((id) => ({ id, ts: "2026-10-01T00:00:00Z", thread, kind: "session", source: "cc", bytes: 100 })) });
}

if (cmd === "launch-config" && sub === "list") ok({ context: process.cwd(), level: null, file: null, selected: null, configurations: (state.launchConfigs || []).map((name) => ({ name })) });

if (cmd === "spawn") {
  const VALUES = new Set(["base", "expect-decision", "harness", "launch-config", "model", "name", "parent", "purpose", "relation", "relative-to", "task-file"]);
  const SWITCHES = new Set(["json", "no-child-spawns", "allow-child-spawns", "no-launch", "no-yolo", "preview", "yolo"]);
  const soul = argv[1];
  const providers = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider") { const [k, v] = argv[i + 2].split("="); (providers[argv[i + 1]] ??= {})[k] = v; i += 2; continue; }
    if (!a.startsWith("--")) refuse("E_BAD_ARGS", `oats spawn: unexpected argument ${JSON.stringify(a)} after the soul`);
    const name = a.slice(2);
    if (SWITCHES.has(name)) continue;
    if (!VALUES.has(name)) refuse("E_BAD_ARGS", `oats spawn: unknown flag ${a}`);
    i++;
  }
  if (!state.souls.includes(soul)) refuse("E_SOUL_UNKNOWN", `no soul "${soul}" among the confirmed members, external souls or package souls of this workspace`);
  if (flag("name") && flag("purpose")) refuse("E_BAD_ARGS", "--name and --purpose are mutually exclusive");
  if (has("yolo") && has("no-yolo")) refuse("E_BAD_ARGS", "--yolo and --no-yolo contradict");
  let relation = flag("relation"), relativeTo = flag("relative-to");
  const parent = flag("parent");
  if (relation && !["child", "sibling", "parent", "unrelated"].includes(relation)) refuse("E_BAD_ARGS", `unknown --relation "${relation}"`);
  if (relation && relation !== "unrelated" && !relativeTo) refuse("E_BAD_ARGS", `--relation ${relation} requires --relative-to <instance>`);
  if (relativeTo && !relation) refuse("E_BAD_ARGS", "--relative-to requires --relation child|sibling|parent");
  if (relation === "unrelated" && relativeTo) refuse("E_BAD_ARGS", "--relation unrelated takes no --relative-to");
  if (parent && (relation || relativeTo)) refuse("E_BAD_ARGS", "--parent is sugar for --relative-to <instance> --relation child — use one form, not both");
  if (parent) { relation = "child"; relativeTo = parent; }
  if (relativeTo && relation !== "unrelated" && !state.instances[relativeTo]) refuse(parent ? "E_PARENT_NOT_FOUND" : "E_RELATIVE_NOT_FOUND", `"${relativeTo}" does not match any known instance`);
  const taskFile = flag("task-file");
  if (taskFile && !existsSync(taskFile)) refuse("E_BAD_ARGS", `--task-file not found: ${taskFile}`);
  const base = flag("base");
  if (base && (state.unknownRefs || []).includes(base)) refuse("E_BASE_UNKNOWN", `base ${JSON.stringify(base)} does not resolve to a commit`);
  const agent = state.agentNames?.[soul] ?? agentDirOf(soul);
  let instance = flag("name");
  if (!instance) {
    const purpose = flag("purpose");
    instance = purpose ? `${slug(agent)}-${slug(purpose)}` : `${slug(agent)}-1`;
    if (instance.length > 64) refuse("E_INSTANCE_NAME_INVALID", `instance names are at most 64 characters; "${instance}" is ${instance.length}`, { prefix: `${slug(agent)}-`, purpose: slug(purpose), maxPurpose: 64 - slug(agent).length - 1 });
  }
  if (state.instances[instance]) refuse("E_INSTANCE_NAME_TAKEN", `instance name "${instance}" is taken`, { instance, home: state.instances[instance].home });
  const home = join(state.agentsRoot, agent, "instances", instance);
  const harness = flag("harness") ?? "claude";
  const model = flag("model") ?? null;
  const settings = state.spawnSettings ?? { "oats.aweb": { delivery: "session", identity: { mode: "local" } } };
  const decisionCore = { instance, home, relation: relation ?? null, relativeTo: relativeTo ?? null, harness, model, launchConfig: flag("launch-config") ?? null, yolo: has("yolo") ? true : has("no-yolo") ? false : null, base: base ?? null, childSpawns: !has("no-child-spawns"), providers, settings, launch: !has("no-launch"), version: state.version ?? 0 };
  const revision = sha(JSON.stringify(decisionCore)).slice(0, 24);
  const decision = { instance, home, branch: null, base: base ? { ref: base, oid: "a".repeat(40) } : null, revision };
  const task = taskFile ? readFileSync(taskFile, "utf8") : "";
  if (has("preview")) ok({ spawnPreviewApi: 2, preview: true, agent, instance, home, work: "directory", harness, model, launchConfig: decisionCore.launchConfig, yolo: decisionCore.yolo, branch: null, base: decision.base, relation: relation ?? null, parentInstance: relation === "child" ? relativeTo : null, decision, settings, task: task || null });
  const expect = flag("expect-decision");
  if (expect !== undefined && expect !== revision) refuse("E_DECISION_STALE", `the previewed decision changed (${expect} → ${revision}); preview again`, { decision });
  const ov = state.applyOverrides || {};
  mkdirSync(join(home, ".aw"), { recursive: true });
  mkdirSync(join(home, "work"), { recursive: true });
  writeFileSync(join(home, "TASK.md"), `# Instance briefing: ${instance}\n\nYou are instance "${instance}".\n${task.trim() && !ov.dropTask ? `\n## Task\n\n${task.trim()}\n` : "\nNo task was provided at spawn time — await instructions.\n"}`);
  chmodSync(join(home, "TASK.md"), 0o644);
  const meta = {
    agent, instance, home, work: "directory", harness, model: model ?? undefined,
    ...(decisionCore.yolo !== null ? { yolo: decisionCore.yolo } : {}),
    parentInstance: relation === "child" ? relativeTo : undefined,
    relation: ov.relation ?? relation ?? undefined, relativeTo: relation && relation !== "unrelated" ? relativeTo : undefined,
    spawnOrigin: relation ? "instance" : "operator",
    capabilityMeta: { "oats.aweb": { alias: ov.alias ?? instance, identity: { mode: "local", alias: ov.alias ?? instance } } },
    launch: { harness, hooks: { env: ov.noIdentityEnv ? { AWEB_DELIVERY: "session" } : { AWEB_IDENTITY_HOME: ov.identityHome ?? join(home, ".aw") } } },
    workspace: { soul: soul.includes("/") ? { qualifiedName: soul, name: soul.split("/")[1] } : { id: `github.com/acme/agents#${soul}` } },
    providers, launched: !has("no-launch"), decision: expect !== undefined ? decision : undefined,
  };
  writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2));
  state.instances[instance] = { name: instance, agent, home, running: !has("no-launch"), work: "directory" };
  state.spawned = [...(state.spawned || []), { instance, providers, env: Object.keys(process.env).sort() }];
  save();
  ok({ ...meta, replayed: false });
}

if (cmd === "session") {
  const home = flag("home");
  const inst = Object.values(state.instances).find((i) => i.home === home);
  if (!inst) refuse("E_BAD_ARGS", `no instance home at ${home}`);
  if (sub === "upload") {
    if (state.uploadFails) refuse("E_UPLOAD_FAILED", "upload refused by the test");
    const file = flag("file");
    const bytes = readFileSync(file);
    const dir = join(home, ".oats-attachments");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = basename(file), ext = extname(name), stem = name.slice(0, name.length - ext.length);
    let path = join(dir, name);
    for (let n = 2; existsSync(path); n++) path = join(dir, `${stem}-${n}${ext}`);
    copyFileSync(file, path);
    chmodSync(path, state.uploadMode ?? 0o600);
    ok({ path, bytes: bytes.length, sha256: sha(bytes), name, home, source: file });
  }
  if (sub === "start") {
    if (state.startFails) refuse("E_LAUNCH_COMMAND_UNSUPPORTED", "instance has no valid persisted launch command to start from");
    inst.running = true;
    const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
    meta.launched = true;
    writeFileSync(join(home, "instance.json"), JSON.stringify(meta, null, 2));
    save();
    ok({ instance: inst.name, home, harness: meta.harness, backend: "tmux", reused: false, warnings: [] });
  }
  if (sub === "input") {
    if (!inst.running) refuse("E_SESSION_NOT_RUNNING", "instance was not launched");
    state.inputs = [...(state.inputs || []), { home, text: readFileSync(flag("text-file"), "utf8") }];
    save();
    ok({ home, submitted: true });
  }
}

refuse("E_USAGE", `fake oats: unsupported command ${argv.slice(0, 2).join(" ")}`);
