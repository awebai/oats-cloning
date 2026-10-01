import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CLONER_SOUL, FIXED_NOW, codeOf, lib, makeWorld } from "./helpers/world.mjs";

const { request, clonerPurpose } = await lib("request");
const { consent } = await lib("consent-command");
const { parseRequestBlock } = await lib("request-format");

const TTY_YES = { stdin: { isTTY: true }, stderr: { isTTY: true, write() {} }, readAnswer: () => "y" };
const TTY_NO = { ...TTY_YES, readAnswer: () => "n" };
const NO_TTY = { stdin: { isTTY: false }, stderr: { isTTY: false, write() {} }, readAnswer: () => "y" };

function setup(t) {
  const w = makeWorld(t);
  const srcHome = w.addInstance({ name: "src-1", files: { "STATE.md": "teal\n" } });
  const leadHome = w.addInstance({ name: "lead-1", agent: "lead" });
  const asLead = (argv, extra = {}) => request(argv, { env: w.env({ instance: "lead-1", home: leadHome }), cwd: leadHome, now: FIXED_NOW, tmpdir: w.tmp, ...extra });
  const asOperator = (argv, extra = {}) => request(argv, { env: w.env(), cwd: w.deployment, now: FIXED_NOW, tmpdir: w.tmp, ...extra });
  return { w, srcHome, leadHome, asLead, asOperator };
}

test("request refusals: every request error code", (t) => {
  const { w, asLead, asOperator } = setup(t);
  const goal = ["--goal", "Port the teal theme"];
  assert.equal(codeOf(() => asLead(["src-1", ...goal, "--relation", "sibling", "--server", "box"])), "E_CLONE_REMOTE");
  assert.equal(codeOf(() => asLead(["src-1", ...goal])), "E_CLONE_RELATION_REQUIRED");
  assert.equal(codeOf(() => asLead(["src-1", ...goal, "--relation", "cousin"])), "E_CLONE_RELATION");
  assert.equal(codeOf(() => asLead(["src-1", ...goal, "--relation", "independent", "--relative-to", "lead-1"])), "E_CLONE_RELATION");
  assert.equal(codeOf(() => asLead(["src-1", "--relation", "sibling"])), "E_CLONE_GOAL");
  assert.equal(codeOf(() => asLead(["src-1", "--goal", "  \n", "--relation", "sibling"])), "E_CLONE_GOAL");
  assert.equal(codeOf(() => asLead(["src-1", "--goal", "x".repeat(8193), "--relation", "sibling"])), "E_CLONE_GOAL");
  const bad = join(w.tmp, "bad-goal.txt");
  writeFileSync(bad, Buffer.from([0x66, 0xff, 0xfe]));
  assert.equal(codeOf(() => asLead(["src-1", "--goal-file", bad, "--relation", "sibling"])), "E_CLONE_GOAL");
  assert.equal(codeOf(() => asLead(["nobody", ...goal, "--relation", "sibling"])), "E_CLONE_SOURCE");
  assert.equal(codeOf(() => asLead(["/abs/path", ...goal, "--relation", "sibling"])), "E_CLONE_SOURCE");
  assert.equal(codeOf(() => asLead(["src-1", ...goal, "--relation", "child", "--relative-to", "ghost"])), "E_CLONE_ANCHOR");
  assert.equal(codeOf(() => asLead(["src-1", ...goal, "--relation", "sibling", "--name", "Not A Slug"])), "E_CLONE_USAGE");
  assert.equal(codeOf(() => asLead(["src-1", ...goal, "--relation", "sibling", "--base", "source"])), "E_CLONE_USAGE", "--base on a directory source");
  assert.equal(codeOf(() => asLead(["src-1", ...goal, "--relation", "sibling", "--bogus", "x"])), "E_CLONE_USAGE");
  assert.equal(codeOf(() => asOperator(["src-1", ...goal, "--relation", "sibling", "--transcript", "include"], { io: NO_TTY })), "E_CLONE_CONSENT_CONTEXT");
  assert.equal(codeOf(() => asOperator(["src-1", ...goal, "--relation", "sibling", "--transcript", "include"], { io: TTY_NO })), "E_CLONE_CONSENT");
  const ctx = w.env({ instance: "lead-1", home: join(w.agentsRoot, "lead", "instances", "lead-1") });
  delete ctx.OATS_INSTANCE_HOME;
  assert.equal(codeOf(() => request(["src-1", ...goal, "--relation", "sibling"], { env: ctx, cwd: w.deployment, tmpdir: w.tmp })), "E_CLONE_CONTEXT");
  assert.equal(w.state().spawned, undefined, "no refusal spawned anything");
});

