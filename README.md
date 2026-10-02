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
  the work base, and whether to leave the transcript out.
- The **cloner** decides what the clone carries. It reads the source's home
  files (TASK.md, STATE.md, log.md, `notes/**/*.md`), its work state (Git or
  a directory listing) and its transcript, unless the request excludes it. It
  writes a brief
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
  for:
  - private keys;
  - GitHub, Anthropic, `sk-`, AWS, Slack and npm tokens;
  - Google API keys;
  - JWTs;
  - `Authorization: Bearer` tokens (the token only);
  - credentials in URLs (`scheme://user:pass@host` keeps its scheme and host);
  - `secret=…` style assignments.

  Every match is replaced. Only `{line, pattern}` is reported, never the
  value.
- **The transcript is read through a temporary record, never the host
  record.** It is included by default: asking for the clone is the consent,
  and `--transcript exclude` opts out. `dossier` runs
  `oats capture --home <source> --root <cloner home>/clone/record` (0700),
  and every read is `oats recall --root` on that record. Nothing is written to
  the host record (`TURN_RECORD_ROOT`, else `~/.turn-record`). So a source
  that was told its session is not captured stays uncaptured. The host's
  ignore list is copied into the temporary record so excluded sessions stay
  excluded. If that list exists but can't be read, nothing is captured. The
  clone gets the cloner's summary with turn ids as citations, never the
  transcript.
- **The clone gets its own messaging identity.** After the start, `spawn`
  checks that the clone's aweb alias is its own name, and that its did and
  identity home differ from the source's. It refuses before spawning when the
  deployment would give the clone a global (resident) identity.
- **Nothing of the source outlives the cloner.** Retirement keeps a changed
  home in private recovery storage. So:
  - once the apply has run, whatever the checks say, `spawn` deletes
    everything in `clone/` except `receipt.json`, which holds no source
    text;
  - a refusal before the apply keeps the cloner's brief and plan for a retry,
    but deletes the temporary record;
  - a cloner that stops without spawning deletes `clone/` before it retires;
  - `dossier` first deletes any `clone/source` and `clone/record` left by an
    earlier run.

  **The limit:** a cloner killed mid-run and then retired from outside leaves
  its `clone/` (the source copies and possibly the temporary record) in
  recovery storage, which is 0700.
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
| `dossier <source> [--transcript include\|exclude]` | the cloner | writes `clone/dossier.json`, `clone/request.json`, `clone/source/*` and, with the transcript, the temporary record `clone/record` |
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
      dossier.mjs, workstate.mjs, files.mjs   `dossier`; the temporary transcript record; read-only Git and file reading
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
- The fake models the record the way `packages/record` does. Capture writes
  to `--root`, else `TURN_RECORD_ROOT`, else `~/.turn-record`, and honours
  that root's ignore file. Recall reads only its own root.
- `test/helpers/world.mjs` builds a deployment in a temp directory with
  instances, homes and the kernel environment. It also builds a user home of
  its own, so `world.hostRecord` is the host record a stray capture would
  write. Tests assert that it never exists.
  `test/helpers/cloner.mjs` adds a cloner whose TASK.md holds a request.
- The secret-pattern positive controls are assembled at runtime, so the
  repository holds no literal token.
- Fixtures can't prove kernel behaviour. Before a release, rehearse against
  a real kernel: run `bin/oats-cloning.mjs` with the kernel's capability
  environment, and run a throwaway deployment that pins this repository with
  `git:/abs/path@<local tag>`.

## Known limitations

- Local only: no remote sources, and no cloning of retired instances.
- The secret scan covers PEM private keys, including aweb's own
  `.aw/signing.key` form (an `ED25519 PRIVATE KEY` block, as `aw` parses it).
  A bare key body without its PEM armour is not recognised.
- A URL with no opening quote or bracket that runs into other text with no
  whitespace between (`https://db.example:443,(ops@example.com)`) can have
  that text redacted as if it were credentials. Redaction errs toward
  over-redacting, never toward a leak.
- With oats.aweb 1.17.5, `oats session start` does not re-emit
  `AWEB_IDENTITY_HOME`. `spawn` then finds the clone's identity in its own
  `<home>/.aw` and reports a warning.
