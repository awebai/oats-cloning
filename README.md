# oats-cloning

The official [OATS](https://github.com/awebai/oats) cloning package,
`oats.cloning`. It clones a running OATS instance for a new goal. The clone
is a fresh instance of the source's soul that starts with what the source
knew, as far as that matters for the goal. It is not a copy of the source's
home.

The package ships:

- the capability `oats.cloning` (command `oats cloning`), with four commands,
  four skills and a short instruction inject;
- the package soul `oats.cloning/cloner`. It is a short-lived soul that handles
  one clone request and then retires itself.

The member soul `souls/oats-cloning-expert` maintains this repository.

## How a clone is made

```
requester (an instance, or the operator with --soul)
  └─ oats cloning request <source> --goal … --relation …
       spawns the cloner (settings.cloner); its TASK.md holds the request block
cloner
  1. oats cloning dossier <source>      /read-instance  read-only snapshot of the source
  2. writes clone/brief.md, plan.json   /plan-clone     decides what the clone carries
  3. oats cloning spawn --plan …        /spawn-clone    preview → apply → verify
  4. reports, then oats retire <self> --self
clone: an ordinary instance of the source's soul, related as requested
```

- The **requester** chooses the goal, the relation and its anchor, the name,
  the work base and whether the transcript may be read.
- The **cloner** decides what the clone carries. It reads the source's home
  files (TASK.md, STATE.md, log.md, `notes/**/*.md`), its work state (Git or
  a directory listing) and, with consent, its transcript. It writes a brief
  under eight fixed headings.
- **`spawn`** turns the brief into the clone and proves it worked. It checks
  the plan against the request and the source: the soul, relation, anchor,
  name and launch posture must match, and yolo and child spawns are never
  escalated. It then spawns the clone and verifies it.

## Privacy guarantees

These are the package's contract. A change to any of them is a breaking
change.

- **The brief never goes into TASK.md.** Claude and Codex launches pass
  TASK.md as argv, which other local users can read through `ps`. `spawn`
  does this:
  1. spawns the clone `--no-launch` with a generated preamble only: a
     provenance block, "You are a clone", and a pointer to the brief;
  2. uploads the brief with `oats session upload`, which stores it 0600 at
     `.oats-attachments/clone-brief.md`;
  3. sets TASK.md to 0600;
  4. runs `oats session start`.

  It then verifies the file modes and the attachment's sha256.
- **Secrets are redacted, not refused.** The brief and preamble are scanned
  for private keys, GitHub, Anthropic, `sk-`, AWS and Slack tokens, JWTs and
  `secret=…` style assignments. Every match is replaced. Only
  `{line, pattern}` is reported, never the value.
- **The transcript is excluded by default.** `--transcript include` is a
  request, not consent.

  Reading the transcript needs the **operator's** consent for that exact
  request. The operator runs `oats cloning consent <cloner> --soul <cloner
  soul>` from the deployment directory, or answers the prompt of an operator
  `request … --transcript include` at a terminal. `dossier` refuses the
  transcript until a matching `consent.json` exists.

  **This is a procedural gate, not a security boundary.** The consent command
  refuses inside an instance home or with `OATS_INSTANCE*` set, and every
  agent-facing text forbids running it. Still, an agent with shell access on
  the same host and user could forge the file. The gate makes consent
  explicit and auditable; it does not make it impossible to bypass.
- **The clone gets its own messaging identity.** After the start, `spawn`
  checks that the clone's aweb alias is its own name, and that its did and
  identity home differ from the source's. It refuses before spawning when the
  deployment would give the clone a global (resident) identity.
- **Nothing of the source outlives the cloner.** Retirement keeps a changed
  home in private recovery storage. So once the apply has run, `spawn`
  deletes `clone/source/`, `clone/dossier.json` and the brief. A cloner that
  stops without spawning deletes `clone/` before it retires. The dossier
  records transcript ids and counts only, never turn text.
- **The source is never written.** The dossier reads Git with
  `--no-optional-locks` and fsmonitor and untracked-cache off. It reads home
  files without following symlinks, within 1 MiB per file and 4 MiB in total.

## Use it in a workspace

Declare the package in `oats-workspace.yaml`. That declaration is the trust
decision. Then give the capability to the souls that may request clones, and
run `oats sync`:

```yaml
packages:
  oats.cloning: git:github.com/awebai/oats-cloning@v1.0.0
```

```yaml
# in the soul.yaml of each soul that may request clones
capabilities:
  oats.cloning: { from: package }
```

It is not a workspace default. Which souls get it is the workspace's
decision.

Settings (`settings.oats.cloning`):

| Setting | Default | Meaning |
|---|---|---|
| `cloner` | `oats.cloning/cloner` | the soul `request` spawns as the cloner; the code never names the package |
| `brief-max-bytes` | `49152` | the brief's size limit (1 KiB to 1 MiB) |

Requirements: OATS `>=0.34.0`, Node 22, `git`, and `aw` when the deployment
uses aweb messaging.

## Commands

All commands take `--json`. With it they print exactly one line,
`{ok:true,…}` or `{ok:false,error:{code,message,details?}}`, and exit 1 on
failure. They call the kernel only through `OATS_CLI_BIN`. They strip
`AWEB_*`, `PI_AGENT*`, `GIT_*` and the instance's `OATS_*` variables from what
they pass to it, so the relation is always set by explicit flags.

| Command | Run by | Does |
|---|---|---|
| `request <source> (--goal …\|--goal-file …) --relation independent\|child\|sibling\|parent [--relative-to …] [--name …] [--transcript include\|exclude] [--base source\|default\|<ref>] [--harness …] [--model …] [--preview]` | an instance, or the operator with `--soul` | spawns the cloner with the request block |
| `consent <cloner> --soul <cloner soul>` | the operator only, at a terminal | records consent for that request (0600) and wakes the cloner |
| `dossier <source> [--transcript include\|exclude]` | the cloner | writes `clone/dossier.json`, `clone/request.json` and `clone/source/*` |
| `spawn --plan <plan.json> [--preview]` | the cloner | checks the plan, then preview, apply, upload, start and verify; writes `clone/receipt.json` |

Errors (kernel refusals pass through with their own code under
`error.details.kernel`):

| Code | Meaning |
|---|---|
| `E_CLONE_USAGE` | bad flags or arguments |
| `E_CLONE_CONTEXT` | run in the wrong context (no instance, malformed environment, relative `OATS_CLI_BIN`) |
| `E_CLONE_REMOTE` | `--server`: v1 clones only instances on this host |
| `E_CLONE_SOURCE` | the source is not a local instance, is the cloner itself, or moved since the dossier |
| `E_CLONE_RELATION_REQUIRED` / `E_CLONE_RELATION` / `E_CLONE_ANCHOR` | the relation is missing or invalid, the plan differs from the request, or the anchor is missing or is the cloner |
| `E_CLONE_GOAL` | the goal is empty, not UTF-8 or over 8 KiB |
| `E_CLONE_REQUEST` | the cloner's TASK.md holds no single valid request block, or the dossier's source is not the request's |
| `E_CLONE_TRANSCRIPT_CONSENT` | the dossier asks for a transcript the request excluded |
| `E_CLONE_CONSENT` | there is no matching operator consent, or the operator declined |
| `E_CLONE_CONSENT_CONTEXT` | consent was run from an instance, or without a terminal |
| `E_CLONE_PLAN` / `E_CLONE_SOUL` / `E_CLONE_HARVEST` | the plan is malformed, names a dossier for another request, or differs from the request or the source's posture |
| `E_CLONE_BRIEF` | the brief's headings, the goal verbatim, its size or its encoding are wrong |
| `E_CLONE_IDENTITY` | the clone would share, or did not get, its own messaging identity |
| `E_CLONE_UNVERIFIED` | the clone exists but a check failed; it is left for the requester |
| `E_CLONE_KERNEL` / `E_CLONE_INTERNAL` | the kernel answered something unparseable, or an unexpected error occurred |

## Repository layout

```
oats-package/
  oats-package.json                       the package manifest
  capabilities/oats-cloning/
    oats.json                             capability manifest: commands, settings, no hooks
    bin/oats-cloning.mjs                  entry point: dispatch and the JSON envelope
    lib/
      context.mjs, kernel.mjs             invocation detection; the only path to the kernel
      instances.mjs                       resolving instances from `oats status`; the instance.json whitelist
      request.mjs, request-format.mjs     `request`; the request block in the cloner's TASK.md
      consent.mjs, consent-command.mjs    consent.json and the operator command
      dossier.mjs, workstate.mjs, files.mjs   `dossier`; read-only Git and file reading
      brief.mjs                           brief checks, the generated preamble, redaction
      spawn.mjs                           plan checks, the attachment flow, verification
    skills/                               clone-instance (requester), read-instance, plan-clone, spawn-clone (cloner)
    injects/cloning.md
  souls/cloner/                           the package soul
souls/oats-cloning-expert/                the member soul that maintains this repo
scripts/validate-manifests.mjs            manifest and schema validation
test/                                     node:test suites against a fake kernel
```

## Development

```bash
npm test        # validates the manifests, then runs every test
```

- The tests drive the real command code against
  `test/fixtures/fake-oats.mjs`, a stand-in for `bin/oats.mjs`. It models the
  kernel's answer shapes and refusals. When the kernel's behaviour changes,
  change the fake to match it first: a test that passes against a wrong fake
  proves nothing.
- `test/helpers/world.mjs` builds a deployment in a temp directory with
  instances, homes and the kernel environment.
  `test/helpers/cloner.mjs` adds a cloner whose TASK.md holds a request.
- The secret-pattern positive controls are assembled at runtime, so the
  repository holds no literal token.
- Fixtures can't prove kernel behaviour. Before a release, rehearse against
  a real kernel: run `bin/oats-cloning.mjs` with the kernel's capability
  environment, and run a throwaway deployment that pins this repository with
  `git:/abs/path@<local tag>`.

## Known limitations

- Local only: no remote sources, and no cloning of retired instances.
- The secret scan has no aweb-specific key pattern. PEM keys are covered.
- With oats.aweb 1.17.5, `oats session start` does not re-emit
  `AWEB_IDENTITY_HOME`. `spawn` then finds the clone's identity in its own
  `<home>/.aw` and reports a warning.