test("a source whose home records another name is not that source", (t) => {
  const { srcHome, asLead } = setup(t);
  const meta = JSON.parse(readFileSync(join(srcHome, "instance.json"), "utf8"));
  writeFileSync(join(srcHome, "instance.json"), JSON.stringify({ ...meta, instance: "someone-else" }));
  assert.equal(codeOf(() => asLead(["src-1", "--goal", "g", "--relation", "sibling"])), "E_CLONE_SOURCE");
});

test("an instance request spawns the cloner as the requester's child, preview then bound apply, with a clean environment", (t) => {
  const { w, asLead } = setup(t);
  const out = asLead(["src-1", "--goal", "Port the teal theme\nDone when teal.", "--relation", "independent", "--json"]);
  assert.equal(out.cloner.instance, "acme-cloning-cloner-clone-src-1");
  assert.equal(out.request.relation, "unrelated");
  assert.equal(out.request.relativeTo, null);
  assert.equal(out.request.transcript, "exclude", "the transcript defaults to exclude");
  assert.equal(out.request.requestedBy, "lead-1");
  assert.equal(out.consent, undefined);
  const spawns = w.calls().filter((c) => c.argv[0] === "spawn");
  assert.equal(spawns.length, 2);
  assert.ok(spawns[0].argv.includes("--preview"));
  const apply = spawns[1].argv;
  assert.deepEqual(apply.slice(0, 4), ["spawn", CLONER_SOUL, "--purpose", "clone-src-1"]);
  assert.equal(apply[apply.indexOf("--parent") + 1], "lead-1");
  assert.ok(apply.includes("--expect-decision"));
  assert.ok(!apply.includes("--no-launch"));
  for (const c of w.calls()) {
    assert.ok(!c.env.some((k) => /^(AWEB_|PI_AGENT|OATS_INSTANCE|OATS_SETTINGS|OATS_CAPABILITY)/.test(k)), `${c.argv[0]} got an identity variable`);
  }
  const home = out.cloner.home;
  const { request: block } = parseRequestBlock(readFileSync(join(home, "TASK.md"), "utf8"));
  assert.deepEqual(block, out.request);
});

test("an included transcript from an instance needs the operator's consent, and says how", (t) => {
  const { asLead } = setup(t);
  const out = asLead(["src-1", "--goal", "g", "--relation", "sibling", "--transcript", "include"]);
  assert.equal(out.consent.status, "required");
  assert.equal(out.consent.command, `oats cloning consent ${out.cloner.instance} --soul ${CLONER_SOUL}`);
  assert.equal(out.request.relativeTo, "src-1", "the anchor defaults to the source");
});

test("--preview creates nothing and returns the planned cloner", (t) => {
  const { w, asLead } = setup(t);
  const out = asLead(["src-1", "--goal", "g", "--relation", "child", "--relative-to", "lead-1", "--preview"]);
  assert.equal(out.preview.instance, "acme-cloning-cloner-clone-src-1");
  assert.equal(w.state().spawned, undefined);
});

