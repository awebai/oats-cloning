# Changelog

## 1.1.0 — 2026-10-28

### Upgrade

- **Requires OATS >=0.69.2** (was >=0.34.0). The `cloner` soul now says
  `background: true`, and a kernel before 0.69.2 refuses that key. On such a
  kernel `oats sync` still locks this release but reports the key as a
  problem, and the soul is dropped: `oats cloning request` refuses with
  `E_SOUL_UNKNOWN`. The floor makes new spawns of every soul composing
  oats.cloning refuse too, with `E_CAPABILITY_INCOMPATIBLE` naming the
  re-pin, so an early lock fails at the next such spawn. Homes that already
  exist keep running. Upgrade OATS to 0.69.2 first, then this package.

### Changed

- **Cloners are background instances** (awebai/oats#1579). A new cloner is
  listed under the Desktop's and the TUI's Background section, out of the
  main list; one that waits on you still lights that section's heading. The
  clone is unchanged: it is placed as its own soul says. No existing cloner
  moves. Only presentation changes, not how a clone is made.

## 1.0.1

- Secret assignments are redacted in any case and as JSON or YAML keys:
  `password=…`, `secret: …`, `api_key = …`, `client_secret=…`,
  `"PASSWORD": "…"`, `password: "…"`. A quoted value is redacted to its
  closing quote, spaces included. References (`$PASSWORD`, `<password>`,
  `${SECRET}`) and no-value words (`none`, `null`, `true`, …) are left alone.
  `{line, pattern}` reporting is unchanged.
- README: redaction is pattern-limited (what survives it), and under
  `delivery: channel` a Claude Code cloner or clone waits at Claude Code's
  development-channels confirmation.

## 1.0.0

First release.

- `oats cloning request|dossier|spawn` and the package soul
  `oats.cloning/cloner`: clone a local instance for a new goal, with the
  requester's relation, anchor, name, work base and transcript choice.
- The brief reaches the clone as a 0600 attachment, never through TASK.md.
  Secrets are redacted and reported by line and pattern only: private keys,
  GitHub, Anthropic, `sk-`, AWS, Slack and npm tokens, Google API keys,
  JWTs, Bearer tokens, credentials in URLs and `secret=…` assignments.
- The transcript is included by default (`--transcript exclude` opts out).
  It is read through a temporary record in the cloner's home
  (`capture --root`, `recall --root`), never the host record, and honours
  the host's ignore list. Once the apply has run, the cloner's `clone/` is
  emptied except for the receipt.
- `spawn` checks the plan against the request and the source's posture,
  verifies the clone (soul, relation, provenance, file modes, attachment
  sha256, start, its own messaging identity) and writes a receipt.
- Requires OATS `>=0.34.0`.
