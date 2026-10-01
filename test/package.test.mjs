import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CAPABILITY_DIR } from "./helpers/world.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(CAPABILITY_DIR, "oats.json"), "utf8"));

test("the capability has no lifecycle hooks and exactly the four commands", () => {
  assert.equal(manifest.hooks, undefined);
  assert.deepEqual(Object.keys(manifest.commands).sort(), ["consent", "dossier", "request", "spawn"]);
  for (const spec of Object.values(manifest.commands)) assert.match(spec, /^bin\/oats-cloning\.mjs [a-z]+$/);
  assert.equal(manifest.compatibility.oats, ">=0.34.0");
});

test("the inject is short and says the three things", () => {
  const inject = readFileSync(join(CAPABILITY_DIR, manifest.inject), "utf8");
  assert.ok(inject.trim().split("\n").length < 12);
  for (const needle of ["/clone-instance", "never your own initiative", "oats-clone-request", "/read-instance", "/plan-clone", "/spawn-clone", "consent"]) assert.ok(inject.includes(needle), needle);
});

test("each skill's frontmatter names its directory", () => {
  const dir = join(CAPABILITY_DIR, "skills");
  const names = readdirSync(dir).sort();
  assert.deepEqual(names, ["clone-instance", "plan-clone", "read-instance", "spawn-clone"]);
  for (const name of names) {
    const text = readFileSync(join(dir, name, "SKILL.md"), "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(fm, name);
    assert.match(fm[1], new RegExp(`^name: ${name}$`, "m"));
    assert.match(fm[1], /^description: /m);
  }
});

test("the code never hard-codes the package id: the cloner soul comes from settings.cloner", () => {
  for (const f of readdirSync(join(CAPABILITY_DIR, "lib"))) {
    assert.ok(!readFileSync(join(CAPABILITY_DIR, "lib", f), "utf8").includes("oats.cloning/"), f);
  }
});

test("the agent-facing texts forbid running consent", () => {
  const cloner = readFileSync(join(REPO, "oats-package", "souls", "cloner", "AGENTS.md"), "utf8");
  const request = readFileSync(join(CAPABILITY_DIR, "skills", "clone-instance", "SKILL.md"), "utf8");
  assert.match(cloner, /Never run `oats cloning consent`/);
  assert.match(request, /Never run `oats cloning consent` yourself/);
  assert.match(request, /procedural gate/);
});

function validateMutated(t, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "oats-cloning-validate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const p of ["scripts", "schemas", "oats-package"]) cpSync(join(REPO, p), join(dir, p), { recursive: true });
  mutate(dir);
  return spawnSync(process.execPath, [join(dir, "scripts", "validate-manifests.mjs")], { cwd: dir, encoding: "utf8" });
}

test("the validator passes the package and rejects hooks or a version drift", (t) => {
  assert.equal(validateMutated(t, () => {}).status, 0);
  const capPath = (d) => join(d, "oats-package", "capabilities", "oats-cloning", "oats.json");
  const hooked = validateMutated(t, (d) => { const m = JSON.parse(readFileSync(capPath(d))); m.hooks = { spawn: "bin/oats-cloning.mjs request" }; writeFileSync(capPath(d), JSON.stringify(m)); });
  assert.equal(hooked.status, 1);
  assert.match(hooked.stderr, /no lifecycle hooks/);
  const drift = validateMutated(t, (d) => { const m = JSON.parse(readFileSync(capPath(d))); m.version = "1.0.1"; writeFileSync(capPath(d), JSON.stringify(m)); });
  assert.equal(drift.status, 1);
});
