# Decisions

Every significant decision made during this project, with context and reasoning.

---

## D-001: Per-repository GitHub identity via SSH

**Date:** 2026-09-28
**Status:** Accepted

**Context:** The machine's global Git and `gh` CLI are authenticated as a different GitHub account. This repository must push as `istiak133` without changing the global setup used by other projects.

**Options considered:**
1. Switch the global account: affects every other repository; rejected.
2. HTTPS with a per-repo credential: works, but credential helpers are global by default and easy to misconfigure.
3. Dedicated SSH key + repo-local `core.sshCommand` with `IdentitiesOnly=yes`: scoped to this repository only.

**Decision:** Option 3.

**Consequences:** `git push`/`pull` from this repository always authenticate as `istiak133`. The `gh` CLI is not used here; GitHub UI actions are done in the browser.
