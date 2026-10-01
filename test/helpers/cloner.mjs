import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLONER_SOUL, lib } from "./world.mjs";

const { clonerTask, parseRequestBlock } = await lib("request-format");
const { writeConsent } = await lib("consent");

export const CLONER = "acme-cloning-cloner-clone-src-1";

export function makeRequest(over = {}) {
  return {
    version: 1, source: "src-1", goal: "Port the teal theme to the settings page\nDone when the settings page uses teal.",
    relation: "sibling", relativeTo: "src-1", name: null, transcript: "exclude", base: null,
    launch: { harness: null, model: null }, requestedBy: "lead-1", requestedAt: "2026-10-01T11:00:00.000Z", ...over,
  };
}

/** A cloner home as the kernel leaves it: TASK.md = briefing + "## Task" + the request task. */
export function addCloner(w, request, { name = CLONER, consent = false } = {}) {
  const task = clonerTask(request);
  const home = w.addInstance({
    name, agent: "acme-cloning--cloner", qualifiedName: CLONER_SOUL,
    files: { "TASK.md": `# Instance briefing: ${name}\n\nYou are instance "${name}".\n\n## Task\n\n${task.trim()}\n` },
  });
  if (consent) writeConsent(home, { requestSha256: parseRequestBlock(task).sha256, source: request.source });
  return { home, env: w.env({ instance: name, home }), sha256: parseRequestBlock(task).sha256 };
}

export function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}
