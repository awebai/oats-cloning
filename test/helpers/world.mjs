import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The capability under test. Tests reach it through this one path (override
// with OATS_CLONING_CAPABILITY_DIR) so they move with the payload.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CAPABILITY_DIR = process.env.OATS_CLONING_CAPABILITY_DIR || join(REPO, "oats-package", "capabilities", "oats-cloning");
export const FAKE_OATS = join(REPO, "test", "fixtures", "fake-oats.mjs");
export const lib = (name) => import(pathToFileURL(join(CAPABILITY_DIR, "lib", `${name}.mjs`)).href);
export const BIN = join(CAPABILITY_DIR, "bin", "oats-cloning.mjs");

export const CLONER_SOUL = "acme.cloning/cloner";
export const SETTINGS = { cloner: CLONER_SOUL, "brief-max-bytes": 49152 };
export const FIXED_NOW = () => new Date("2026-10-01T12:00:00.000Z");

/** A throwaway deployment: <root>/deploy/agents/<agent>/instances/<name>,
 *  plus the fake kernel's state. */
export function makeWorld(t, { souls = ["worker", CLONER_SOUL], launchConfigs = ["claude-work"] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-cloning-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const deployment = join(root, "deploy");
  const agentsRoot = join(deployment, "agents");
  mkdirSync(agentsRoot, { recursive: true });
  writeFileSync(join(deployment, "oats-local.yaml"), "schemaVersion: 2\n");
  const statePath = join(root, "fake-state.json"), logPath = join(root, "fake-log.jsonl");
  const tmp = join(root, "tmp");
  mkdirSync(tmp);
  // The user's home for this world: its ~/.turn-record is the host record a
  // capture without --root would write, and must never be the real one.
  const userHome = join(root, "user-home"), hostRecord = join(userHome, ".turn-record");
  mkdirSync(userHome);
  writeFileSync(statePath, JSON.stringify({ agentsRoot, instances: {}, souls, launchConfigs, capture: {} }));
  writeFileSync(logPath, "");

  const world = {
    root, deployment, agentsRoot, statePath, logPath, tmp, userHome, hostRecord,
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
    setState(patch) { writeFileSync(statePath, JSON.stringify({ ...world.state(), ...patch })); },
    calls: () => readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    /** Create an instance home and register it with the fake kernel. */
    addInstance({ name, agent = "worker", qualifiedName = null, work = "directory", running = true, meta = {}, files = {} }) {
      const home = join(agentsRoot, agent, "instances", name);
      mkdirSync(join(home, "work"), { recursive: true });
      mkdirSync(join(home, ".aw"), { recursive: true });
      const record = {
        agent, kind: "persistent", instance: name, home, work, harness: "claude", model: "claude-test-1",
        launchFrom: "soul", policy: { childSpawns: { allowed: true, origin: { kind: "default" } } },
        capabilityMeta: { "oats.aweb": { alias: name, identity: { mode: "local", alias: name }, team: "default:acme" } },
        capabilities: [{ id: "oats.aweb", layer: "messaging", settings: { delivery: "session" } }],
        capabilityRuntime: [{ id: "oats.aweb", settings: { root: "/secret/root" } }],
        tmux: { session: "oats-agents", window: name, socket: "/tmp/tmux" },
        launch: { version: 2, harness: "claude", launchConfig: "claude-work", launchConfigDefault: true, env: { CLAUDE_CONFIG_DIR: "/Users/x/.claude" }, hooks: { env: { AWEB_IDENTITY_HOME: join(home, ".aw") } }, model: "claude-test-1" },
        command: "OATS_INSTANCE='x' AWEB_API_KEY=should-never-travel claude",
        createdAt: "2026-09-30T10:00:00.000Z",
        modules: { "oats.aweb": { from: { kind: "package", package: "oats.aweb", version: "1.17.5", commit: "f".repeat(40), repoKey: "github.com/awebai/oats-aweb" }, commit: "f".repeat(40) } },
        providers: { "oats.aweb": { delivery: "session" } },
        workspace: { key: "github.com/acme/ws", soul: qualifiedName ? { qualifiedName, name: qualifiedName.split("/")[1], repoKey: "github.com/acme/pkg", commit: "c".repeat(40) } : { id: `github.com/acme/agents#${agent}`, repoKey: "github.com/acme/agents", commit: "b".repeat(40) } },
        teams: [{ label: "acme", team: "default:acme", default: true, from: "shared" }],
        defaultTeam: { label: "acme", team: "default:acme", from: "deployment" },
        ...meta,
      };
      writeFileSync(join(home, "instance.json"), JSON.stringify(record, null, 2));
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(dirname(join(home, rel)), { recursive: true });
        writeFileSync(join(home, rel), content);
      }
      const s = world.state();
      s.instances[name] = { name, agent, home, running, work };
      writeFileSync(statePath, JSON.stringify(s));
      return home;
    },
    /** The environment the kernel gives a capability command in `home`
     *  (instance) or the deployment (operator), plus ambient identity noise
     *  that must never reach a kernel call. */
    env({ instance, home, settings = SETTINGS } = {}) {
      return {
        PATH: process.env.PATH, HOME: userHome,
        OATS_CLI_BIN: FAKE_OATS, OATS_SETTINGS: JSON.stringify(settings), OATS_SETTINGS_ORIGINS: "{}",
        OATS_CAPABILITY: "oats.cloning",
        FAKE_OATS_STATE: statePath, FAKE_OATS_LOG: logPath,
        ...(instance ? { OATS_INSTANCE: instance, OATS_INSTANCE_HOME: home, AWEB_IDENTITY_HOME: join(home, ".aw"), AWEB_DELIVERY: "session", PI_AGENT_HOME: home, PI_AGENT_INSTANCE: instance } : {}),
      };
    },
  };
  return world;
}

/** Capture a CloneError's code (and the error) from a thunk. */
export function codeOf(fn) {
  try { fn(); } catch (e) { return e.code; }
  return "NO_ERROR";
}
