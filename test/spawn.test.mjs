import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { FIXED_NOW, SETTINGS, codeOf, lib, makeWorld } from "./helpers/world.mjs";
import { CLONER, addCloner, makeRequest } from "./helpers/cloner.mjs";

const { dossier } = await lib("dossier");
const { spawnClone } = await lib("spawn");
const { HEADINGS } = await lib("brief");

const BODY_MARKER = "BODY-ONLY-MARKER-7f3a";
const whoami = (idHome) => (idHome ? { did: `did:key:z${basename(dirname(idHome))}`, alias: basename(dirname(idHome)) } : null);

function body(request, extra = {}) {
  return HEADINGS.map((h) => `## ${h}\n\n${extra[h] ?? (h === "Your goal" ? request.goal : h === "What is verified" ? `- teal (${BODY_MARKER})` : "None.")}\n`).join("\n");
}

function setup(t, { request = makeRequest(), srcMeta = {}, srcWork = "directory", settings = SETTINGS } = {}) {
  const w = makeWorld(t);
  w.addInstance({ name: "src-1", work: srcWork, meta: { work: srcWork, ...srcMeta }, files: { "STATE.md": "teal\n" } });
  w.addInstance({ name: "lead-1", agent: "lead" });
  const cl = addCloner(w, request);
  const env = { ...cl.env, OATS_SETTINGS: JSON.stringify(settings) };
  dossier(["src-1", "--transcript", "exclude"], { env, cwd: cl.home, now: FIXED_NOW });
  const clone = join(cl.home, "clone");
  const writeBrief = (text = body(request)) => writeFileSync(join(clone, "brief.md"), text);
  const writePlan = (over = {}) => {
    const plan = {
      version: 1, dossier: join(clone, "dossier.json"), soul: "worker", name: null, purpose: "teal-port",
      relation: request.relation, relativeTo: request.relativeTo,
      launch: { harness: "claude", model: "claude-test-1", launchConfig: null, yolo: null, childSpawns: true },
      work: { base: null }, providers: [], brief: join(clone, "brief.md"), ...over,
    };
    writeFileSync(join(clone, "plan.json"), JSON.stringify(plan));
    return join(clone, "plan.json");
  };
  writeBrief();
  const run = (argv, deps = {}) => spawnClone(argv ?? ["--plan", writePlan(), "--json"], { env, cwd: cl.home, now: FIXED_NOW, whoami, ...deps });
  return { w, cl, clone, request, writeBrief, writePlan, run };
}

const lastSpawn = (w) => w.calls().filter((c) => c.argv[0] === "spawn").at(-1).argv;

