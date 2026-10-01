import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { FIXED_NOW, codeOf, lib, makeWorld } from "./helpers/world.mjs";
import { CLONER, addCloner, makeRequest } from "./helpers/cloner.mjs";

const { dossier } = await lib("dossier");
const { filterInstance } = await lib("instances");
const { writeConsent } = await lib("consent");

function setup(t, { request = makeRequest(), consent = false, srcFiles, srcMeta, work = "directory" } = {}) {
  const w = makeWorld(t);
  const srcHome = w.addInstance({ name: "src-1", work, meta: srcMeta, files: srcFiles ?? {
    "TASK.md": "# Instance briefing\n\n## Task\n\nPick a colour.\n",
    "STATE.md": "Decided: teal.\n",
    "log.md": "- picked teal\n",
    "notes/decision.md": "Teal, because it contrasts.\n",
    "notes/deep/more.md": "Nested note.\n",
    "notes/skip.txt": "not markdown\n",
    "AGENTS.md": "SOUL INSTRUCTIONS\n",
    ".aw/signing.key": "PRIVATE IDENTITY\n",
    "work/readme.txt": "work file contents\n",
  } });
  w.addInstance({ name: "lead-1", agent: "lead" });
  const cl = addCloner(w, request, { consent });
  const run = (argv = ["src-1", "--json"], env = cl.env) => dossier(argv, { env, cwd: cl.home, now: FIXED_NOW });
  return { w, srcHome, cl, run };
}

test("dossier runs only in the cloner's home, for its own request", (t) => {
  const { w, cl, run } = setup(t);
  assert.equal(codeOf(() => dossier(["src-1"], { env: w.env(), cwd: w.deployment })), "E_CLONE_CONTEXT");
  assert.equal(codeOf(() => run(["other-1"])), "E_CLONE_REQUEST");
  writeFileSync(join(cl.home, "TASK.md"), "# no request here\n");
  assert.equal(codeOf(() => run()), "E_CLONE_REQUEST");
});

test("a cloner never clones itself", (t) => {
  const { run } = setup(t, { request: makeRequest({ source: CLONER, relativeTo: CLONER }) });
  assert.equal(codeOf(() => run([CLONER])), "E_CLONE_SOURCE");
});

test("the transcript: excluded by the request, or without the operator's matching consent, is refused", (t) => {
  const a = setup(t);
  assert.equal(codeOf(() => a.run(["src-1", "--transcript", "include"])), "E_CLONE_TRANSCRIPT_CONSENT");
  const b = setup(t, { request: makeRequest({ transcript: "include" }) });
  assert.equal(codeOf(() => b.run()), "E_CLONE_CONSENT", "the request's include is not consent");
  assert.throws(() => b.run(), (e) => e.details.command === `oats cloning consent ${CLONER} --soul acme.cloning/cloner` && e.message.includes(e.details.command), "the exact command, soul included");
  writeConsent(b.cl.home, { requestSha256: "0".repeat(64), source: "src-1" });
  assert.equal(codeOf(() => b.run()), "E_CLONE_CONSENT", "consent for another request");
  const out = b.run(["src-1", "--transcript", "exclude"]);
  assert.equal(out.summary.transcript.included, false, "everything else can be built while consent is pending");
  assert.ok(!b.w.calls().some((c) => c.argv[0] === "capture"), "no transcript was read");
});

test("with consent the transcript is bounded by capture and counted with recall, not copied", (t) => {
  const { w, srcHome, run } = setup(t, { request: makeRequest({ transcript: "include" }), consent: true });
  w.setState({ capture: { [srcHome]: { complete: false, sessions: [{ thread: "cc:session:aaa", sessionId: "aaa", ids: ["t1:1", "t1:2", "t1:3"] }, { thread: "cc:session:bbb", sessionId: "bbb", ids: ["t1:9"] }] } } });
  const out = run();
  const doc = JSON.parse(readFileSync(out.dossier, "utf8"));
  assert.equal(doc.transcript.status, "incomplete");
  assert.equal(doc.transcript.complete, false, "an incomplete capture is recorded, not hidden");
  assert.deepEqual(doc.transcript.sessions.map((s) => [s.thread, s.lastTurnId, s.turns]), [["cc:session:aaa", "t1:3", 3], ["cc:session:bbb", "t1:9", 1]]);
  const recalls = w.calls().filter((c) => c.argv[0] === "recall");
  assert.deepEqual(recalls[0].argv, ["recall", "--thread", "cc:session:aaa", "--json", "--ids-only", "--until", "t1:3"]);
  assert.deepEqual(w.calls().find((c) => c.argv[0] === "capture").argv, ["capture", "--home", srcHome, "--quiet"]);
});

