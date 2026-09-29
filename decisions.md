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

---

# Decision Status (read this first)

Every major decision, what it was at first, what it is now, and whether it is in the code.
**Implemented** = in `master` · **In progress** = being built · **Planned** = MVP scope, not built yet · **Deferred** = after submission.
Details and reasoning for each entry are further down in this file.

| Area | Earlier decision | Final decision | Status |
|---|---|---|---|
| Backend framework | Fastify (proposed) | NestJS | Implemented |
| ORM | Drizzle (proposed) | Prisma 7 + raw SQL only where needed | Implemented |
| Tests / lint | Jest + ESLint | Vitest + Supertest, oxlint (NestJS 12 defaults) | Implemented |
| Auth | JWT + cookie (proposed) | Database sessions, token hash, httpOnly cookie via Next.js proxy | Implemented |
| Email uniqueness | Unique index on `lower(email)` | App lower-cases + unique + `CHECK (email = lower(email))` | Implemented |
| Merge flow | PR + manual merge | PR + auto-merge on green CI (`api`, `web`, `docker` required) | Implemented |
| Geography | 3 routes, ordered stops, 2 km per hop → 14 zones + km table only (D-003) | 14 zones + symmetric km table **and** 3 fixed lines driven both ways = 6 routes with ordered stops (D-008) | Implemented (`routes`, `route_stops`, seed, `GET /zones`, `GET /routes`) |
| Matching rule | Same route and direction, pickup ahead of the vehicle → M1–M4 same pickup zone + detour ≤ 2 km (D-003) | R1–R4: on the pool's route in its direction, the car has not passed the pickup, seats free, pool active (D-008) | Implemented (`pooling/route-plan.ts`, checked under the lock in `PoolingService.joinUnderLock`) |
| Joining a pool | Driver confirms every join; seat hold with 60 s timeout (option Y) | Auto-join into the oldest compatible open pool (best effort: under contention the ride keeps waiting); the driver can also accept compatible waiting requests | Implemented |
| Joins after start | Allowed from stops ahead (option C) → deferred (D-003) | Allowed from any stop ahead until the seats are full; seats freed at drop-off (D-008) | Implemented (tested: join on the way, passed stop refused, depart vs join race) |
| Status model | Per-passenger states → one shared set for the whole pool (D-003) | Same status names, per passenger: MATCHED → DRIVER_ARRIVED (car at their stop) → STARTED (on board) → COMPLETED (dropped off); pool status + `current_stop` say where the car is (D-008) | Implemented (`TripService`: arrive, pickup, dropoff, no-show, depart, cancel) |
| Fare | ৳30 + ৳20 per hop, locked at request → −20% if 2+ passengers at STARTED, locked at STARTED (D-003) | (৳30 + direct km × ৳15) × seats; −20% if another passenger shared at least one hop; estimate = solo price (never exceeded); locked at drop-off (D-008) | Implemented (tested ৳60 / ৳72 / ৳108 shared, ৳75 alone, ৳75 when a seat is only handed over) |
| Ride types | SHARED / SOLO chosen by the passenger | No ride type; every ride can be pooled | Implemented |
| Money storage | Integer paisa | Integer paisa (unchanged) | Implemented |
| Concurrency | Vehicle row lock + CHECK + CAS + partial unique indexes (v2) | Unchanged, MVP subset: vehicle lock, CHECK seats, status-conditional seat update, one active pool per vehicle, one active request per passenger, CAS on request status. Rule added: inside the lock only the transaction's connection is used (found by the race test) | Implemented (tested: 20 riders racing for the last seat, 10/10 runs) |
| Idempotency key (double tap) | E6 + G11 | Kept as a design, not built for the MVP | Deferred |
| Seat hold (Y) | Driver confirms every join within 60 s | Rejected for en-route pooling: a fitting request takes its seat at once (D-009) | Rejected |
| Request expiry | E1 | Kept as a design, not built for the MVP | Deferred |
| Route choice | System picks at the first accept (fewest hops) → driver picks (D-008) | System suggests from the car's zone and waiting demand, driver confirms with one tap (D-009) | Implemented (`route-suggestion.ts`, `GET /driver/routes`, `POST /driver/location`) |
| No-show | E7 | Driver marks a waiting passenger as no-show at their stop; seat freed (D-008) | Implemented |
| Cancellation | Passenger until pickup; driver before start → riders back to REQUESTED | Passenger until picked up; empty pool closes itself; driver before the first pickup → riders back to REQUESTED (D-008) | Implemented |
| Payment | Cash only | Cash only (unchanged) | Planned |
| Hosting | Vercel + Render/Koyeb + Neon | Unchanged (re-check free tiers at deploy time) | Planned |

---

# PRD Walkthrough Notes

Gist and decision points extracted from each PRD section. Open points are resolved in later D-entries.

## PRD §1: The Banani Rush-Hour Story

**Gist:** At 8:41 AM on Banani Road 11, driver Jashim waits with Bullet, his 3-seat battery vehicle. Nusrat books Banani → Mohakhali. Two minutes later Rafiq books a similar route, Banani → Gulshan 1. The system must decide quickly whether they can share the vehicle and how to split the fare fairly. Thirty seconds later Shirin tries to take the last seat. Jashim needs to know who is riding and when he can leave. Passengers want a fair price and privacy from each other. The cast must be used consistently in seed data, tests and demo; no generic `user1`/`driver1`.

**Decision points:**
- [ ] P1.1 Cast: use the PRD cast (Jashim, Bullet, Nusrat, Rafiq, Shirin) or our own. *(open, recommended: PRD cast)*
- [ ] P1.2 Matching timing: match synchronously when the request is created ("in about a second") vs a background process. *(open)*
- [ ] P1.3 Pool closing: when a pool stops accepting riders and the driver can leave ("when he can go"): seats full, driver starts, or a time window. *(open)*
- [ ] P1.4 Passenger privacy: what a passenger can see about co-riders ("not accidentally make a new friend"). *(open)*
- [ ] P1.5 Last-seat race: Shirin vs an earlier rider for the final seat; concurrency handling (detailed in PRD §12). *(open)*

## PRD §2: The Product Problem

**Gist:** Passengers request rides and share a vehicle with others when it makes sense. The driver sees who is assigned to the ride and its current stage. Each passenger sees only their own fare and status. After a ride ends, the system keeps enough history to explain exactly what happened.

**Decision points:**
- [ ] P2.1 "When it makes sense": the pooling eligibility rule (detailed in PRD §4). *(open)*
- [ ] P2.2 Data model split: one vehicle trip (pool) vs per-passenger ride requests, each with its own fare and status. *(open, recommended: separate entities)*
- [ ] P2.3 Status levels: pool-level status vs passenger-level status (e.g. one passenger dropped off or cancelled while the pool continues). *(open)*
- [ ] P2.4 Authorization: passengers can read/modify only their own requests; drivers only their own rides. Where it is enforced. *(open)*
- [ ] P2.5 History: append-only status-change log vs only current status with timestamps. *(open, recommended: append-only log)*
- [ ] P2.6 Fare snapshot: store the fare calculated at match time instead of recalculating later. *(open, recommended: snapshot)*

## PRD §3: Your Mission — Build the MVP

**Gist:** Three actors: Passenger (Nusrat, Rafiq, Shirin), Driver/Tesla (Jashim, Bullet) and Ride/Pool. No real routing needed; engineering judgment is graded. The suggested lifecycle can be improved if the change is explained.
- Passenger: sign up/in; request a ride (pickup, destination, seats); see estimated fare; track status (waiting → matched → in progress → completed/cancelled); view history; cancel while valid.
- Driver: sign in; go online/offline; owns one Tesla with fixed capacity; sees relevant requests; accepts a ride/pool; marks arrived, started, completed; sees passengers/seats and ride history.
- Pool: several requests may share one Tesla; occupied seats never exceed capacity; each passenger has an individual fare; clear lifecycle and obvious pool membership.
- Suggested states: REQUESTED → MATCHED/ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED (+ CANCELLED).

