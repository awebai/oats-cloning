import { readSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.mjs";
import { readRegularFile, writeJson } from "./files.mjs";

// Operator consent to read one source's transcript for one request (R2c).
// It is a PROCEDURAL gate: consent.json is written only by `oats cloning
// consent` from the deployment, after a confirmation on a terminal. An agent
// running as the same OS user is not cryptographically prevented from forging
// it; the skills and the cloner's AGENTS.md forbid it, and the record is
// reviewable.

export const consentPath = (clonerHome) => join(clonerHome, "clone", "consent.json");

export function writeConsent(clonerHome, { requestSha256, source }, now = new Date()) {
  const record = { version: 1, requestSha256, source, consentedAt: now.toISOString(), by: "operator" };
  writeJson(consentPath(clonerHome), record);
  return record;
}

/** The consent matching this request, or null. Never trusts a symlink. */
export function readConsent(clonerHome, { requestSha256, source }) {
  const r = readRegularFile(consentPath(clonerHome), 64 * 1024);
  if (!r.bytes) return null;
  let c;
  try { c = JSON.parse(r.bytes.toString("utf8")); } catch { return null; }
  if (!c || c.version !== 1 || c.by !== "operator" || c.requestSha256 !== requestSha256 || c.source !== source) return null;
  if (typeof c.consentedAt !== "string" || !Number.isFinite(Date.parse(c.consentedAt))) return null;
  return c;
}

/** Ask on the operator's terminal. Refuses without one: consent is never
 *  given by a flag, a pipe or an agent. */
export function confirmOnTerminal(lines, question, io = {}) {
  const stdin = io.stdin ?? process.stdin, stderr = io.stderr ?? process.stderr;
  if (!stdin.isTTY || !stderr.isTTY) fail("E_CLONE_CONSENT_CONTEXT", "transcript consent needs the operator at an interactive terminal; nothing was written");
  stderr.write(lines.join("\n") + `\n${question} [y/N] `);
  const read = io.readAnswer ?? (() => {
    const buf = Buffer.alloc(64);
    let n = 0;
    try { n = readSync(0, buf, 0, buf.length, null); } catch { n = 0; }
    return buf.toString("utf8", 0, n);
  });
  const answer = String(read()).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

/** The lines the operator sees before deciding. */
export function consentSummary(request, cloner) {
  const goal = request.goal.length > 1200 ? `${request.goal.slice(0, 1200)}…` : request.goal;
  return [
    "",
    `Clone request${cloner ? ` handled by cloner ${cloner}` : ""}:`,
    `  source:       ${request.source}`,
    `  requested by: ${request.requestedBy}`,
    `  relation:     ${request.relation}${request.relativeTo ? ` of ${request.relativeTo}` : ""}`,
    "  goal:",
    ...goal.split("\n").map((l) => `    ${l}`),
    "",
    `The cloner would read ${request.source}'s session transcript (its private conversation) to write the clone's brief.`,
    "Secrets are redacted mechanically and the brief stays private to the clone's home, but the cloner reads everything it is shown.",
  ];
}

export function readTaskRequest(home) {
  const r = readRegularFile(join(home, "TASK.md"), 1024 * 1024);
  if (!r.bytes) fail("E_CLONE_REQUEST", `no readable TASK.md in ${home}`);
  return r.bytes.toString("utf8");
}