test("an operator request with the transcript asks on the terminal, records consent, then starts the cloner", (t) => {
  const { w, asOperator } = setup(t);
  const out = asOperator(["src-1", "--goal", "g", "--relation", "sibling", "--transcript", "include", "--soul", CLONER_SOUL], { io: TTY_YES });
  assert.equal(out.request.requestedBy, "operator");
  assert.equal(out.consent.status, "given");
  const apply = w.calls().filter((c) => c.argv[0] === "spawn").at(-1).argv;
  assert.ok(apply.includes("--no-launch"), "consent exists before the cloner can run");
  assert.ok(!apply.includes("--parent"), "operator-origin: no relation flags");
  const path = join(out.cloner.home, "clone", "consent.json");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const record = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(record.requestSha256, out.requestSha256);
  assert.equal(record.by, "operator");
  assert.ok(w.calls().some((c) => c.argv[0] === "session" && c.argv[1] === "start"));
});

test("the cloner's purpose fits the 64-character name budget", () => {
  const long = "a".repeat(60);
  const purpose = clonerPurpose(CLONER_SOUL, long);
  assert.ok(`acme-cloning-cloner-${purpose}`.length <= 61);
  assert.ok(purpose.startsWith("clone-a"));
  assert.equal(clonerPurpose(CLONER_SOUL, long, 10), "clone-aaaa");
});

test("a long source name is cut to the kernel's budget (retry on E_INSTANCE_NAME_INVALID)", (t) => {
  const { w, asLead } = setup(t);
  // The kernel's agent name for the cloner soul is longer than the prefix the
  // command assumes, so the first preview is refused with maxPurpose.
  w.setState({ agentNames: { [CLONER_SOUL]: "acme-cloning-package-with-a-long-name--cloner" } });
  const name = "s" + "-x".repeat(28);
  w.addInstance({ name });
  const out = asLead([name, "--goal", "g", "--relation", "independent"]);
  assert.ok(out.cloner.instance.length <= 64);
  const previews = w.calls().filter((c) => c.argv[0] === "spawn" && c.argv.includes("--preview"));
  assert.equal(previews.length, 2, "refused once, retried with the kernel's budget");
});

test("consent: only the operator, only on a terminal, bound to the request", (t) => {
  const { w, asLead, leadHome } = setup(t);
  const out = asLead(["src-1", "--goal", "g", "--relation", "sibling", "--transcript", "include"]);
  const cloner = out.cloner.instance;
  const asOp = (io, env = w.env()) => consent([cloner, "--soul", CLONER_SOUL], { env, cwd: w.deployment, io, tmpdir: w.tmp, now: FIXED_NOW });
  assert.equal(codeOf(() => consent([cloner], { env: w.env({ instance: "lead-1", home: leadHome }), cwd: leadHome, io: TTY_YES })), "E_CLONE_CONSENT_CONTEXT");
  assert.equal(codeOf(() => asOp(TTY_YES, { ...w.env(), OATS_INSTANCE: "lead-1" })), "E_CLONE_CONSENT_CONTEXT");
  assert.equal(codeOf(() => consent([cloner], { env: w.env(), cwd: join(out.cloner.home, "clone"), io: TTY_YES })), "E_CLONE_CONSENT_CONTEXT", "inside a home");
  assert.equal(codeOf(() => asOp(NO_TTY)), "E_CLONE_CONSENT_CONTEXT");
  assert.equal(codeOf(() => asOp(TTY_NO)), "E_CLONE_CONSENT");
  assert.equal(codeOf(() => consent(["src-1"], { env: w.env(), cwd: w.deployment, io: TTY_YES })), "E_CLONE_USAGE", "not a cloner");
  const done = asOp(TTY_YES);
  assert.equal(done.consent.requestSha256, out.requestSha256);
  assert.equal(statSync(done.consent.path).mode & 0o777, 0o600);
  assert.equal(done.woke, true);
  assert.match(w.state().inputs[0].text, /--transcript include/);
});

test("consent on a request that excludes the transcript is refused", (t) => {
  const { w, asLead } = setup(t);
  const out = asLead(["src-1", "--goal", "g", "--relation", "sibling"]);
  assert.equal(codeOf(() => consent([out.cloner.instance], { env: w.env(), cwd: w.deployment, io: TTY_YES })), "E_CLONE_USAGE");
});