**Decision points:**
- [ ] P3.1 Driver onboarding: drivers only "sign in", so do they sign up or are they seeded? *(open, recommended: seeded; driver sign-up is out of MVP scope)*
- [ ] P3.2 User model: one `users` table with a role vs separate passenger/driver tables. *(open)*
- [ ] P3.3 Seats per request: allow more than 1 seat (1..capacity) and how it affects pooling. *(open)*
- [ ] P3.4 Estimated vs final fare: what is shown before matching and whether it changes when someone joins the pool. *(open)*
- [ ] P3.5 Online/offline rules: only online drivers see requests; cannot go offline during an active ride. *(open)*
- [ ] P3.6 Matching ownership: system auto-assigns vs driver accepts requests vs hybrid (system suggests compatible requests, driver accepts). *(open)*
- [ ] P3.7 Cancellation rules: who may cancel, until which state, effect on pool and freed seats. *(open)*
- [ ] P3.8 Lifecycle improvements: per-passenger states (e.g. PICKED_UP, DROPPED_OFF), expiry when no driver accepts, mapping to passenger-facing labels. *(open)*
- [ ] P3.9 Vehicle ownership: one vehicle per driver with fixed capacity (Bullet = 3). *(open, recommended: yes)*

### Additional decisions raised during §3 review

- [x] P3.10 Multiple drivers/vehicles/pools: the PRD does not state it explicitly. **Decided: Option B.** Schema and logic support many drivers, vehicles and concurrent pools. Rule: one active pool per driver; one request belongs to at most one pool. Seed Jashim + Bullet as the main driver plus a second driver (Kamal) to demonstrate "relevant requests". Documented as an assumption.
- [x] P3.11 Driver pooling choice: **Decided:** when accepting a request, the driver chooses whether the ride is open for pooling. If pooling is off, no other request can join, even with free seats (e.g. low battery, driver preference). Details (default value, whether it can change before STARTED) *(open)*.
- [x] P3.12 Private ride / multi-seat booking: **Decided:** a passenger can book more than one seat (e.g. for a friend on the same route) and can request a private ride that is never shared. Open details: private ride = all seats vs a "no-share" flag; fare for private and multi-seat bookings; whether a friend is only a seat count or a named rider *(open)*.

### Edge cases (approved 2026-09-28: all will be implemented)
- [x] E1 Request expiry: a REQUESTED ride that no driver accepts within N minutes becomes EXPIRED.
- [x] E2 One active request per passenger at a time.
- [x] E3 Driver cannot go offline or accept a new pool while having an active pool.
- [x] E4 Per-passenger drop-off: one rider can be DROPPED_OFF before the pool completes.
- [x] E5 Validation: pickup ≠ destination; seats between 1 and vehicle capacity.
- [x] E6 Idempotent ride creation: a double-tap must not create two requests (idempotency key).
- [x] E7 Passenger no-show: at DRIVER_ARRIVED the driver can mark a rider as no-show, freeing the seat.

## PRD §9: Architecture First

**Gist:** Design before implementing. Provide an architecture diagram (at minimum Browser → Next.js/React → Node.js API → Database) and an ERD. The implementation must match the documented architecture, and docs are updated whenever it changes. No microservices, Kafka, Kubernetes, Redis or queues unless there is a real reason.

**Decision points:**
- [ ] P9.1 Diagram format: Mermaid (text, versioned, renders on GitHub) vs Excalidraw/draw.io image. *(open, recommended: Mermaid)*
- [ ] P9.2 Docs location: README summary + `docs/` folder (architecture, ERD, state machine, matching, fare). *(open)*
- [ ] P9.3 Docs-code sync rule: any change to architecture/schema updates the docs in the same PR. *(open, recommended: yes)*
- [ ] P9.4 No extra infrastructure: concurrency via database transactions/locks, expiry via lazy `expires_at` checks; no Redis/queues. *(open, recommended: yes)*

## PRD §10: Git Workflow

**Gist:** Long-lived branches `master`, `pre-release`, `release/<version>`; all feature work on `feature/*` with incremental commits. Flow: feature branch → merge into `master` when it works → cut `pre-release` after MVP integration for fixes, docs and deployment checks → cut `release/v1.0.0` from `pre-release` as the version shown in the video/deployment. The history itself is graded.

**Decision points:**
- [ ] P10.1 Setup work (scaffolding, Docker, CI) also goes through `feature/*` branches, never direct to `master`. *(open, recommended: yes)*
- [ ] P10.2 Merge strategy: merge commit (`--no-ff`) vs squash vs rebase. *(open, recommended: merge commit; squash would erase the incremental history)*
- [ ] P10.3 Fixes made on `pre-release` are merged back into `master` so branches do not diverge. *(open, recommended: yes)*
- [ ] P10.4 Tag `v1.0.0` on `release/v1.0.0`. *(open)*
- [ ] P10.5 Feature branch plan (names and order). *(open, decided during planning)*

## PRD §11: Commit Message Rules

**Gist:** Format `<type>(<scope>): <short description>`, types feat/fix/refactor/test/docs/chore/build. One commit = one understandable logical change. No vague messages ("update", "fix", "final", "working now") and no meaningless micro-commits.

**Decision points:**
- [ ] P11.1 Fixed scope vocabulary (e.g. repo, api, web, db, auth, ride, pool, fare, driver, docker, ci, docs). *(open)*
- [ ] P11.2 Commit size guideline: one behaviour + its tests per commit where possible. *(open)*

## PRD §8 (partial): AI Usage Policy

**Gist:** AI tools are allowed and must not be hidden. The candidate owns all code and must be able to explain, debug, redesign or change any part live: what the code does, why the architecture and database look the way they do, how auth and capacity are enforced, how the app fails. The README needs an AI Usage section: tools used, what for, one accepted suggestion, one rejected/changed suggestion and why. Scoring is on understanding, not on using less AI.

**Decision points:**
- [ ] P8.1 Keep a running log of accepted and rejected AI suggestions during development, so the README section is real rather than reconstructed. Candidates so far: rejected "push directly to main" (conflicts with PRD §10); changed "FastAPI backend" to Node.js (PRD §6 mandates Node). *(open, recommended: yes)*
- [ ] P8.2 Every component is explained before it is committed, so it can be defended live. *(open, recommended: yes)*

## PRD §12: README, Testing, Concurrency & Bonus

**Gist:** The README has a fixed minimum list (summary, problem, features, screenshots, diagrams, stack, structure, prerequisites, env vars, setup, Docker, migrate/seed, run instructions, tests, demo credentials, deployment URL, API overview, decisions, limitations, next steps, AI Usage, video link). Meaningful tests must cover: capacity never exceeded, invalid transitions rejected, Nusrat and Rafiq's pooled fares, users cannot modify others' rides, cancellation rules, concurrent requests cannot corrupt capacity. Concurrency case: Bullet has 1 seat left and Nusrat and Shirin claim it at the same instant; document the current handling and what changes at scale. Bonus: reason about scaling to 1M passengers / 100k drivers without over-building.

**Decision points:**
- [ ] P12.1 README headings follow the PRD list exactly, so the evaluator can tick them off. *(open, recommended: yes)*
- [ ] P12.2 Test levels: unit tests for pure logic (fare, state machine) + integration tests against a real Postgres for capacity, ownership, cancellation and concurrency. No mocked database for integrity tests. *(open, recommended)*
- [ ] P12.3 Concurrency strategy: (a) row lock on the pool (`SELECT ... FOR UPDATE`) inside a transaction; (b) atomic conditional update of a seat counter; (c) optimistic locking with a version column and retry; (d) SERIALIZABLE isolation with retry. Plus a database CHECK constraint as a final guard. *(open, decided in design step)*
- [ ] P12.4 Screenshots/GIFs and demo video produced on `pre-release` after the UI is stable. *(open)*
- [ ] P12.5 Bonus written as `docs/scaling.md`, reasoning first, one diagram. *(open, recommended: attempt if time allows)*

