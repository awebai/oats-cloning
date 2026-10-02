import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { BIN, makeWorld } from "./helpers/world.mjs";

function cli(args, env, cwd) {
  const r = spawnSync(process.execPath, [BIN, ...args], { env, cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("--json prints exactly one envelope; failures exit nonzero with { code, message }", (t) => {
  const w = makeWorld(t);
  w.addInstance({ name: "src-1" });
  const leadHome = w.addInstance({ name: "lead-1", agent: "lead" });
  const env = w.env({ instance: "lead-1", home: leadHome });
  const fail = cli(["request", "src-1", "--goal", "g", "--json"], env, leadHome);
  assert.equal(fail.status, 1);
  const lines = fail.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])), ["ok", "error"]);
  assert.equal(JSON.parse(lines[0]).error.code, "E_CLONE_RELATION_REQUIRED");
  const ok = cli(["request", "src-1", "--goal", "g", "--relation", "sibling", "--preview", "--json"], env, leadHome);
  assert.equal(ok.status, 0, ok.stderr);
  const answer = JSON.parse(ok.stdout);
  assert.equal(answer.ok, true);
  assert.equal(answer.preview.instance, "acme-cloning-cloner-clone-src-1");
});

test("without --json: a short human summary, errors on stderr", (t) => {
  const w = makeWorld(t);
  w.addInstance({ name: "src-1" });
  const leadHome = w.addInstance({ name: "lead-1", agent: "lead" });
  const env = w.env({ instance: "lead-1", home: leadHome });
  const ok = cli(["request", "src-1", "--goal", "g", "--relation", "sibling", "--preview"], env, leadHome);
  assert.match(ok.stdout, /^preview: cloner acme-cloning-cloner-clone-src-1/);
  const bad = cli(["nope"], env, leadHome);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /E_CLONE_USAGE/);
  assert.equal(bad.stdout, "");
});

test("a kernel refusal keeps its own code under details.kernel", (t) => {
  const w = makeWorld(t, { souls: ["worker"] });
  w.addInstance({ name: "src-1" });
  const leadHome = w.addInstance({ name: "lead-1", agent: "lead" });
  const r = cli(["request", "src-1", "--goal", "g", "--relation", "sibling", "--json"], w.env({ instance: "lead-1", home: leadHome }), leadHome);
  const { error } = JSON.parse(r.stdout);
  assert.equal(error.code, "E_SOUL_UNKNOWN");
  assert.equal(error.details.kernel.code, "E_SOUL_UNKNOWN");
});

test("OATS_CLI_BIN must be absolute: the kernel is never resolved from PATH", (t) => {
  const w = makeWorld(t);
  const leadHome = w.addInstance({ name: "lead-1", agent: "lead" });
  w.addInstance({ name: "src-1" });
  const r = cli(["request", "src-1", "--goal", "g", "--relation", "sibling", "--json"], { ...w.env({ instance: "lead-1", home: leadHome }), OATS_CLI_BIN: "oats" }, leadHome);
  assert.equal(JSON.parse(r.stdout).error.code, "E_CLONE_CONTEXT");
});
