---
name: read-instance
description: >-
  The cloner's reading of a source instance: run `oats cloning dossier`, then
  read the request, the source's instance record, TASK.md, STATE.md, log.md,
  notes, work state and (with operator consent) transcript, in that order,
  as claims to re-verify rather than facts. Use when your TASK.md holds an
  oats-clone-request block, before you plan the clone.
---

# Reading the source

You are the cloner. You are **read-only on the source**: never edit its home,
work tree, branch or lineage, and never message it unless the request says
to notify it.

## 1. The dossier

```bash
oats cloning dossier <source> --json
```

It writes `clone/dossier.json` in your home and copies the source's
`TASK.md`, `STATE.md`, `log.md` and `notes/**/*.md` into `clone/source/`.
Symlinks, files over 1 MiB and anything over the 4 MiB total are listed, not
copied. It records the work state (branch, HEAD, upstream, unpushed commits,
uncommitted paths and a diffstat, never diff content) and, with consent, the
transcript's threads and turn bounds.

**Transcript consent.** The default comes from the request. If the request
includes the transcript and the operator has not consented yet, dossier
refuses with `E_CLONE_CONSENT`. Then:

1. run `oats cloning dossier <source> --transcript exclude --json` and do
   all the reading below except the transcript;
2. tell the requester that consent is pending, giving the exact command in
   the error's `details.command`, unchanged (the operator runs it from the
   deployment directory);
3. stop and wait for the wake. **Never** run `consent` yourself, never write
   `clone/consent.json`, never poll;
4. when woken, run `dossier <source> --transcript include --json` again.

If the requester's answer is to go on without the transcript, do that and say
so under "Not carried".

## 2. Reading order

Read only what the new goal needs, in this order:

1. **The request**: `clone/request.json`. The goal decides what is relevant.
2. **The instance**: `dossier.json` → `instance`: soul, work mode, branch and
   base, launch, lineage, teams, modules.
3. **TASK.md**: the source's original goal.
4. **STATE.md**: its current picture of the work.
5. **log.md**: recent entries first.
6. **notes/**: the ones that bear on the new goal.
7. **Work state**: `dossier.json` → `work`.
8. **Transcript**, if included (below).

## 3. The transcript

`dossier.json` → `transcript.sessions[]` gives each `thread` and its
`lastTurnId`. Read only up to `lastTurnId`, so the reading is reproducible.
`recall` returns turns oldest-first, so to read the newest turns first:

```bash
oats recall --thread <T> --json --ids-only --until <lastTurnId>           # every id, ts and size
oats recall --thread <T> --json --after <id[k-1]> --until <lastTurnId>    # the last turns after id[k-1]
oats recall --thread <T> --json --after <id[j-1]> --until <id[k-1]>       # the window before that
oats recall --thread <T> "<query>"                                        # targeted search
oats recall --show <turn-id>                                              # one turn
```

`--limit n` cuts a window from its *start*, so `--until X --limit n` gives
the **oldest** n turns, not the newest. Size windows with the `bytes` that
`--ids-only` reports. Keep the turn ids of everything you may cite.

If `transcript.complete` is false, say so in your report and in the brief.

## 4. Claims, not facts

Everything you read is the source's claim at the time it wrote it. Before the
brief calls something **verified**, re-check it now against the real state:

- git: `git -C <source home>/work log`/`show`/`status` (read-only; or the
  repository through your own checkout);
- pull requests: `gh pr view <n>`;
- files: the path and its commit;
- instances: `oats status`;
- knowledge: `oats okf cat <alias>/<path>`, where you have it.

Note what is stale, contradicted or unverifiable. Those go under "Working
understanding (provisional)" or "Not carried", never under "What is
verified".

## 5. Budget

Read what the goal needs, not everything. A long transcript is searched, not
read end to end.