test("spawn: an unlaunched clone, a preamble-only TASK.md (0600), the brief as a 0600 attachment, then start and verify", (t) => {
  const { w, clone, run } = setup(t);
  const out = run();
  assert.equal(out.clone.instance, "worker-teal-port");
  assert.ok(out.checks.every((c) => c.ok), JSON.stringify(out.checks));
  const args = lastSpawn(w);
  assert.ok(args.includes("--no-launch"));
  assert.deepEqual(args.slice(args.indexOf("--relation"), args.indexOf("--relation") + 4), ["--relation", "sibling", "--relative-to", "src-1"]);
  assert.ok(!args.includes("--launch-config") && !args.includes("--yolo") && !args.includes("--no-yolo") && !args.includes("--no-child-spawns") && !args.includes("--provider"));
  const home = out.clone.home;
  const task = readFileSync(join(home, "TASK.md"), "utf8");
  assert.equal(statSync(join(home, "TASK.md")).mode & 0o777, 0o600);
  assert.match(task, /```oats-clone\n/);
  assert.match(task, /Read your brief first: `\.oats-attachments\/clone-brief\.md`/);
  assert.ok(!task.includes(BODY_MARKER), "the brief never goes into TASK.md");
  const attachment = join(home, ".oats-attachments", "clone-brief.md");
  assert.equal(statSync(attachment).mode & 0o777, 0o600);
  assert.ok(readFileSync(attachment, "utf8").includes(BODY_MARKER));
  assert.equal(out.attachment.sha256, out.brief.sha256);
  const order = w.calls().filter((c) => ["spawn", "session"].includes(c.argv[0])).map((c) => c.argv[0] === "spawn" ? (c.argv.includes("--preview") ? "preview" : "apply") : c.argv[1]);
  assert.deepEqual(order, ["preview", "apply", "upload", "start"]);
  for (const f of ["brief.md", "clone-task.md", "upload", "source", "dossier.json"]) assert.ok(!existsSync(join(clone, f)), `${f} is deleted after verification`);
  for (const f of ["receipt.json", "request.json", "plan.json"]) assert.ok(existsSync(join(clone, f)), `${f} stays as the cloner's evidence`);
  assert.ok(JSON.parse(readFileSync(join(clone, "receipt.json"), "utf8")).ok);
  for (const c of w.calls()) assert.ok(!c.env.some((k) => /^(AWEB_|PI_AGENT|OATS_INSTANCE)/.test(k)));
});

test("an independent clone passes --relation unrelated explicitly", (t) => {
  const { w, run } = setup(t, { request: makeRequest({ relation: "unrelated", relativeTo: null }) });
  const out = run();
  const args = lastSpawn(w);
  assert.equal(args[args.indexOf("--relation") + 1], "unrelated");
  assert.ok(!args.includes("--relative-to"));
  assert.ok(out.checks.find((c) => c.check === "relation").ok);
});

test("the requester's name, harvest off carried, a non-default launch configuration and the source's posture", (t) => {
  const { w, writePlan, run } = setup(t, {
    request: makeRequest({ name: "teal-clone" }),
    srcMeta: { yolo: false, policy: { childSpawns: { allowed: false } }, providers: { "oats.okf": { harvest: "off" } }, launch: { harness: "claude", launchConfig: "claude-work", launchConfigDefault: false } },
  });
  const launch = { harness: "claude", model: "claude-test-1", launchConfig: "claude-work", yolo: false, childSpawns: false };
  assert.equal(codeOf(() => run(["--plan", writePlan({ name: null, purpose: "x", launch })])), "E_CLONE_PLAN", "the requester's name");
  assert.equal(codeOf(() => run(["--plan", writePlan({ name: "teal-clone", purpose: null, launch })])), "E_CLONE_HARVEST", "harvest off not carried");
  assert.equal(codeOf(() => run(["--plan", writePlan({ name: "teal-clone", purpose: null, launch, providers: [{ capability: "oats.okf", key: "harvest", value: "on" }] })])), "E_CLONE_HARVEST", "never turned on");
  assert.equal(codeOf(() => run(["--plan", writePlan({ name: "teal-clone", purpose: null, launch: { ...launch, yolo: true }, providers: [{ capability: "oats.okf", key: "harvest", value: "off" }] })])), "E_CLONE_PLAN", "yolo is never escalated");
  const out = run(["--plan", writePlan({ name: "teal-clone", purpose: null, launch, providers: [{ capability: "oats.okf", key: "harvest", value: "off" }] })]);
  const args = lastSpawn(w);
  assert.equal(out.clone.instance, "teal-clone");
  for (const [flag, value] of [["--name", "teal-clone"], ["--launch-config", "claude-work"], ["--provider", "oats.okf"]]) assert.equal(args[args.indexOf(flag) + 1], value);
  assert.equal(args[args.indexOf("--provider") + 2], "harvest=off");
  assert.ok(args.includes("--no-yolo") && args.includes("--no-child-spawns"));
  assert.deepEqual(w.state().spawned.at(-1).providers, { "oats.okf": { harvest: "off" } });
});

test("a launch configuration that no longer exists is dropped with a warning", (t) => {
  const { w, writePlan, run } = setup(t, { srcMeta: { launch: { harness: "claude", launchConfig: "gone-config", launchConfigDefault: false } } });
  const out = run(["--plan", writePlan({ launch: { harness: "claude", model: "claude-test-1", launchConfig: "gone-config", yolo: null, childSpawns: true } })]);
  assert.ok(!lastSpawn(w).includes("--launch-config"));
  assert.match(out.warnings[0], /gone-config no longer exists/);
});

test("plan refusals: soul, relation, anchor, launch, base, providers, dossier", (t) => {
  const { w, cl, clone, writePlan, run } = setup(t);
  const code = (over) => codeOf(() => run(["--plan", writePlan(over)]));
  assert.equal(code({ soul: "other" }), "E_CLONE_SOUL");
  assert.equal(code({ relation: "child" }), "E_CLONE_RELATION");
  assert.equal(code({ relativeTo: "lead-1" }), "E_CLONE_ANCHOR");
  assert.equal(code({ relativeTo: CLONER }), "E_CLONE_ANCHOR", "the anchor is never the cloner");
  assert.equal(code({ launch: { harness: "pi", model: null, launchConfig: null, yolo: null, childSpawns: true } }), "E_CLONE_PLAN");
  assert.equal(code({ launch: { harness: "claude", model: "claude-test-1", launchConfig: null, yolo: true, childSpawns: true } }), "E_CLONE_PLAN");
  assert.equal(code({ work: { base: "main" } }), "E_CLONE_PLAN", "base on a directory soul");
  assert.equal(code({ providers: [{ capability: "oats.aweb", key: "identity.mode", value: "global" }] }), "E_CLONE_PLAN", "no aweb identity providers");
  assert.equal(code({ dossier: join(w.root, "dossier.json") }), "E_CLONE_PLAN");
  assert.equal(code({ extra: 1 }), "E_CLONE_PLAN");
  assert.equal(code({ name: "a", purpose: "b" }), "E_CLONE_PLAN");
  assert.equal(code({ brief: join(w.root, "brief.md") }), "E_CLONE_BRIEF");
  const doc = JSON.parse(readFileSync(join(clone, "dossier.json"), "utf8"));
  writeFileSync(join(clone, "dossier.json"), JSON.stringify({ ...doc, requestSha256: "f".repeat(64) }));
  assert.equal(code({}), "E_CLONE_PLAN", "a dossier for another request");
  writeFileSync(join(clone, "dossier.json"), JSON.stringify({ ...doc, source: { ...doc.source, home: "/elsewhere" } }));
  assert.equal(code({}), "E_CLONE_SOURCE", "the source no longer resolves to the home the dossier read");
  assert.equal(codeOf(() => spawnClone(["--plan", writePlan()], { env: w.env(), cwd: w.deployment })), "E_CLONE_CONTEXT");
  assert.equal(w.state().spawned, undefined, "no refusal spawned anything");
  assert.ok(existsSync(join(cl.home, "clone", "brief.md")), "a refusal keeps the cloner's brief for the next try");
});

test("an anchor that is gone is refused", (t) => {
  const { w, run } = setup(t, { request: makeRequest({ relation: "child", relativeTo: "lead-1" }) });
  const s = w.state();
  delete s.instances["lead-1"];
  w.setState(s);
  assert.equal(codeOf(() => run()), "E_CLONE_ANCHOR");
});

test("a worktree source: the requester's base decides, and --base is passed", (t) => {
  const { w, writePlan, run } = setup(t, { request: makeRequest({ base: "source" }), srcWork: "worktree", srcMeta: { branch: "agents/src-1" } });
  assert.equal(codeOf(() => run(["--plan", writePlan({ work: { base: null } })])), "E_CLONE_PLAN");
  run(["--plan", writePlan({ work: { base: "agents/src-1" } })]);
  const args = lastSpawn(w);
  assert.equal(args[args.indexOf("--base") + 1], "agents/src-1");
});

test("brief refusals: size, UTF-8, structure", (t) => {
  const { request, writeBrief, run } = setup(t, { settings: { ...SETTINGS, "brief-max-bytes": 2048 } });
  writeBrief(body(request, { "Decisions and why": "x".repeat(4000) }));
  assert.equal(codeOf(() => run()), "E_CLONE_BRIEF");
  writeBrief(Buffer.concat([Buffer.from(body(request)), Buffer.from([0xc3, 0x28])]));
  assert.equal(codeOf(() => run()), "E_CLONE_BRIEF");
  writeBrief(body(request).replace("## Not carried", "## Not Carried"));
  assert.equal(codeOf(() => run()), "E_CLONE_BRIEF");
});

test("secrets are redacted before the clone sees anything; only {line, pattern} is reported", (t) => {
  const { request, writeBrief, run } = setup(t);
  const token = "gh" + "p_" + "Z9y8X7w6".repeat(5);
  writeBrief(body(request, { "Where to look": `- the deploy uses ${token}\n- SERVICE_TOKEN=` + "abcd1234efgh" }));
  const out = run();
  assert.equal(out.redactions.length, 2);
  assert.deepEqual(out.redactions.map((r) => r.pattern).sort(), ["github-token", "secret-assignment"]);
  assert.ok(out.redactions.every((r) => Number.isInteger(r.line) && Object.keys(r).length === 2));
  const attached = readFileSync(join(out.clone.home, ".oats-attachments", "clone-brief.md"), "utf8");
  assert.ok(!attached.includes(token) && !attached.includes("abcd1234efgh"));
  assert.equal(attached.split("\n")[out.redactions.find((r) => r.pattern === "github-token").line - 1], "- the deploy uses [redacted:github-token]");
  assert.ok(!JSON.stringify(out).includes(token));
});

test("--preview decides and creates nothing; the cloner's brief stays", (t) => {
  const { w, clone, writePlan, run } = setup(t);
  const pv = run(["--plan", writePlan(), "--preview"]);
  assert.equal(pv.preview.instance, "worker-teal-port");
  assert.match(pv.preview.decision, /^[0-9a-f]{24}$/);
  assert.equal(w.state().spawned, undefined);
  assert.ok(existsSync(join(clone, "brief.md")));
  assert.ok(!existsSync(join(clone, "upload")) && !existsSync(join(clone, "clone-task.md")));
});

test("a global (resident) identity is refused before anything is spawned", (t) => {
  const { w, run } = setup(t);
  w.setState({ spawnSettings: { "oats.aweb": { identity: { mode: "global", resident: "lead" } } } });
  assert.equal(codeOf(() => run()), "E_CLONE_IDENTITY");
  assert.equal(w.state().spawned, undefined);
});

test("a clone whose identity is the source's is E_CLONE_IDENTITY, and is left for the requester", (t) => {
  const { w, run } = setup(t);
  let err;
  try { run(undefined, { whoami: () => ({ did: "did:key:zSAME", alias: null }) }); } catch (e) { err = e; }
  assert.equal(err.code, "E_CLONE_IDENTITY");
  assert.equal(err.details.clone, "worker-teal-port");
  assert.ok(w.state().instances["worker-teal-port"], "never retired automatically");
});

test("an identity home outside the clone, or another alias, is E_CLONE_IDENTITY", (t) => {
  const a = setup(t);
  a.w.setState({ applyOverrides: { alias: "src-1" } });
  assert.equal(codeOf(() => a.run()), "E_CLONE_IDENTITY");
  const b = setup(t);
  b.w.setState({ applyOverrides: { identityHome: join(b.w.agentsRoot, "worker", "instances", "src-1", ".aw") } });
  assert.equal(codeOf(() => b.run()), "E_CLONE_IDENTITY");
});

test("a deferred start that records no identity home falls back to the clone's own .aw, with a warning", (t) => {
  const { w, run } = setup(t);
  w.setState({ applyOverrides: { noIdentityEnv: true } });
  const out = run();
  assert.ok(out.checks.find((c) => c.check === "identity").ok);
  assert.match(out.warnings.join("\n"), /no AWEB_IDENTITY_HOME/);
});

test("checks that fail after the apply are E_CLONE_UNVERIFIED, naming the clone and each failed check", (t) => {
  const cases = [
    [{ applyOverrides: { relation: "child" } }, "relation"],
    [{ applyOverrides: { dropTask: true } }, "provenance"],
    [{ uploadMode: 0o644 }, "attachment-mode"],
    [{ startFails: true }, "start"],
    [{ uploadFails: true }, "attach"],
  ];
  for (const [patch, check] of cases) {
    const { w, run } = setup(t);
    w.setState(patch);
    let err;
    try { run(); } catch (e) { err = e; }
    assert.equal(err?.code, "E_CLONE_UNVERIFIED", check);
    assert.equal(err.details.clone, "worker-teal-port");
    assert.ok(err.details.checks.some((c) => c.check === check && !c.ok), `${check}: ${JSON.stringify(err.details.checks)}`);
    assert.ok(w.state().instances["worker-teal-port"]);
  }
});