### P12.3 analysis: concurrency and seat capacity (proposed, awaiting approval)

**Invariants to protect:**
- I1: seats taken in a pool never exceed its capacity.
- I2: a ride request belongs to at most one active pool (two drivers, or a driver and the auto-joiner, cannot take the same request).
- I3: a pool accepts joins only before STARTED and only if pooling is allowed.
- I4: a driver has at most one active pool. I5: a passenger has at most one active request.

**Options evaluated:** (a) pessimistic row lock on the pool; (b) atomic conditional counter update; (c) optimistic version check with retry; (d) SERIALIZABLE isolation with retry; (e) seat-slot rows with a unique constraint; (f) in-process mutex / Redis lock; (g) single writer per pool through a queue.
- (f) is rejected: it breaks with more than one API instance, and Redis is excluded by PRD §9.
- (g) is rejected for the MVP: it is a scale design, noted for `docs/scaling.md`.
- (c) and (d) are rejected as the primary mechanism: conflicts are the normal case at the last seat, so retries happen exactly when they hurt, and the losing request can lose repeatedly.
- (e) is rejected: it is correct, but multi-seat bookings need several rows claimed at once, which adds complexity with no gain over the chosen design.

**Proposed hybrid (each part covers a different failure):**
1. The pool row is the lock boundary. Every pool mutation (join, cancel, no-show, start, pooling toggle, driver cancel) runs in one transaction that begins with `SELECT ... FROM pools WHERE id = $1 FOR UPDATE`. The service reads the state under the lock and decides, returning clear reasons (full, started, pooling off).
2. The pool stores `seat_capacity` (copied from the vehicle at creation) and `seats_taken`, with `CHECK (seats_taken BETWEEN 0 AND seat_capacity)`. The counter is changed only as `seats_taken = seats_taken + n` in SQL, inside the same transaction as the member row. The database rejects overbooking even if application code is wrong.
3. The request status changes by compare-and-set: `UPDATE ride_requests SET status = 'MATCHED' ... WHERE id = $1 AND status = 'REQUESTED'`. Zero rows means someone else took or cancelled it.
4. Partial unique indexes: one active membership per request, one active pool per driver, one active request per passenger.
5. Fixed lock order (pool, then request) to avoid deadlocks; `SET LOCAL lock_timeout` so a waiting request fails fast with a retryable error instead of hanging.
6. READ COMMITTED isolation (the Postgres default) is sufficient because of the explicit lock and the constraints.

**Fairness definition:** the first request to reach the database lock wins (server order, not client tap time, since client clocks cannot be trusted). The loser is never dropped: its request stays REQUESTED and matching continues with the next compatible pool, or it waits for a driver. Both outcomes are written to the status history.

**Verification:** an integration test fires many parallel joins for the last seat against real Postgres and asserts exactly one success, `seats_taken = seat_capacity`, and `seats_taken` equal to the sum of active member seats. It is repeated in a loop to catch timing-dependent failures. A second test proves the CHECK constraint rejects a direct over-capacity update.

### Scope update (2026-09-28): extra features deferred

**Decision:** Features beyond the PRD are deferred until the MVP core is complete and tested. They are added last, on their own `feature/*` branches, before `pre-release` is cut.
- P3.10 Multiple drivers: **deferred** (second driver Kamal in seed, cross-driver relevance demo). The schema stays multi-driver by nature (drivers are users, vehicles reference drivers); nothing is hard-coded to Jashim.
- P3.12 Private ride / named friend riders: **deferred**.
- Multi-seat requests: **NOT deferred.** PRD §3 lists "Request ride: pickup, destination, seats", so a `seats` value (1..capacity) is MVP scope.
- P3.11 Driver pooling toggle: *(open: defer or keep)*.
- Integrity rules I1–I5 stay in the MVP regardless of scope, because they protect data even with one driver.

**Reasoning:** A strong core (capacity, transitions, ownership, fares, tests) is what the PRD scores. The schema is kept extension-ready only where it costs nothing (columns with defaults, no hard-coded ids), with no logic or UI built for deferred features.

## Deployment constraint (PRD §6, reinforced 2026-09-28)

**Gist:** The app must be publicly deployed on free tiers only, with no payment. If free backend hosting is not possible, document the constraint and provide a reproducible Docker deployment instead.

**Decision points (open, decided at the deployment step, with free-tier terms verified at that time):**
- [ ] PD.1 Hosting split: frontend host, backend host, managed Postgres. Candidates: Vercel (Next.js), Render/Koyeb (Node API), Neon/Supabase (Postgres). Free-tier terms change often and must be re-checked before choosing.
- [ ] PD.2 Same database engine everywhere: Postgres locally (Docker) and in production; no SQLite, because free hosts have ephemeral disks.
- [ ] PD.3 Config only through env vars (`DATABASE_URL`, `PORT`, secrets); no local file storage.
- [ ] PD.4 Migrations and seed run as part of deployment so the demo credentials work live.
- [ ] PD.5 Cold starts on free backends: the frontend loading states must handle a slow first request; documented as a known limitation.
- [ ] PD.6 Cross-origin auth: frontend and API on different domains affects cookies (SameSite, third-party cookie blocking) and CORS. Decide with the auth design: same-origin proxy through Next.js vs bearer token.
- [ ] PD.7 Small DB connection pool, to respect free-tier connection limits.
- [ ] PD.8 The live deployment runs `release/v1.0.0` (PRD §10).

### Update (2026-09-28): driver control over pooling

- [x] P3.11 Driver pooling toggle: **kept in MVP** (his call). At accept time the driver chooses shared or solo; `pooling_allowed` on the pool; joins are rejected when it is off.
- [x] P3.6 Matching ownership: **changed.** The system never adds a passenger to a pool without the driver's decision. The system only finds compatible requests; the driver accepts or rejects every join, even with pooling on.
- [ ] P3.6a How the join is claimed *(open, proposed Y)*:
  - X. Driver-accept only: the request stays REQUESTED and appears in the driver's list; a seat is taken only when the driver accepts. Simpler, but the PRD's "Nusrat and Shirin claim the last seat" race exists only on the driver side.
  - Y. Seat hold + driver confirm: a compatible request places a HELD membership on the pool (the seat counter includes held seats), and the driver confirms or rejects within N seconds. Reject or timeout releases the seat and returns the request to REQUESTED. The PRD race happens at claim time and is resolved by the pool lock; the driver keeps full control.
  - For both: a rejected request is not offered to the same pool again (membership status REJECTED, kept in history). Unmatched compatible requests stay visible in the driver's relevant-requests list, so no background re-matching job is needed.

### P12.3 refinement: concurrent accepts when no pool exists yet (proposed)

**Problem:** Jashim is online with no pool. He accepts Nusrat and Rafiq at the same instant. There is no pool row to lock yet, so both accept transactions try to create a pool.

**Options:**
1. Rely on the partial unique index only: the second pool INSERT fails and the driver sees an error and must tap again. Correct, but poor UX.
2. Catch the unique violation and retry as a join to the existing pool. Correct and automatic, but adds retry logic and error-code handling.
3. Lock the vehicle row (`SELECT ... FROM vehicles WHERE id = $1 FOR UPDATE`) at the start of every accept. Under that lock: find the driver's active pool; create it if none exists, otherwise treat the accept as a join (capacity and pooling checks). The unique index stays as a backstop.

**Proposed:** Option 3. The vehicle is the natural lock boundary: capacity belongs to the vehicle, and a vehicle has at most one active pool. All accepts for one vehicle run one after another with no retries. The global lock order becomes **vehicle → pool → request** in every flow, to avoid deadlocks.

### Decided (2026-09-28)
- [x] Seats per request: **B**, 1..vehicle capacity (PRD §3 lists seats). A request can be rejected with "doesn't fit" when free seats < requested seats.
- [x] P3.6a Join mechanism: **Y**, seat hold + driver confirm with timeout.

