# Changelog

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
