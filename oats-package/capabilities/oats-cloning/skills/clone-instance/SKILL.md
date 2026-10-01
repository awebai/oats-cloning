---
name: clone-instance
description: >-
  Request a clone of an OATS instance: a new, separate instance of the same
  soul that continues the source's situated understanding toward a new goal,
  related as you choose (independent, child, sibling or parent). Covers when
  to clone and when not, the choices that are yours (goal, relation, anchor,
  name, transcript, work base), running `oats cloning request` from an
  instance or from the deployment, transcript consent, and what comes back.
  Use when your human or your task asks for a clone of an instance.
---

# Requesting a clone

A clone is an ordinary new instance of the source's soul, with its own
identity, alias, home and credentials. It starts from a **brief**: a curated
reading of the source's verified facts, decisions, provisional reasoning, open
threads and work state, written by a short-lived **cloner** instance. The
cloner reads the source, writes the brief, spawns the clone, reports to you
and retires.

## When to clone, and when not

- **Clone** to continue an instance's situated understanding in a new
  direction: a follow-up that needs what it learned, a second line of work
  beside it, a successor for work it will not finish.
- **Spawn the soul** for a fresh start. A clone of an instance that knows
  nothing useful is just a slower spawn.
- **Message the source** to ask it something. A clone is not a way to query
  an instance.
- Request a clone only when your human asks for one or your task does. Never
  on your own initiative.

## Your choices

These are yours; the cloner decides everything else (what the brief carries).

| Choice | Flag | Notes |
|---|---|---|
| goal | `--goal <text>` or `--goal-file <path>` | Required. Non-empty UTF-8, at most 8 KiB. State the done-criteria if you have them. |
| relation | `--relation independent\|child\|sibling\|parent` | Required, no default. |
| anchor | `--relative-to <instance>` | For child, sibling or parent. Defaults to the source. Not allowed with `independent`. Never the cloner. |
| name | `--name <slug>` | The clone's exact name. Without it the cloner picks a purpose. |
| transcript | `--transcript include\|exclude` | Default `exclude`. See consent below. |
| work base | `--base source\|default\|<ref>` | Worktree sources only. `source` starts from the source's branch; `default` from the soul's default. Without it the cloner decides. |
| launch | `--harness`, `--model` | Defaults to the source's. |

**Relations.** `child`: the clone is a child of the anchor. `sibling`: it
shares the anchor's parent. `parent`: the clone becomes the anchor's parent,
which **rewrites the anchor's lineage**; use it only when that is the true
relation (for example, a reviewer that sits above the source). `independent`:
a top-level instance with no lineage. To make the clone your own child, pass
`--relation child --relative-to "$OATS_INSTANCE"`.

## Running it

From your instance home:

```bash
oats cloning request <source> --goal-file goal.md --relation sibling --json
oats cloning request <source> --goal "…" --relation child --relative-to "$OATS_INSTANCE" --preview --json
```

`--preview` shows the cloner the request would spawn and creates nothing.

From the deployment directory, a human runs it through the cloner soul:

```bash
oats cloning request <source> --goal "…" --relation independent --soul oats.cloning/cloner
```

The cloner is then operator-origin and reports in its own terminal.

## Transcript consent

The source's session transcript is its private conversation. Reading it needs
the operator's consent, **for each clone**:

- `--transcript include` is a request, not consent.
- From an instance, the answer carries `consent.status: "required"` and the
  exact command. Ask your human to run it from the deployment directory:
  `oats cloning consent <cloner> --soul <cloner soul>`. It shows them the
  request and asks for confirmation on their terminal, then wakes the cloner.
- From the deployment, `request … --transcript include` asks the operator
  inline and records the same consent.
- Until consent arrives, the cloner builds the brief from everything else and
  tells you consent is pending.

**Never run `oats cloning consent` yourself**, and never write or edit
`clone/consent.json`. This is a procedural gate: agents running as the same
OS user are not cryptographically prevented from it. It holds because no
agent does it.

## What comes back

`request` answers `{ ok, cloner: { instance, home }, request, consent? }`.
The cloner then reports to you by aweb mail (or, operator-origin, in its own
terminal): the clone's name, home and relation, the brief's size and sha256,
how many secrets were redacted, what was not carried, and caveats such as an
incomplete transcript. Then it retires itself.

## After the clone exists

- Who owns the clone is decided by the relation you chose. The source keeps
  its own commitments, PRs, threads and children unless your goal handed
  some of them over.
- The clone's brief is at `.oats-attachments/clone-brief.md` in its home,
  mode 0600. Its TASK.md holds only the provenance block and a pointer.
- If the cloner reports `E_CLONE_UNVERIFIED` or `E_CLONE_IDENTITY`, the clone
  exists but something could not be confirmed. It is left for you: inspect it
  (`oats status`, its home) and retire it if it is wrong.
