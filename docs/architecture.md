# Architecture

Dhaka Tesla Pool is a ride-pooling MVP: passengers request rides, drivers accept them, and several
passengers can share one vehicle without ever exceeding its seats.

## System overview

Final architecture (hand-drawn style): [`final_architecture_design.pdf`](final_architecture_design.pdf) ([PNG](final_architecture_design.png)).
Full layered diagram with the numbered happy path: [`architecture-diagram.pdf`](architecture-diagram.pdf) (also [PNG](architecture-diagram.png) and [SVG](architecture-diagram.svg)).

```mermaid
flowchart LR
    B[Browser] -->|HTTPS, same origin| W[Next.js web app<br/>App Router · TanStack Query]
    W -->|/api/* rewrite proxy<br/>forwards session cookie| A[NestJS API<br/>REST · Prisma]
    A -->|SQL over TCP<br/>transactions + row locks| D[(PostgreSQL)]
```

| Component | Responsibility |
|---|---|
| **Browser** | Renders the UI; holds the session cookie (httpOnly, never readable by JavaScript). |
| **Next.js web** | Passenger and driver screens; polls the API for live status; proxies `/api/*` to the API so the browser only ever talks to one origin. |
| **NestJS API** | Authentication, validation, business rules, ride and pool state transitions, capacity enforcement, logging. |
| **PostgreSQL** | Source of truth; enforces invariants with CHECK constraints, partial unique indexes and row locks. |

**Why a same-origin proxy:** in production the web app and the API run on different hosts. Browsers
increasingly block cross-site cookies, so Next.js rewrites `/api/*` to the API. The session cookie stays
first-party and no CORS configuration is needed.

**Deliberately not included:** microservices, message queues, Redis, WebSockets. PostgreSQL row locks
and constraints solve the MVP's consistency problems; polling every 3 s is enough for live status.
At scale, adaptive polling and then WebSockets or SSE would replace it (decisions.md D-007). What changes at larger scale is
covered in the scaling notes (planned: `docs/scaling.md`).

## API layers

```mermaid
flowchart TB
    C[Controller<br/>HTTP only: routes, DTO validation, status codes] --> S[Service<br/>business rules, state transitions, fare, matching]
    S --> R[Repository<br/>Prisma queries, transactions, vehicle lock]
    R --> DB[(PostgreSQL)]
    G[Guards<br/>session auth · role check] -.-> C
```

- **Controller** knows HTTP. It maps domain errors to status codes.
- **Service** knows the rules and never imports HTTP types. It raises domain errors such as `SeatsUnavailable` or `InvalidTransition`.
- **Repository** is the only layer that talks to the database. `withVehicleLock(vehicleId, fn)` is the only way to change pools and memberships.
- A lower layer never imports an upper one.

Modules: `health`, `auth` + `users` (sessions, guards), `geography` (zones, distances), `rides` (passenger endpoints, `PoolingService`, `RidesRepository` with the vehicle lock), `driver` (driver endpoints, `TripService`). Pure rules live in `fares/fare.ts` and `pooling/detour.ts`.

## Consistency model: "one vehicle = one line"

Every operation that changes a vehicle's seats or its pool runs in one database transaction that
starts by locking the vehicle row.

```mermaid
sequenceDiagram
    participant R as Rafiq (join)
    participant S as Shirin (join)
    participant DB as PostgreSQL
    R->>DB: BEGIN; SELECT vehicle FOR UPDATE
    S->>DB: BEGIN; SELECT vehicle FOR UPDATE
    Note over S,DB: waits for Rafiq's lock
    R->>DB: re-read pool; check M1–M4 (1 seat free)
    R->>DB: UPDATE pools SET seats_taken += seats WHERE status = MATCHED AND room left
    R->>DB: INSERT pool_member, INSERT event; COMMIT
    DB-->>S: lock granted
    S->>DB: check seats (0 free) → SeatsUnavailable
    S->>DB: ROLLBACK
```

Inside the lock, every time: re-read the pool and the request → check M1–M4 (same pickup zone, pool
still MATCHED, seats free, every detour ≤ 2 km) → decide → write the change and its history event
together. Anything the check needs from outside the transaction (the distance table) is loaded
**before** the lock, so the lock holder never waits for a second database connection.

Guarantees enforced by the database, independent of application code:

| Invariant | Enforcement |
|---|---|
| Seats never exceed capacity | `CHECK (seats_taken BETWEEN 0 AND seat_capacity)` on `pools` |
| One active pool per vehicle | partial unique index on `pools(vehicle_id)` |
| One active request per passenger | partial unique index on `ride_requests(passenger_id)` |
| No duplicate booking on retry | unique `ride_requests(passenger_id, idempotency_key)` |
| No join once the driver has arrived | conditional seat update requires `status = MATCHED` |
| A request is in at most one pool | partial unique index on `pool_members(ride_request_id) WHERE left_at IS NULL` |

Transactions use READ COMMITTED with a `lock_timeout`, stay short, and make no network calls
while holding a lock.

## Request lifecycle (happy path)

```mermaid
sequenceDiagram
    participant N as Nusrat
    participant W as Web
    participant A as API
    participant J as Jashim
    N->>W: request Banani → Mohakhali, 1 seat
    W->>A: POST /rides
    A-->>W: REQUESTED, estimate ৳75 (solo fare)
    J->>A: GET /driver/requests (polling)
    J->>A: POST /driver/requests/:id/accept
    A-->>J: pool MATCHED at Banani, 1/3 seats
    Note over A: Rafiq (Banani → Gulshan 1) auto-joins: detour 2 km ≤ 2 km
    J->>A: arrive → start (fares locked) → complete
    A-->>N: MATCHED → DRIVER_ARRIVED → STARTED → COMPLETED (pay ৳60 cash)
```

## Geography and fare

- 14 fixed Dhaka zones and a whole-kilometre distance table (seeded), not an external map API (docs/assumptions.md §3).
- Fare = (৳30 + km × ৳15) × seats, minus 20% if the pool has 2+ passengers when the trip starts. The solo fare is shown as the estimate and is never exceeded; the final fare is locked at start. Stored in integer paisa.

## Deployment

```mermaid
flowchart LR
    U[User] --> V[Vercel<br/>Next.js]
    V -->|/api/* rewrite| RN[Render<br/>NestJS container]
    RN --> NE[(Neon<br/>PostgreSQL)]
```

All free tiers. The API container runs `prisma migrate deploy` and the idempotent seed before starting.
Locally, `docker compose up` runs web, API and PostgreSQL (plus a test database with `--profile test`).
