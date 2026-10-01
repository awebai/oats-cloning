import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail } from "./errors.mjs";
import { parseArgs } from "./args.mjs";
import { detectInvocation, readSettings } from "./context.mjs";
import { kernelEnvelope } from "./kernel.mjs";
import { readStatus, resolveInstance, soulOf } from "./instances.mjs";
import { parseRequestBlock } from "./request-format.mjs";
import { writePrivate } from "./files.mjs";
import { confirmOnTerminal, consentSummary, readTaskRequest, writeConsent } from "./consent.mjs";

// `oats cloning consent <cloner> --soul <cloner soul>`: the operator, from the
// deployment directory, consents to one cloner reading one source's transcript
// for one request. Never run by an agent (a procedural gate: see consent.mjs).

export function consent(argv, deps = {}) {
  const env = deps.env ?? process.env, cwd = deps.cwd ?? process.cwd(), now = deps.now ?? (() => new Date());
  const { flags, positionals } = parseArgs(argv, { values: ["soul"], switches: ["json"], positionals: 1 });
  const clonerName = positionals[0];
  if (!clonerName) fail("E_CLONE_USAGE", "usage: oats cloning consent <cloner-instance> --soul <cloner soul>   (from the deployment directory)");
  const inv = detectInvocation(env, cwd);
  if (inv.kind !== "operator") fail("E_CLONE_CONSENT_CONTEXT", "consent is the operator's: run it from the deployment directory, never inside an instance home or with OATS_INSTANCE/OATS_INSTANCE_HOME set");
  const settings = readSettings(env);

  const ctx = { cwd, env };
  const cloner = resolveInstance(readStatus(ctx), clonerName, "E_CLONE_USAGE", "cloner");
  if (settings.cloner && soulOf(cloner.meta) !== settings.cloner) fail("E_CLONE_USAGE", `${clonerName} is not a cloner (its soul is ${soulOf(cloner.meta)})`);
  const { request, sha256: requestSha256 } = parseRequestBlock(readTaskRequest(cloner.home));
  if (request.transcript !== "include") fail("E_CLONE_USAGE", `the request ${clonerName} handles excludes the transcript; there is nothing to consent to`);

  const yes = confirmOnTerminal(consentSummary(request, clonerName), `Allow ${clonerName} to read ${request.source}'s transcript for this request?`, deps.io);
  if (!yes) fail("E_CLONE_CONSENT", "consent declined; nothing was written");
  const record = writeConsent(cloner.home, { requestSha256, source: request.source }, now());

  // Wake the cloner: one line typed into its session.
  let woke = false, warning;
  const dir = mkdtempSync(join(deps.tmpdir ?? tmpdir(), "oats-cloning-"));
  chmodSync(dir, 0o700);
  try {
    const line = writePrivate(join(dir, "wake.txt"), `The operator consented to reading ${request.source}'s transcript for your clone request (consent.json is in clone/). Run oats cloning dossier ${request.source} --transcript include --json and continue.\n`);
    kernelEnvelope(["session", "input", "--home", cloner.home, "--text-file", line, "--json"], { ...ctx, timeout: 60000 });
    woke = true;
  } catch (e) {
    warning = `consent is recorded, but the cloner's session could not be woken (${e.code || "error"}); start or message it`;
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { consent: { cloner: clonerName, path: join(cloner.home, "clone", "consent.json"), ...record }, woke, ...(warning ? { warning } : {}) };
}