test("a failed capture is recorded as failed", (t) => {
  const { run } = setup(t, { request: makeRequest({ transcript: "include" }), consent: true });
  const doc = JSON.parse(readFileSync(run().dossier, "utf8"));
  assert.equal(doc.transcript.status, "failed");
  assert.equal(doc.transcript.complete, false);
  assert.deepEqual(doc.transcript.sessions, []);
});

test("only TASK.md, STATE.md, log.md and notes/**/*.md are copied, 0600, each with its sha256", (t) => {
  const { cl, run } = setup(t);
  const out = run();
  const doc = JSON.parse(readFileSync(out.dossier, "utf8"));
  const copied = doc.files.filter((f) => f.copied).map((f) => f.path).sort();
  assert.deepEqual(copied, ["STATE.md", "TASK.md", "log.md", "notes/decision.md", "notes/deep/more.md"]);
  for (const f of doc.files.filter((x) => x.copied)) assert.match(f.sha256, /^[0-9a-f]{64}$/);
  const src = join(cl.home, "clone", "source");
  assert.equal(readFileSync(join(src, "notes", "decision.md"), "utf8"), "Teal, because it contrasts.\n");
  assert.equal(statSync(join(src, "STATE.md")).mode & 0o777, 0o600);
  assert.equal(statSync(join(cl.home, "clone")).mode & 0o777, 0o700);
  assert.ok(!existsSync(join(src, "AGENTS.md")) && !existsSync(join(src, ".aw")) && !existsSync(join(src, "notes", "skip.txt")));
  const text = readFileSync(out.dossier, "utf8");
  for (const leaked of ["SOUL INSTRUCTIONS", "PRIVATE IDENTITY", "work file contents"]) assert.ok(!text.includes(leaked), leaked);
  assert.deepEqual(doc.work.listing.entries.find((e) => e.path === "readme.txt"), { path: "readme.txt", type: "file", bytes: 19 });
  assert.ok(existsSync(join(cl.home, "clone", "request.json")));
});

test("path containment: a symlinked notes/x.md pointing outside, and a symlinked STATE.md, are not read", (t) => {
  const { w, srcHome, cl, run } = setup(t, { srcFiles: { "TASK.md": "task\n" } });
  const outside = join(w.root, "outside-secret.md");
  writeFileSync(outside, "OUTSIDE SECRET\n");
  mkdirSync(join(srcHome, "notes"), { recursive: true });
  symlinkSync(outside, join(srcHome, "notes", "x.md"));
  symlinkSync(outside, join(srcHome, "STATE.md"));
  const linkedDir = join(w.root, "linked-notes");
  mkdirSync(linkedDir);
  writeFileSync(join(linkedDir, "y.md"), "OUTSIDE SECRET\n");
  symlinkSync(linkedDir, join(srcHome, "notes", "sub"));
  const doc = JSON.parse(readFileSync(run().dossier, "utf8"));
  const byPath = Object.fromEntries(doc.files.map((f) => [f.path, f]));
  assert.equal(byPath["STATE.md"].skipped, "symlink");
  assert.equal(byPath["notes/x.md"].skipped, "symlink");
  assert.equal(byPath["notes/sub"].skipped, "symlink");
  assert.ok(!readFileSync(join(cl.home, "clone", "dossier.json"), "utf8").includes("OUTSIDE SECRET"));
  assert.ok(!existsSync(join(cl.home, "clone", "source", "STATE.md")));
  assert.ok(!existsSync(join(cl.home, "clone", "source", "notes", "x.md")));
});

test("a symlinked notes/ directory is not walked; budgets list files instead of copying them", (t) => {
  const big = "x".repeat(1024 * 1024 + 1);
  const { w, srcHome, run } = setup(t, { srcFiles: { "TASK.md": "task\n", "log.md": big } });
  mkdirSync(join(w.root, "elsewhere"));
  writeFileSync(join(w.root, "elsewhere", "n.md"), "OUTSIDE\n");
  symlinkSync(join(w.root, "elsewhere"), join(srcHome, "notes"));
  const doc = JSON.parse(readFileSync(run().dossier, "utf8"));
  const byPath = Object.fromEntries(doc.files.map((f) => [f.path, f]));
  assert.equal(byPath["notes"].skipped, "symlink");
  assert.equal(byPath["log.md"].skipped, "over-file-budget");
  assert.equal(byPath["log.md"].copied, false);
});

