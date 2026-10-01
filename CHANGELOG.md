# Changelog

## 1.0.0

First release.

- `oats cloning request|consent|dossier|spawn` and the package soul
  `oats.cloning/cloner`: clone a local instance for a new goal, with the
  requester's relation, anchor, name, work base and transcript choice.
- The brief reaches the clone as a 0600 attachment, never through TASK.md.
  Secrets are redacted and reported by line and pattern only.
- The transcript is read only with the operator's consent for that request.
  This is a procedural gate.
- `spawn` checks the plan against the request and the source's posture,
  verifies the clone (soul, relation, provenance, file modes, attachment
  sha256, start, its own messaging identity) and writes a receipt.
- Requires OATS `>=0.34.0`.