### P12.3 consolidated concurrency design (proposed v2, supersedes the earlier proposal)

**Operations that change seats or pool state:** place hold (system, on request creation), driver accept (from REQUESTED or confirming a HELD seat), reject, hold timeout, passenger cancel, driver cancel, no-show, pooling toggle, start, complete, driver going offline.

**Design, "one vehicle = one serialization point":**
1. **Serialize:** every operation above starts with `SELECT ... FROM vehicles WHERE id = $1 FOR UPDATE`. The separate pool-row lock is dropped: a pool belongs to exactly one vehicle, so a second lock adds deadlock risk and no safety. Each transaction holds at most one vehicle lock; when trying several candidate pools, they are tried one at a time.
2. **Decide (service layer, under the lock):** first release expired holds on that vehicle's pool (lazy expiry), then check state, pooling flag and free seats, and return a specific reason on failure.
3. **Guard (database):** `seats_taken` with `CHECK (seats_taken BETWEEN 0 AND seat_capacity)`, counting HELD + CONFIRMED seats; partial unique indexes (one active pool per vehicle, one active membership per request, one active request per passenger); unique idempotency key per passenger; compare-and-set on request status for operations that do not take the vehicle lock (e.g. cancelling an unmatched request).
4. **Liveness:** READ COMMITTED; short transactions with no network calls inside; `lock_timeout` so a waiting request fails fast with a retryable error.
5. **Audit:** every state change writes its status-history row in the same transaction.

**Alternative considered as the main rival:** constraints and conditional updates only, with no explicit lock. It is correct for single-row checks, but multi-step rules (start requires every rider picked up, sweeping expired holds, pool creation) become chains of conditional SQL, business logic moves into SQL, and failure reasons become ambiguous. Rejected.

**Open parameter:** hold timeout N (proposed 60 s, configurable by env var).

### Fit-based matching rule (his requirement, 2026-09-28)

- [x] When a request needs more seats than are free (e.g. needs 2, 1 free), the system does not hold a seat. The passenger is told the exact shortfall ("1 seat short") and the request stays REQUESTED.
- [x] A request that fits (e.g. 1 seat) arriving at the same time is placed into the pool automatically as a HELD seat. Under Y, the driver still confirms it.

### Proposed follow-ups from the concurrency/edge-case review (awaiting approval)
- [ ] F1 Fairness order is "FIFO among requests that fit": a later 1-seat request may take a seat that an earlier 2-seat request cannot use. This avoids wasting seats (head-of-line blocking) and is documented.
- [ ] F2 Release-triggered re-matching: whenever seats are freed (reject, timeout, cancel, no-show), the same transaction, still under the vehicle lock, tries to hold seats for the oldest waiting compatible requests that now fit. No background job.
- [ ] F3 Requests previously rejected by this pool's driver are skipped by automatic re-matching (the driver can still pick them manually).
- [ ] F4 A pool left with no members before STARTED is closed automatically, so the driver is free again.
- [ ] F5 Time is taken from the database clock (`now()`), not the app server clock, for `expires_at` and ordering, so several API instances agree.
- [ ] F6 An idempotency key reused with a different payload is rejected (422), not treated as a duplicate.
- [ ] F7 Driver going offline releases pending holds and is refused while a confirmed or started pool exists (E3).
- [ ] F8 A "seat short" passenger is only informed in the MVP; no "reduce my seats" action.
- [ ] F9 Fare recalculation on join/leave happens inside the same locked transaction; fares lock at STARTED.
- [ ] F10 Realtime updates: polling for the MVP (decided with the frontend design).

### Fare stability (raised 2026-09-28, proposed)

**His point:** a shared-ride fare should not change depending on how many others join.
**PRD check:** §5 gives `passengerFare = baseFare + distanceCharge - poolDiscount` and requires fares that can be checked by hand for Nusrat and Rafiq. It does not require the discount to depend on the number of co-riders.
**Options:**
- A. Upfront fixed fare: shared rides get a fixed pool discount; the fare is locked when the passenger's seat is confirmed and never changes because of others joining or leaving. Solo rides pay the full fare.
- B. Dynamic: the discount grows with the number of co-riders and is recalculated until STARTED (the earlier C15/F9).
- C. Binary at start: the discount applies only if the pool actually has 2+ riders at STARTED.

**Proposed: A.** Passengers see a price they can trust before the trip; fares are trivially hand-testable; no fare recalculation races (C15 and F9 disappear). A passenger who opted into a shared ride but ends up alone still pays the shared price, since the discount is for accepting sharing. At request time both estimates (shared and solo) are shown, because the driver chooses the mode.