test("the total budget lists the files past 4 MiB", (t) => {
  const mb = "y".repeat(1024 * 1024 - 10);
  const files = { "TASK.md": "t\n" };
  for (let i = 0; i < 6; i++) files[`notes/n${i}.md`] = mb;
  const { run } = setup(t, { srcFiles: files });
  const doc = JSON.parse(readFileSync(run().dossier, "utf8"));
  assert.equal(doc.files.filter((f) => f.skipped === "over-total-budget").length, 2);
});

test("the filtered instance carries no command, env, hooks, capabilityMeta, tmux or settings", (t) => {
  const { run } = setup(t, { srcMeta: { providers: { "oats.okf": { harvest: "off", "bindings-file": "/secret/bindings.json" } } } });
  const doc = JSON.parse(readFileSync(run().dossier, "utf8"));
  const text = JSON.stringify(doc.instance);
  for (const leaked of ["should-never-travel", "/secret/", "CLAUDE_CONFIG_DIR", "AWEB_IDENTITY_HOME", "oats-agents", "/tmp/tmux", "command", "capabilityMeta", "capabilityRuntime"]) {
    assert.ok(!text.includes(leaked), leaked);
  }
  assert.deepEqual(Object.keys(doc.instance).sort(), ["agent", "base", "childSpawns", "createdAt", "defaultTeam", "harness", "harvest", "kind", "launchConfig", "model", "modules", "name", "parentInstance", "relation", "relativeTo", "repo", "running", "siblingInstance", "soul", "teams", "work", "yolo", "branch"].sort());
  assert.equal(doc.instance.harvest, "off");
  assert.deepEqual(doc.instance.launchConfig, { name: "claude-work", default: true });
  assert.equal(doc.instance.modules["oats.aweb"].version, "1.17.5");
});

test("filterInstance whitelists: unknown fields never pass", () => {
  const out = filterInstance({ instance: "a", agent: "b", secretField: "x", launch: { env: { K: "v" } }, command: "c" });
  assert.equal(JSON.stringify(out).includes('"x"'), false);
  assert.equal(out.launchConfig.name, null);
});

test("a worktree source: branch, HEAD, unpushed commits, status paths and a diffstat, never diff content", (t) => {
  const { srcHome, run } = setup(t, { work: "worktree", srcFiles: { "TASK.md": "t\n" } });
  const repo = join(srcHome, "..", "repo");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", "a.txt"); git("commit", "-qm", "base");
  git("worktree", "add", "-q", "-b", "agents/src-1", join(srcHome, "work-wt"));
  execFileSync("rm", ["-rf", join(srcHome, "work")]);
  execFileSync("mv", [join(srcHome, "work-wt"), join(srcHome, "work")]);
  git("worktree", "repair", join(srcHome, "work"));
  const wt = (...a) => execFileSync("git", ["-C", join(srcHome, "work"), ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  writeFileSync(join(srcHome, "work", "b.txt"), "two\n");
  wt("add", "b.txt"); wt("commit", "-qm", "add b");
  writeFileSync(join(srcHome, "work", "a.txt"), "one\nSECRET-DIFF-CONTENT\n");
  writeFileSync(join(srcHome, "work", "new.txt"), "untracked\n");
  const doc = JSON.parse(readFileSync(run().dossier, "utf8"));
  const work = doc.work;
  assert.equal(work.mode, "worktree");
  assert.equal(work.branch, "agents/src-1");
  assert.match(work.head, /^[0-9a-f]{40}$/);
  assert.equal(work.upstream, null);
  assert.deepEqual(work.status.paths.map((p) => p.path).sort(), ["a.txt", "new.txt"]);
  assert.deepEqual(work.diffstat.files, [{ path: "a.txt", added: 1, deleted: 0 }]);
  assert.ok(work.commits.list.some((l) => l.endsWith(" add b")));
  assert.ok(!JSON.stringify(doc).includes("SECRET-DIFF-CONTENT"));
  assert.ok(!existsSync(join(repo, ".git", "index.lock")));
});
