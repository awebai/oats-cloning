import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CLONER_SOUL, FIXED_NOW, codeOf, lib, makeWorld } from "./helpers/world.mjs";

const { request, clonerPurpose } = await lib("request");
const { parseRequestBlock } = await lib("request-format");

function setup(t) {
  const w = makeWorld(t);
  const srcHome = w.addInstance({ name: "src-1", files: { "STATE.md": "teal\n" } });
  const leadHome = w.addInstance({ name: "lead-1", agent: "lead" });
  const asLead = (argv, extra = {}) => request(argv, { env: w.env({ instance: "lead-1", home: leadHome }), cwd: leadHome, now: FIXED_NOW, tmpdir: w.tmp, ...extra });
  const asOperator = (argv, extra = {}) => request(argv, { env: w.env(), cwd: w.deployment, now: FIXED_NOW, tmpdir: w.tmp, ...extra });
  return { w, srcHome, leadHome, asLead, asOperator };
}

test("request refusals: every request error code", (t) => {
  const { w, asLead } = setup(t);
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
  assert.equal(out.request.transcript, "include", "the transcript defaults to include: the request is the consent");
  assert.equal(out.request.requestedBy, "lead-1");
  assert.deepEqual(Object.keys(out).sort(), ["cloner", "request", "requestSha256"]);
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

test("--transcript exclude is the opt-out, recorded in the request; anything else is refused", (t) => {
  const { asLead } = setup(t);
  const out = asLead(["src-1", "--goal", "g", "--relation", "sibling", "--transcript", "exclude"]);
  assert.equal(out.request.transcript, "exclude");
  assert.equal(out.request.relativeTo, "src-1", "the anchor defaults to the source");
  assert.equal(codeOf(() => asLead(["src-1", "--goal", "g", "--relation", "sibling", "--transcript", "maybe"])), "E_CLONE_USAGE");
});

test("--preview creates nothing and returns the planned cloner", (t) => {
  const { w, asLead } = setup(t);
  const out = asLead(["src-1", "--goal", "g", "--relation", "child", "--relative-to", "lead-1", "--preview"]);
  assert.equal(out.preview.instance, "acme-cloning-cloner-clone-src-1");
  assert.equal(w.state().spawned, undefined);
});

test("an operator request just works: no question, a launched cloner, no relation flags", (t) => {
  const { w, asOperator } = setup(t);
  const out = asOperator(["src-1", "--goal", "g", "--relation", "sibling", "--soul", CLONER_SOUL]);
  assert.equal(out.request.requestedBy, "operator");
  assert.equal(out.request.transcript, "include");
  const apply = w.calls().filter((c) => c.argv[0] === "spawn").at(-1).argv;
  assert.ok(!apply.includes("--no-launch"), "the kernel launches the cloner");
  assert.ok(!apply.includes("--parent") && !apply.includes("--relation"), "operator-origin: no relation flags");
  assert.ok(!w.calls().some((c) => c.argv[0] === "session"), "nothing to start or wake afterwards");
  assert.ok(!existsSync(join(out.cloner.home, "clone")), "the request writes nothing into the cloner's home");
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