### Decided (2026-09-28, continued)
- [x] "Auto join" means an automatic HELD seat; the driver always confirms (Y).
- [x] F-list scope (rule: keep only what the core breaks without; defer the rest):
  - **Keep:** F1 (FIFO among fitting requests: comes free with the fit rule), F4 (auto-close an empty pool: otherwise a pool with no riders stays stuck in an active state), F5 (database clock: correctness, zero cost), F8 (seat-short = inform only: this is the minimal scope itself), F10 (polling: some update mechanism is required, and polling is the smallest).
  - **Deferred:** F2 (release-triggered re-matching: waiting requests remain in the driver's relevant list, so the driver can still accept them manually), F3 (only matters with F2), F6 (payload check on a reused idempotency key: the frontend creates a new key per submit, so only a client bug could trigger it).
  - **Covered elsewhere:** F7 is covered by E3 (a driver cannot go offline while any active pool exists, and holds only exist on active pools). F9 is removed if fare option A is approved.
- Pending: v2 approval (simple re-explanation requested), hold timeout value, fare option A.

### Decided (2026-09-28)
- [x] Concurrency design v2 ("one vehicle = one serialization point"): approved, subject to the audit fixes below.
- [x] Hold timeout: 60 s (`HOLD_TIMEOUT_SECONDS`); on timeout the seat is released and the request returns to REQUESTED (history: EXPIRED hold).
- [x] Fare option A: upfront fixed fare, locked at seat confirmation (F9 removed).

### v2 audit: gaps found and fixes (approved 2026-09-28)
- [x] G1 Deadlock trap: a passenger cancel that locks the request and then the vehicle would deadlock with a hold (vehicle, then request). Fix: never lock a request before its vehicle. Cancel first tries a compare-and-set on an unmatched request; if that fails, it re-reads the request and takes the vehicle path.
- [x] G2 A stale REQUESTED row past its `expires_at` would block the passenger's next request through the one-active-request unique index. Fix: request creation first expires the passenger's own stale requests in the same transaction.
- [x] G3 Reads could show an expired hold as HELD. Fix: reads compute the effective status from `expires_at`; write paths persist the change (sweep).
- [x] G4 A retried driver action (response lost, client retries) must not fail. Fix: transitions are idempotent; if the target state is already reached by the same actor, return the current state.
- [x] G5 Start or pooling-off while holds are pending. Fix (changes the earlier C8/C9 answer): pending unconfirmed holds are released automatically and those requests return to REQUESTED; confirmed riders are unaffected.
- [x] G6 A request returned to REQUESTED (driver cancels the pool, or a hold placed at creation times out) gets a fresh `expires_at`, so it does not expire immediately. Note: with F2 deferred, holds are only placed at request creation; a waiting request can later join only through a direct driver accept (CONFIRMED, no hold).
- [x] G7 Implementation: every query in a locked transaction must run on the same database connection, and the data-access tool must support `SELECT ... FOR UPDATE`. This is an input to the ORM choice (PRD §7).
- [x] G8 Under a small free-tier connection pool, many requests waiting on one vehicle lock can hold connections. Fix: short transactions + `lock_timeout`; documented in scaling notes.
- [x] G9 Rule "read outside, re-check inside": candidate pools may be found without a lock, but every condition is re-checked after the vehicle lock is taken.
- [x] G10 Going online/offline also takes the vehicle lock, and accept checks the online flag under that lock.

### v2 coverage review (2026-09-28): hardening (approved)

**Coverage map:** capacity (I1): DB CHECK + lock; one request in one pool (I2): partial unique + CAS; no join after STARTED / pooling off (I3): service check under lock only; one active pool per vehicle (I4): partial unique; one active request per passenger (I5): partial unique; duplicate submit: unique idempotency key; time-based races: DB clock + sweep under lock; crash mid-transaction: atomic rollback; lost response: idempotent transitions (G4).

**Known limits:** I3 is enforced only by code discipline; decisions assume a single primary Postgres; a TeslaPay wallet (if chosen in §5) is outside the vehicle lock.

- [x] H1 Move I3 into the database write: the seat increment is a conditional update `... WHERE id = $1 AND status IN (joinable states) AND pooling_allowed`, so a join after STARTED fails even if a code path forgot the lock.
- [x] H2 One entry point: a repository helper `withVehicleLock(vehicleId, fn)` is the only way to change pools and memberships.
- [x] H3 After concurrency tests, assert the invariant `seats_taken = SUM(active member seats)` for every pool.
- [x] H4 If a wallet is implemented, deduct with `UPDATE wallets SET balance = balance - $x WHERE id = $1 AND balance >= $x` (its own atomic guard).
- [x] H5 All decisions read from the primary database (relevant only if read replicas are added later).

### Decided (2026-09-28): pending approvals batch
- [x] Tier 1 / Tier 2 build order with checkpoints (Day 1: Tier 1 backend + tests; Day 2: frontend + Tier 2 as time allows; Day 3: pre-release, deploy, README, video, no new features). Tier 2 order: pooling toggle, request expiry (E1), seat hold (Y), per-passenger drop-off (E4), no-show (E7); cut from the bottom.
- [x] P1.1 PRD cast (Jashim, Bullet, Nusrat, Rafiq, Shirin); Kamal only if multi-driver is built.
- [x] P3.7 Cancellation: a passenger may cancel before STARTED (seat freed immediately); a driver may cancel before STARTED (riders return to REQUESTED with a fresh expiry, G6); no cancellation after STARTED.
- [x] P9.1 Mermaid diagrams.
- [x] P10.1 Setup work also goes through `feature/*` branches.
- [x] P10.2 Merge commits only; squash and rebase merging disabled in GitHub repo settings.
- [x] P10.3 Fixes on `pre-release` are merged back into `master`.
- [x] P11.1 Scopes: repo, api, web, db, auth, ride, pool, fare, driver, docker, ci, deploy, docs.
- [x] P12.2 Unit tests for pure logic + integration tests on real Postgres (a dedicated test database in Docker).
- [x] P8.1 AI suggestion log kept in `claude_help.md` (private), summarized in the README AI Usage section.

### Stack decisions (2026-09-28)
- [x] Language: TypeScript (backend and frontend).
- [x] Backend: **NestJS** (his choice). Proposed was Fastify for built-in logging/validation and fewer framework abstractions; NestJS was chosen because its module/controller/service structure matches the layered architecture. Mitigations: explain decorators and dependency injection as they are introduced; structured logging via a pino integration; repositories stay explicit so the vehicle-lock transactions (G7) remain visible.
- [x] API style: REST.
- [x] Frontend: Next.js (App Router).
- [ ] Timing of the architecture diagram and ERD: he asked for them at the end; PRD §9 requires "Architecture First". *(open, see the proposal in chat)*

### PD.1 research (2026-09-28, web search; re-check at deploy time)
- Frontend: Vercel Hobby (free, no card, personal/non-commercial; pauses instead of billing when limits are hit).
- Backend (NestJS, long-running): Render free web service (sleeps after 15 min idle, ~1 min cold start) or Koyeb free instance (1 service, scales to zero after 1 h idle; may ask for a card for verification). Not Vercel functions: the 10 s limit and per-invocation DB connections suit the lock-based design poorly.
- Database: Neon free (0.5 GB, compute suspends on overuse but data is kept, permanent tier). Avoid Supabase free (pauses after 1 week idle) and Render free Postgres (expires), since evaluation may happen weeks after submission.
- Proposed combination: Vercel + Render (or Koyeb) + Neon. All free.

---

## Pre-implementation design review (2026-09-28)

Every MVP feature was walked through as mental test cases (normal path, concurrent path, failure path).

### New gaps found (proposed fixes)
- [x] G11 Double tap vs one-active-request: two inserts with the same idempotency key race; the second may hit the one-active-request index before the idempotency index and return 409 instead of the original ride. Fix: on any unique violation during request creation, look up by idempotency key first and return the existing ride if found.
- [x] G12 Concurrent sign-ups with the same email: unique index on lower(email); the loser gets 409.
- [x] G13 Deploy with two instances: migrations use the tool's migration lock; seed is idempotent (upsert by natural key), so running it twice is safe.
- [x] G14 Start with no boarded passengers (all no-show or cancelled): rejected; the empty pool is closed (F4).
- [~] G15 (REJECTED 2026-09-28, obsolete) A rider returned to REQUESTED loses the locked fare; a new fare is locked at the next confirmation.
- [x] G16 All times stored as `timestamptz` (UTC), shown in Asia/Dhaka on screen.
- [x] G17 Ownership: every passenger action checks `request.passenger_id = current user`; every driver action checks `vehicle.driver_id = current user`; role checked first. Tested ("users can't modify another user's ride").

### Proposed status model
- **Pool:** ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED; CANCELLED (driver cancel, or empty before start via F4).
- **Ride request (passenger):** REQUESTED → [HELD, Tier 2] → MATCHED → IN_PROGRESS → COMPLETED; terminal alternatives CANCELLED, EXPIRED (E1), NO_SHOW (E7). Per-passenger drop-off (E4) = that passenger's COMPLETED; the pool completes when its last passenger completes.
- **Membership outcome** (history of a request in a pool): HELD, CONFIRMED, REJECTED, RELEASED (hold timeout or start/pooling-off), LEFT (cancel, no-show, completed).
- **Driver availability:** OFFLINE / ONLINE (busy is derived from an active pool).
- Considered and not added: DRIVER_EN_ROUTE (same as ACCEPTED), PICKED_UP (implied by STARTED), PAYMENT_PENDING/PAID (cash only), RATED, DISPUTED.
- Passenger-facing labels: waiting = REQUESTED/HELD; matched = MATCHED; in progress = IN_PROGRESS; completed / cancelled / expired / no-show.

### Decisions still blocking the ERD and diagram
- [ ] B1 Geography + matching rule (PRD §4).
- [ ] B2 Fare numbers, money in integer paisa, payment method (PRD §5).
- [ ] B3 ORM / query tool (must support transactions on one connection, `FOR UPDATE`, CHECK, partial unique indexes, migrations).
- [ ] B4 Auth method + cross-origin handling (PD.6).
- [ ] B5 Validation, test framework, styling, logging libraries.
- [ ] B6 Repository layout (e.g. `api/` + `web/` + root `docker-compose.yml`).
- [ ] B7 Status model above.
- [ ] B8 Table list (P3.2 users with role; vehicles; areas; ride_requests; pools; pool_members; status_events).
- [ ] B9 Privacy (P1.4): what passengers see about co-riders; what drivers see about passengers.
- [ ] B10 Basic security baseline: password hashing, input validation, login rate limit, security headers, no secrets in the repo.
- [ ] B11 Tier 2 columns added by their own migrations when the feature is built (keeps the history honest), not in the first migration.

### Decided (2026-09-28): every ride is shared-eligible, no solo mode
- [x] Assumption: every ride can be shared; passengers and drivers cannot choose "solo". **Reverses P3.11** (pooling toggle removed from MVP and Tier 2). Private ride (P3.12) stays deferred.
- The driver keeps full control through accept/reject of every join; a driver who wants a single passenger (e.g. low battery) simply rejects further joins.
- Simplifications: no `pooling_allowed` column; I3 and H1 only check the pool state; the pooling-off parts of C2/C9/G5 are removed; G15 only matters if the fare depends on actual sharing.
- [ ] Open: how `poolDiscount` applies now that every ride is shared-eligible (see chat: always vs only when actually shared at STARTED).

### Revised (2026-09-28): shared and solo ride types (proposed details)
- [x] Keep two ride types; the discount exists only for shared (his call). Replaces the "every ride shared-eligible" entry above.
- [ ] Proposed details (awaiting confirmation):
  - The **passenger** chooses the type at request time (they pay for it). The driver still accepts or rejects.
  - SHARED: fare = base + distance − poolDiscount, locked at confirmation; kept even if nobody else joins (the discount is the price for accepting sharing; no recalculation, consistent with Fare A).
  - SOLO: fare = base + distance (no discount); the pool is closed to joins (`pool.is_shared = false`); a solo request can be accepted only into an empty vehicle.
  - Cost: one `ride_type` column on requests, one `is_shared` column on pools, and one extra check in the fit/join rule (I3/H1 include `is_shared`). Proposed as Tier 1 because the fare model depends on it.

### Decided (2026-09-28): joins after STARTED and distance model
- [x] Joins while STARTED: **option C.** A started shared pool accepts a join only from an area the vehicle has not reached yet on its route (seats free, driver accepts). Needs: an ordered route of areas per pool, the driver marking the current area as he moves, and a per-passenger pickup state (waiting for pickup → on board). Proposed build order: A (closed at STARTED) as the Tier 1 baseline, C added in Tier 2 on top of it.
- [x] Distance model: every pair of adjacent locations is **2 km** apart; a trip's distance = number of hops × 2 km.
- [ ] Fare numbers: "৳20 +/-" needs clarifying (per km vs per hop; base fare; pool discount size).
- [x] Option C is built directly as part of the core (his call), not as a later layer. Still delivered in incremental commits inside its feature branch.
- [ ] Map/route source (proposed): no external map or routing API. Areas and routes are data in the database (seeded): `areas` (name, lat/long for display), `routes` + ordered `route_stops`; adjacent stops are 2 km apart. Optional later: a Leaflet + OpenStreetMap map on the frontend for display only (PRD §4 allows "a lightweight free map").
- [x] Map/route source: option 3 approved (areas, routes and ordered route_stops in the DB via seed; no external map API; optional Leaflet/OSM display later).
- [x] Distance charge: ৳20 per hop (one hop = 2 km between adjacent stops).
- [x] Fare constants: baseFare ৳30, distanceCharge ৳20 per hop, poolDiscount 20% of (base + distance) for SHARED only. Worked examples: Nusrat Banani→Mohakhali (1 hop) solo ৳50 / shared ৳40; Rafiq Banani→Gulshan 1 (2 hops) solo ৳70 / shared ৳56.
- [x] Money stored as integer paisa; percentage results rounded half-up to the nearest paisa; converted to taka only for display.
- [x] Payment: cash only. TeslaPay wallet deferred (H4 then applies).
- [x] B1 Routes: Route 1 Uttara–Banani–Mohakhali–Gulshan 1–Bashundhara; Route 2 Banani–Mohakhali–Farmgate–Dhanmondi; Route 3 Mirpur–Farmgate–Dhanmondi; bidirectional; shared segments have equal hop counts. Documented as a simplified network (assumption).
- [x] B1 Matching rule: a request joins a pool only if both are SHARED, the pickup comes before the destination on the pool's route and direction, the pickup is at or ahead of the vehicle's current stop, free seats ≥ requested seats, and the pool is not finished. First accept picks the route containing pickup→destination in order (fewest hops, then lowest id).
- [x] Driver actions for C: next stop, picked up, dropped off, no-show. A passenger can be MATCHED (waiting for pickup) while the pool is STARTED.
- [x] Relevant requests: with no pool, all waiting requests (oldest first); with a pool, compatible requests plus "doesn't fit" reasons.
- [x] B3 ORM: **Prisma** (his call; Drizzle was proposed), with raw SQL only where Prisma has no API. Known raw-SQL points: the vehicle lock (`SELECT ... FOR UPDATE` inside an interactive transaction, via a typed helper); CHECK constraints and partial unique indexes written by hand in migration SQL (`prisma migrate dev --create-only`, then edit) and documented because `schema.prisma` does not show them. The conditional seat update (H1) uses `updateMany` with conditions and checks the count, so it stays in the Prisma API. The interactive transaction timeout is configured to exceed `lock_timeout`.
- [x] B4 Auth (MVP): **database-backed session tokens** (chosen for simplicity; he delegated the choice). Login creates a random 32-byte token; its SHA-256 hash is stored in a `sessions` table with user id and expiry (12 h); the raw token goes in an httpOnly, SameSite=Lax cookie (Secure in production) through the Next.js same-origin proxy. A NestJS guard looks the session up on every request; logout deletes the row. Passwords hashed with bcryptjs (pure JS, no native build in Docker). Role guard + ownership checks (G17) + login rate limit (throttler).
  - Rejected: header "user id" without password (not real auth; PRD grades auth and security); in-memory express-session (sessions lost when a free-tier server sleeps or restarts).
  - JWT later only if time allows. The guard interface stays the same, so a switch changes only AuthService + AuthGuard.

### B5 / B6 (approved 2026-09-28)
- [x] Validation: class-validator + class-transformer via NestJS `ValidationPipe` (whitelist, forbid unknown fields). Alternative: zod (shared schemas), rejected because sharing needs a monorepo toolchain.
- [x] Tests: Jest + Supertest (NestJS defaults). Unit tests for fare, state machine and matching; integration tests against a real Postgres test database in Docker Compose. No frontend automated tests in the MVP (manual checklist instead).
- [x] Styling: Tailwind CSS.
- [x] Logging: nestjs-pino (structured JSON, a request id per request, pretty output in development).
- [x] Frontend data fetching: TanStack Query (polling via `refetchInterval` for F10; built-in loading/error states, which the PRD grades).
- [x] B6 Repository layout: one repo with `api/` (NestJS), `web/` (Next.js), `docs/`, root `docker-compose.yml`, root `.env.example`, `.github/workflows/`. No npm workspaces or Turborepo; the few shared enums are duplicated and noted.

### B7 status model v2 (approved 2026-09-28)

**Pool:** ACCEPTED → DRIVER_ARRIVED → STARTED → COMPLETED; ACCEPTED/DRIVER_ARRIVED → CANCELLED.
- ACCEPTED: created by the first accept; the vehicle is heading to the first pickup stop.
- DRIVER_ARRIVED: the vehicle is at the first pickup stop.
- STARTED: moving along the route; `current_stop_index` advances with "next stop". Joins allowed only for pickups ahead (index > current) on a shared pool.
- COMPLETED: automatic when STARTED and no active members remain.
- CANCELLED: by the driver before STARTED, or automatic when empty before STARTED (F4).
- Start requires ≥1 passenger IN_PROGRESS and no MATCHED passenger still waiting at the current stop (the driver marks picked up or no-show first); pending holds are released (G5).

**Ride request (passenger lifecycle):**
| From | To | Who / when |
|---|---|---|
| REQUESTED | HELD | system: fits a shared pool (Y) |
| REQUESTED | MATCHED | driver accepts directly |
| REQUESTED | CANCELLED | passenger |
| REQUESTED | EXPIRED | expiry time passed (E1) |
| HELD | MATCHED | driver confirms |
| HELD | REQUESTED | driver rejects, hold timeout, start releases, pool cancelled |
| HELD | CANCELLED | passenger |
| MATCHED | IN_PROGRESS | driver: picked up |
| MATCHED | NO_SHOW | driver, at the pickup stop (E7) |
| MATCHED | CANCELLED | passenger, until picked up |
| MATCHED | REQUESTED | driver cancels the pool before STARTED |
| IN_PROGRESS | COMPLETED | driver: dropped off (E4) |
Terminal: COMPLETED, CANCELLED, EXPIRED, NO_SHOW. Every other transition is rejected.
- Change to P3.7 (approved): a passenger can cancel until picked up (previously "before the pool STARTED"), because with option C a passenger may wait ahead of a STARTED pool.

**Membership (pool_members.status):** HELD → ACTIVE; HELD → REJECTED / RELEASED; ACTIVE → ENDED (end_reason: COMPLETED, CANCELLED, NO_SHOW, POOL_CANCELLED). Seats count while HELD or ACTIVE.

**Driver availability:** `vehicles.is_online` (changed under the vehicle lock, G10).

### B8 tables (approved 2026-09-28)
1. `users`: id, name, email (unique on lower(email)), password_hash, role (PASSENGER | DRIVER), created_at. One table with a role (P3.2).
2. `sessions`: id, user_id → users, token_hash (unique), expires_at, created_at.
3. `vehicles`: id, driver_id → users (unique: one vehicle per driver, P3.9), name, seat_capacity (CHECK > 0), is_online, created_at.
4. `areas`: id, name (unique), lat, lng.
5. `routes`: id, name.
6. `route_stops`: route_id → routes, stop_index, area_id → areas; PK (route_id, stop_index); unique (route_id, area_id). Direction is derived from index order.
7. `ride_requests`: id, passenger_id → users, pickup_area_id → areas, dropoff_area_id → areas, seats (CHECK ≥ 1), ride_type (SHARED | SOLO), status, idempotency_key, shared_estimate_paisa, solo_estimate_paisa, expires_at, created_at, updated_at. CHECK pickup ≠ dropoff; unique (passenger_id, idempotency_key); partial unique (passenger_id) WHERE status IN (REQUESTED, HELD, MATCHED, IN_PROGRESS); index (status, created_at).
8. `pools`: id, vehicle_id → vehicles, route_id → routes, direction (FORWARD | REVERSE), is_shared, status, seat_capacity, seats_taken, current_stop_index, created_at, started_at, ended_at. CHECK seats_taken BETWEEN 0 AND seat_capacity; partial unique (vehicle_id) WHERE status IN (ACCEPTED, DRIVER_ARRIVED, STARTED).
9. `pool_members`: id, pool_id → pools, ride_request_id → ride_requests, seats, status, end_reason, fare_paisa (locked at ACTIVE), pickup_stop_index, dropoff_stop_index, hold_expires_at, created_at, updated_at. Partial unique (ride_request_id) WHERE status IN (HELD, ACTIVE); index (pool_id, status).
10. `ride_request_events`: id, ride_request_id → ride_requests, pool_id → pools (nullable), from_status, to_status, actor_user_id → users (nullable = system), reason, created_at.
11. `pool_events`: id, pool_id → pools, from_status, to_status, actor_user_id (nullable), reason, created_at.
- History uses two event tables with real foreign keys instead of one polymorphic table (a polymorphic `entity_id` cannot have a foreign key).
- No payments table: cash only; the fare lives on the membership. No rating table.

### Decided (2026-09-28): final batch
- [x] G11–G14, G16, G17 approved. G11 is part of idempotency (E6): look up by (passenger, idempotency key) before inserting; on any unique violation, look up by key again and return the existing ride if found.
- [x] G15 rejected, and the fare model is simplified: the passenger chooses SHARED or SOLO, and hop counts are equal on every route containing a pickup/dropoff pair, so the fare depends only on the request. **The fare is calculated and locked once when the request is created** and stored on `ride_requests.fare_paisa`. The estimate is the final fare. B8 update: `ride_requests.fare_paisa` replaces `shared_estimate_paisa` / `solo_estimate_paisa`; `pool_members.fare_paisa` is removed.
- [x] New validation: a request is rejected if no route contains both its pickup and dropoff ("no route between these areas").
- [x] Solo/shared: the passenger chooses; SHARED keeps the discount even if nobody joins.
- [x] E1 request expiry: 5 minutes (`REQUEST_EXPIRY_MINUTES`).
- [x] B9 privacy, B10 security baseline, B11 + Tier update (Tier 1 now includes C and E4; Tier 2 order: E1, Y hold, E7), P10.5 branch plan, P9.2, P9.3, P10.4, P12.1, P12.4, P12.5, PD.2–PD.8, hello-world deploy inside `feature/project-setup`: all approved as proposed in chat.

### Project setup (2026-09-28)
- [x] Node 24 LTS, npm, official CLIs (`nest new`, `create-next-app`), PostgreSQL 17, Prisma installed with no models (tables arrive with their features).
- [x] **B5 revised: Vitest + Supertest instead of Jest; oxlint instead of ESLint for the API.** The original reason for Jest was "the NestJS default", and NestJS 12's CLI now scaffolds Vitest and oxlint, so the same reason now points the other way. Vitest keeps a Jest-compatible API, runs TypeScript without an extra transform, and is faster.

### D-002 update (2026-09-28): auto-merge on green CI
- [x] Manual merge replaced by GitHub auto-merge (his call). Each PR gets auto-merge enabled with the merge-commit method once it is ready; it merges by itself when the required checks `api`, `web` and `docker` pass and the branch is up to date with master. Squash and rebase stay disabled. Auto-merge is enabled by the account owner (not by a bot token), so merges stay attributed to Istiak Ahmed and the master push still triggers CI.


---

## D-003: Adopt zones, matching and fare rules from docs/assumptions.md (2026-09-29)

**Context:** With the deadline close, the route-based geography, en-route joins (option C), per-passenger states and passenger-chosen ride types would take too long to build and test. `docs/assumptions.md` describes a simpler model that still meets every PRD requirement and keeps fares hand-checkable.

**Decision (his call on both open points):**
- Geography: 14 fixed zones and a symmetric whole-kilometre distance table.
- Matching: M1–M4 (same pickup zone, open pool, free seats, detour ≤ 2 km for every member, drop-offs nearest first).
- Joining: auto-join into the oldest compatible open pool; drivers can also accept compatible waiting requests (option (a)).
- Fare: (৳30 + km × ৳15) × seats; 20% pool discount only if 2+ passengers are in the pool at STARTED; the estimate shown at request time is the solo fare; the final fare is locked at STARTED (option (a)).
- Status: one shared state set for pools and requests.

**Fare, worked cases (asked 2026-09-29; superseded by D-008, which locks fares at drop-off):**
- Formula: `(৳30 + km × ৳15) × seats`, in integer paisa. Every subtotal is a multiple of 500 paisa, so 20% is always whole taka. Payment is cash.
- The discount counts passengers, not seats: one passenger booking 2 seats alone is not sharing and pays full.
- **First alone, second joins later (before the start):** both get −20%. The first passenger's fare is not fixed when they book; it is locked only when the driver presses Start. Nusrat books first (estimate ৳75), Rafiq joins, the trip starts with 2 passengers → Nusrat ৳60, Rafiq ৳72.
- **Second joins, then cancels before the start:** only 1 passenger at the start → the first pays ৳75, which is the estimate.
- **After Arrive or Start:** nobody can join (joins need the pool in MATCHED), so a fare can never change once locked.
- **Why lock at the start, not at booking:** the discount pays for real sharing, and only at the start is it known who is actually riding. The estimate is the solo fare, so the price can only go down, never up; passengers are never surprised by a higher fare. This replaces Fare A (locked at request).
- Code: `fares/fare.ts` (`soloFarePaisa`, `finalFarePaisa`), locked in `TripService` on start; tested in `fare.spec.ts` and `test/trip.e2e-spec.ts` (৳60 / ৳72 pooled, ৳75 alone, ৳75 when Rafiq cancels before the start).

**Superseded:** routes and hops (B1), option C, option Y and driver confirmation of every join, SHARED/SOLO ride types (P3.12 revision), Fare A (locked at request), per-passenger IN_PROGRESS and drop-off (E4).

**Consequences:** Less code and fewer states; the PRD's last-seat race happens at auto-join time and is still protected by the vehicle lock and CHECK constraint. Deferred items are documented as next improvements.


## D-004: Pooling implementation notes (2026-09-29)
- The distance table is loaded **before** taking the vehicle lock. Inside the lock only the transaction is used. The race test first failed with 503s because the lock holder waited for a second pool connection that the waiting transactions were holding (the G7/G8 trap in practice).
- Auto-join is best effort: if the vehicle is busy (lock timeout), the ride stays REQUESTED and is shown to drivers instead of returning an error for a ride that was already created.
- The distance table is read fresh each time (182 rows) rather than cached in memory, so re-seeding zones can never leave a stale copy.
- History uses one `ride_events` table (with an optional `pool_id`), not separate request/pool event tables: every driver action is recorded per passenger, which is what "explain what happened to my ride" needs.


## D-005: Web app (2026-09-29)
- Client components with TanStack Query: every screen polls its data every 3 s (`refetchInterval`), and loading, error and empty states come from the query state. No WebSockets (see docs/assumptions.md §9).
- All requests go to `/api/...` on the web app's own origin (Next.js rewrite), so the session cookie is first-party.
- One small set of UI pieces (`components/ui.tsx`: Card, Button, StatusBadge, Loading, ErrorNote, EmptyState) keeps every screen consistent. Neutral palette, one accent per status.
- The API decides everything (fares, whether a request can be accepted and why); the web app only shows it. Types are duplicated in `web/src/lib/types.ts` instead of a shared package (no monorepo tooling, B6).
- Login page offers the seeded story cast as one-click demo accounts.


## D-006: Documentation synced with the implementation (2026-09-29)
- `docs/system-overview` and `docs/ride-flow` (PDF + SVG) regenerated for the final design: 9 tables, zones and distances, the shared status set, M1–M4 matching, auto-join, fares locked at start. Planned-but-deferred items (seat hold, expiry, no-show, en-route joins) were removed from the diagrams and are listed as next improvements.
- `docs/architecture.md` updated (module list, lock rules including "load outside data before the lock", request lifecycle, fare, deployment). `docs/assumptions.md` payment wording corrected (cash paid on completion; no separate paid flag).


## D-007: Live updates by polling every 3 seconds (2026-09-29)

**Decision:** Screens poll the API: the passenger's current ride and the driver's waiting requests and trip every 3 s; histories every 10 s. Any action (accept, start, cancel) updates the screen immediately without waiting for the next poll.

**Why 3 s and not 1 s:** 1 s would triple the load (a driver screen makes 2 requests per poll: 120 vs 40 per minute) for a difference nobody notices in a ride app, where the vehicle takes minutes to arrive. Free tiers are tight: Render's small CPU, Neon's limited compute hours (constant queries keep it from sleeping) and a 5-connection pool. Correctness never depends on freshness: every accept, join and start is re-checked under the vehicle lock, so a stale screen can only lead to a clear "already taken" error, never to overbooking.

**At larger scale (next improvements):**
- **Adaptive polling:** poll faster while a trip is active (e.g. 1–2 s) and slower when idle (10–30 s), and pause in background tabs.
- **Server push with WebSockets or Server-Sent Events (SSE):** the server sends changes as they happen (ride matched, driver arrived, fares locked). With 10,000 drivers polling every 3 s the API would serve about 6,700 requests per second that mostly say "nothing changed"; push sends only real changes. It needs a connection layer that scales horizontally (sticky sessions or a shared pub/sub between API instances), which is why it is not in the MVP.

## D-008: En-route pooling on fixed routes (2026-09-29)

**Context:** D-003 cut routes and en-route joins to meet the deadline, which left a Tesla closed to new passengers once its trip began. Picking people up along the way, stop by stop, until the seats are full is the product's main idea (his call: "this is my project's USP"), so it was brought back and built properly.

**Decision (his calls on all four open points):**
- **Routes:** three fixed lines driven both ways, six routes with ordered stops (`routes`, `route_stops`), seeded; every zone is on a route. A trip needs a route that passes the pickup and then the destination (`400 NO_ROUTE` otherwise). Zones and the km table stay.
- **Who picks the route:** the driver, before going online; it can change only between trips. Rejected: the system picking a route at the first accept (hidden tie-breaks, and a tie could stop Rafiq from joining).
- **Matching R1–R4:** on the pool's route in its direction, the car has not passed the pickup (`pickup_stop ≥ current_stop`), seats free, pool active with the driver online. Replaces M1–M4 (same pickup zone, detour ≤ 2 km); a fixed route makes the detour rule unnecessary.
- **Trip, stop by stop:** arrive → picked up / drop off / no-show → leave for the next stop. A pool closes by itself when the last passenger leaves. Passengers cancel until picked up; the driver cancels only before the first pickup.
- **Fare:** still `(৳30 + direct km × ৳15) × seats`, so nobody pays for the route's detour. −20% if another passenger rode with you on at least one hop, locked at drop-off. Rejected: a discount for anyone in the same pool (unfair to someone who never sat with another rider); a per-hop fare (all fare numbers and tests change).
- **Seats:** `seats_taken` counts everyone not yet dropped off and is freed at drop-off. Simple and always safe; it can refuse a join that would actually fit later on the route (segment-by-segment capacity is a next improvement).

**Concurrency:** every action still runs inside the vehicle lock. The new race, "the car leaves Mohakhali" vs "Shirin joins at Mohakhali", is serialised by it: either Shirin gets in first and the car must wait for her, or the car leaves first and Mohakhali is behind it. The conditional seat update also checks `current_stop ≤ pickup_stop`, and new CHECKs keep `pickup_stop < dropoff_stop`. Tested in `test/pooling.e2e-spec.ts`.

**Consequences:** a new migration (`add_routes_and_en_route_pooling`; required columns, so it needs a database without old pools); `detour.ts` replaced by `route-plan.ts`; new driver endpoints (`/driver/route`, `/driver/pool/depart`, `/driver/pool/passengers/:rideId/pickup|dropoff|no-show`; `start` and `complete` removed); the web app shows the route with the car on it for both roles. Docs and all four diagrams updated.

## D-009: Route suggestion, and no seat hold (2026-09-29)

**Route choice (his call: hybrid).** Options: (a) the driver picks freely; (b) the system assigns from the driver's location; (c) the system suggests, the driver confirms.
- **Picked (c).** The vehicle keeps `current_zone`: the driver sets it once before the first trip, then every Arrive updates it. `rankRoutes()` counts, for each route, the waiting requests it could still serve from that zone (pickup at or after the car), puts routes through the car's zone first, and the best one is shown as **Suggested** with one tap. The driver can still choose another.
- **Why not (b) now:** there is no live GPS (out of scope in the PRD), so "location" is what the driver says; forcing a route needs an accept/decline step and rebalancing rules (new states, new races). (c) gives the benefit, sending the car where riders are waiting, with none of that.
- **Race safety:** route and location changes run inside the vehicle lock and are refused during a trip, as before.
- **At scale:** automatic dispatch from GPS pings and a demand heatmap, with the driver accepting the assignment.

**Seat hold (option Y) rejected (his question: hold vs direct assignment).**
- A fitting request takes its seat at once (auto-join) or when the driver accepts a waiting one. The driver does not confirm each join.
- **Why:** in en-route pooling the driver is driving between stops; asking them to confirm every join within 60 s is unsafe and slow, and the rider waits without knowing. Holds would also bring back a HELD state, expiry clean-up under the lock and races B3/C1-with-holds.
- **Driver control that remains:** choosing the route (with the suggestion), accepting waiting requests, marking no-shows, cancelling before the first pickup, going offline between trips. A "pause new joins" switch is a next improvement if drivers ask for it.
