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

---

## D-002: Pull requests with CI checks and manual merge

**Date:** 2026-09-28
**Status:** Accepted

**Context:** The PRD requires feature work on `feature/*` branches merged into `master` only when it works. A feature can pass on its own branch and still break when combined with newer `master` code.

**Options considered:**
1. Local testing only before merging: simple, but relies on remembering to run tests.
2. GitHub Actions CI on every push: tests run automatically; free for public repositories.
3. CI plus pull requests: every feature gets a reviewable PR page with its CI result.
4. Auto-merge on green CI: faster, but removes the final human review step.

**Decision:** Options 2 + 3, with manual merge. Before merging, `master` is merged into the feature branch and tests are run on the combined code. Branch protection on `master` requires CI to pass.

**Consequences:** Every feature has a traceable PR and a verified test run. CI is added as its own commit once the first tests exist, not before.
