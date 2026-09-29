# Dhaka Tesla Pool

Share a seat. Split the fare. Survive Dhaka traffic.

A ride-pooling MVP: passengers request rides, drivers accept them, and several passengers can share one
vehicle without ever exceeding its seats. Built around the PRD's cast: driver **Jashim** and his
three-seat **Bullet**, and passengers **Nusrat**, **Rafiq** and **Shirin**.

> **Status:** MVP complete. En-route pooling on fixed routes, the stop-by-stop trip, fares and the
> driver/platform money split, with 55 unit and 40 end-to-end tests.

---

## Problem statement

Nusrat (Banani → Mohakhali) and Rafiq (Banani → Gulshan 1) book overlapping but not identical trips a
few minutes apart. The system must decide quickly whether they can share Bullet, give each passenger an
individual fair fare, never let occupied seats exceed three (even when Nusrat and Shirin claim the last
seat at the same instant), show the driver who is riding and at which stage, and keep enough history to
explain afterwards exactly what happened.

## Features implemented

- Passenger sign-up, login and logout with server-side sessions in an httpOnly cookie
- Role-based access (passenger / driver) and rate-limited sign-up and login
- **En-route pooling on fixed routes:** 14 Dhaka zones on six routes (three lines, both directions). A Tesla already on its way picks up anyone waiting at a stop ahead until its seats are full
- Fare and route rules as pure, unit-tested functions with the PRD examples
- Seed data with the story cast (Jashim the driver, Nusrat, Rafiq, Shirin)
- Health endpoint with a real database check (`GET /health`)
- Structured JSON logging with a request id per request
- Environment validation at startup (the app refuses to start with bad config)
- Same-origin `/api` proxy from the web app to the API
- One-command local run with Docker Compose, plus CI on every pull request
- Ride requests with a solo fare estimate, only for trips a route serves; automatic join into the oldest Tesla that has not passed the pickup
- Drivers get a **suggested route** from where the car is and where riders are waiting (one tap to take it, or pick another), go online, see waiting requests (with the reason if they cannot take one, e.g. "The car has already passed Banani") and accept them
- Seat capacity protected against concurrent requests (vehicle row lock + database CHECK), tested with twenty riders racing for the last seat, and "the car leaves a stop" vs "a passenger joins at that stop" tested as a race
- Trip driven stop by stop: arrive → picked up / drop off / no-show → leave for the next stop. Each passenger gets on and off at their own stop; seats are freed at drop-off
- Fares locked at drop-off: 20% off if another passenger shared at least one hop
- Driver earnings by the work (৳10/km carried + ৳20/pickup), platform fee = the rest; shown per trip to the driver, never negative for anyone
- Passenger cancellation until pickup; the driver can cancel before the first pickup (passengers go back to waiting); an empty trip closes itself
- Invalid transitions rejected with 409; every passenger status change recorded in the ride history
- Web app for passengers and drivers: the route drawn with the car on it, live status (polling every 3 s), loading / error / empty states, demo-account buttons on the login page

## Screenshots

| Login with demo accounts | Shirin joins Bullet on the way, at Mohakhali |
|---|---|
| ![Login](docs/screenshots/login.png) | ![Passenger matched](docs/screenshots/passenger-matched.png) |

| Jashim at Mohakhali: Nusrat gets off, Shirin gets on | Nusrat paid ৳60 for sharing a hop |
|---|---|
| ![Driver pool](docs/screenshots/driver-pool.png) | ![Fare locked](docs/screenshots/passenger-fare-locked.png) |

| Suggested route from where the car is | After the trip: Jashim earned ৳180 of ৳240 |
|---|---|
| ![Route suggestion](docs/screenshots/driver-route-suggestion.png) | ![Driver earnings](docs/screenshots/driver-earnings.png) |

## Architecture

![Final architecture](docs/final_architecture_design.png)

- Final architecture: [`docs/final_architecture_design.pdf`](docs/final_architecture_design.pdf)
- Layered architecture with the numbered happy path: [`docs/architecture-diagram.pdf`](docs/architecture-diagram.pdf)
- System overview (request path, ERD, lifecycles): [`docs/system-overview.pdf`](docs/system-overview.pdf)
- One ride end to end: [`docs/ride-flow.pdf`](docs/ride-flow.pdf)

```mermaid
flowchart LR
    B["Browser<br/>passenger and driver screens"] -->|"HTTPS · session cookie"| W["Next.js on Vercel<br/>pages · TanStack Query · /api/* proxy"]
    W -->|"same origin, no CORS"| A["NestJS API on Render<br/>controller → service → repository"]
    A -->|"transactions · SELECT … FOR UPDATE"| D[("PostgreSQL on Neon<br/>CHECK constraints · partial unique indexes")]
    W -. "polls every 3 s" .-> A
```

### Data model (ERD)

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : "logs in with"
    USERS ||--o| VEHICLES : "drives"
    USERS ||--o{ RIDE_REQUESTS : "requests"
    ZONES ||--o{ ZONE_DISTANCES : "km between"
    ROUTES ||--|{ ROUTE_STOPS : "stops in order"
    ZONES ||--o{ ROUTE_STOPS : "is a stop of"
    ROUTES ||--o{ VEHICLES : "chosen by"
    VEHICLES ||--o{ POOLS : "runs"
    ROUTES ||--o{ POOLS : "followed by"
    POOLS ||--o{ POOL_MEMBERS : "carries"
    RIDE_REQUESTS ||--o{ POOL_MEMBERS : "holds a seat as"
    RIDE_REQUESTS ||--o{ RIDE_EVENTS : "history"
    ZONES ||--o{ RIDE_REQUESTS : "pickup / drop-off"

    VEHICLES {
        uuid id PK
        int seat_capacity "CHECK > 0"
        bool is_online
        uuid route_id FK
        uuid current_zone_id FK
    }
    POOLS {
        uuid id PK
        uuid vehicle_id FK "one active per vehicle"
        int current_stop "where the car is"
        enum status
        int seats_taken "CHECK <= seat_capacity"
        int collected_paisa "= driver + platform"
        int driver_earnings_paisa
        int platform_fee_paisa
    }
    RIDE_REQUESTS {
        uuid id PK
        uuid passenger_id FK "one active per passenger"
        int seats "CHECK 1..3"
        enum status
        int distance_km "direct"
        int estimated_fare_paisa "solo, the maximum"
        int final_fare_paisa "locked at drop-off"
    }
    POOL_MEMBERS {
        uuid pool_id FK
        uuid ride_request_id FK "one active seat per ride"
        int pickup_stop "CHECK < dropoff_stop"
        int dropoff_stop
        timestamptz left_at
    }
    ROUTE_STOPS {
        uuid route_id PK
        int position PK
        uuid zone_id FK
        int km_from_start
    }
```

All columns, constraints and lifecycles: [`docs/system-overview.pdf`](docs/system-overview.pdf).

### Tables

| Table | What it holds | Key constraints and indexes |
|---|---|---|
| `users` | Passengers and drivers, one role each | `email` unique, `CHECK email = lower(email)`; `role` is an enum |
| `sessions` | One row per login: the SHA-256 hash of the cookie token and its expiry | `token_hash` unique; index on `user_id`; deleted at logout |
| `zones` | The 14 Dhaka zones | `code` and `name` unique |
| `zone_distances` | Direct km between every ordered pair of zones (182 rows); sets the fare | primary key (from, to); `CHECK km > 0`, `CHECK from <> to` |
| `routes` | The six fixed routes (each direction on its own) | `code` and `name` unique |
| `route_stops` | The zones of a route in driving order, with km from the first stop | primary key (route, position); unique (route, zone); `CHECK position ≥ 0`, `CHECK km_from_start ≥ 0` |
| `vehicles` | Each driver's car: seats, online, chosen route, current zone. **Its row is the lock** for every seat change | `driver_id` unique (one car per driver); `CHECK seat_capacity > 0` |
| `pools` | One trip of a car along its route: where it is (`status` + `current_stop`), seats taken, and the money split once completed | `CHECK seats_taken BETWEEN 0 AND seat_capacity`; **one active pool per vehicle** (partial unique index); `CHECK collected = driver + platform`; index on (status, route) for finding joinable trips |
| `pool_members` | A ride's seats in a pool, from its pickup stop to its drop-off stop | **one active seat per ride** (partial unique on `left_at IS NULL`); `CHECK pickup_stop < dropoff_stop`; index on `pool_id` |
| `ride_requests` | A passenger's trip: zones, seats, status, direct km, solo estimate and final fare | **one active ride per passenger** (partial unique); `CHECK seats 1..3`, `CHECK pickup <> drop-off`, `CHECK fares ≥ 0`; indexes on (status, created) for the waiting list and (passenger, created) for history |
| `ride_events` | The audit trail: every status change with from, to, actor, reason and time | index on (ride, created); the actor is null for the system |

Money is integer paisa everywhere, times are `timestamptz` (UTC, shown in Dhaka time), and ids are UUIDs. Payment is cash, so there is no payments table: each completed pool records what was collected and how it splits. Ratings are out of scope.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query |
| Backend | NestJS 12 (REST), TypeScript |
| Database | PostgreSQL (17 in Docker, Neon in production), Prisma 7 (migrations, typed client) |
| Validation | class-validator / class-transformer |
| Logging | pino (nestjs-pino) |
| Tests | Vitest + Supertest, integration tests against real PostgreSQL |
| Tooling | Docker Compose, GitHub Actions |

### Why these choices

| Choice | Alternatives considered | Why it fits ride-pooling | When we would switch |
|---|---|---|---|
| **REST** | GraphQL, tRPC | Few resources and screens with fixed shapes; business rules map cleanly to HTTP status codes (409 for a lost seat, 403 for someone else's ride); simple to test with Supertest and to cache | GraphQL when several clients (mobile apps, partners) need different shapes of the same data and over-fetching becomes a real cost |
| **NestJS** | Fastify, Express | Modules, controllers, services and guards enforce the layered architecture and keep auth checks in one place | For a single hot path, run Nest on its Fastify adapter; plain Fastify for a tiny service |
| **PostgreSQL** | MongoDB, MySQL | Row locks, CHECK constraints and partial unique indexes make seat safety a database guarantee, not only a code promise | Never for the core; at scale add read replicas and split by city area |
| **Prisma** | Drizzle, TypeORM, raw SQL | Typed queries for the pool, member and ride joins, and versioned migrations where the seat CHECKs and partial unique indexes are written by hand; raw SQL only for `SELECT … FOR UPDATE` | If most queries became hand-tuned SQL, a query builder (Drizzle, Kysely) |
| **Database sessions** | JWT | An httpOnly cookie through the same-origin proxy, revocable at logout, no token handling in the browser | Short-lived JWTs when many services must verify users without a database call, or for native mobile apps |
| **Next.js + TanStack Query** | React SPA (Vite), server-rendered pages | The `/api` rewrite gives a first-party cookie with no CORS; TanStack Query gives polling, loading and error states | A native app when drivers need background location |
| **Polling every 3 s** | WebSockets, SSE | Simple, works on free hosting; correctness never depends on it because every action is re-checked under the lock | Adaptive polling, then SSE or WebSockets with pub/sub as screens grow |
| **Vitest + Supertest on a real PostgreSQL** | Jest, mocked database | Race conditions and constraints can only be proven against the real database | Not planned |
| **Tailwind CSS** (styling) | CSS Modules, a component library (MUI, shadcn/ui) | Two small screens with clear states (loading, error, empty, the route line) built fast and consistently, with no design-system weight | A component library once there are many screens, forms and a design team |
| **class-validator DTOs** (validation) | Zod, Joi | Built into NestJS's `ValidationPipe`: every request body is checked and unknown fields are rejected before a service sees it | Zod if the web and API shared schemas in one monorepo |
| **pino** (logging) | Winston, console | Structured JSON with one request id per request, so a race or a failed booking can be traced across lines; session cookies are redacted | A log platform (Loki, Datadog) and metrics once there is real traffic |
| **bcryptjs + throttler** (password, rate limit) | argon2, a gateway rate limit | Pure JavaScript (no native build in Docker); 5 login or sign-up attempts per minute per IP stops guessing | argon2id and a gateway or Redis-backed rate limit when running several API instances |
| **Free tiers: Vercel, Render, Neon** | Koyeb, Fly.io, Supabase | Free and public; Render runs the same Docker image as local, and Neon is real PostgreSQL, so the row lock and constraints behave in production exactly as in the tests | Paid plans to remove cold starts |


## Project structure

```
.
├── api/                  NestJS API
│   ├── prisma/           schema and migrations
│   ├── src/
│   │   ├── auth/         sign-up, login, sessions, guards (session, role)
│   │   ├── users/        users repository
│   │   ├── geography/    zones, distances, routes, destinations (+ the seed data)
│   │   ├── rides/        passenger rides, PoolingService, the vehicle lock (RidesRepository)
│   │   ├── driver/       DriverService (route, online, accept, suggestions), TripService (stop by stop)
│   │   ├── pooling/      pure rules: route-plan.ts (R1–R4, sharing), route-suggestion.ts
│   │   ├── fares/        pure rules: fare.ts (passenger fare), earnings.ts (driver / platform split)
│   │   ├── seed/         zones, routes and the story cast
│   │   ├── config/       environment validation, logger setup
│   │   ├── database/     PrismaService (the single database client)
│   │   └── health/       GET /health (controller → service → repository)
│   └── test/             end-to-end tests against PostgreSQL
├── web/                  Next.js web app (proxies /api/* to the API)
│   └── src/
│       ├── app/          pages: /login, /signup, /ride (passenger), /driver
│       ├── components/   ui.tsx (shared pieces), ride/, driver/
│       └── lib/          api client, session, types, formatting
├── docs/                 diagrams, assumptions, screenshots
├── .github/workflows/    CI
├── docker-compose.yml
└── decisions.md
```

Inside the API every feature follows the same layers: **controller** (HTTP only) → **service**
(business rules) → **repository** (the only layer that talks to the database).

## Prerequisites

- To run everything: **Docker** with Docker Compose
- To develop outside Docker: **Node.js 24** and npm

## Environment variables

No `.env` file is needed for `docker compose up`; every value has a safe local default.
Never commit real secrets. Only the `.env.example` files are committed.

| File | Used by | Variables |
|---|---|---|
| [`.env.example`](.env.example) | Docker Compose | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_HOST_PORT`, `LOG_LEVEL`, `DATABASE_POOL_MAX` |
| [`api/.env.example`](api/.env.example) | API outside Docker | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `SESSION_TTL_HOURS`, `TRUST_PROXY_HOPS` |
| [`web/.env.example`](web/.env.example) | Web outside Docker | `API_URL` |

## Run with Docker

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API (direct) | http://localhost:3001/health |
| API (through the web proxy) | http://localhost:3000/api/health |
| PostgreSQL | `localhost:5433` (user / password / db: `tesla`) |

Start order is enforced by health checks: database → API (runs migrations first) → web.
Stop with `docker compose down` (add `-v` to delete the database volume).

## Migrations and seed data

Migrations run automatically when the API container starts (`prisma migrate deploy`).
Outside Docker: `cd api && npm run prisma:deploy`.
The API container also upserts the zones, distances and story cast on start (safe to repeat).
Outside Docker: `cd api && npm run build && npm run db:seed`.

## Run without Docker

```bash
docker compose up -d db                              # only the database

cd api && cp .env.example .env && npm install
npm run prisma:deploy && npm run start:dev           # API on :3001

cd ../web && cp .env.example .env.local && npm install
npm run dev                                          # web on :3000
```

## Tests

```bash
docker compose --profile test up -d db-test          # test database on :5434

cd api
npm test                                             # unit tests
DATABASE_URL=postgresql://tesla:tesla@localhost:5434/tesla_test npm run test:e2e
```

CI runs lint, type checks, unit tests, migrations, end-to-end tests (against PostgreSQL), the web
production build and the Docker image builds on every pull request.

What the tests prove (the PRD's must-haves and the risky cases):

| Requirement | Test |
|---|---|
| The PRD case: Nusrat and Shirin claim Bullet's last seat at the same instant (exactly one wins, five rounds) | `api/test/pooling.e2e-spec.ts` |
| Capacity is never exceeded, even with 20 riders racing for Bullet's last seat | `api/test/pooling.e2e-spec.ts` |
| The database refuses over-capacity and impossible stops, even bypassing the app | `api/test/pooling.e2e-spec.ts` |
| Leaving a stop and a rider joining at that stop never both succeed | `api/test/pooling.e2e-spec.ts` |
| Invalid transitions are rejected (wrong order, wrong stop, cancel after pickup) | `api/test/trip.e2e-spec.ts` |
| Nusrat ৳60 and Rafiq ৳72 pooled, ৳75 alone, a handed-over seat is not sharing | `api/src/fares/fare.spec.ts`, `api/test/trip.e2e-spec.ts` |
| Users cannot read or change other users' rides; roles cannot use each other's endpoints | `api/test/pooling.e2e-spec.ts` |
| Cancellation rules, no-shows, the driver's trip cancel, and a cancel racing a trip cancel | `api/test/trip.e2e-spec.ts` |
| Nobody loses money on any trip any route can sell (about 25,000 cases) | `api/src/fares/earnings.spec.ts` |
| Everything together, from sign-up to the driver's earnings | `api/test/full-journey.e2e-spec.ts` |

## Demo credentials

All demo accounts use the password **`tesla1234`** (local and demo use only).

| Name | Email | Role |
|---|---|---|
| Jashim | `jashim@teslapool.test` | Driver |
| Nusrat | `nusrat@teslapool.test` | Passenger |
| Rafiq | `rafiq@teslapool.test` | Passenger |
| Shirin | `shirin@teslapool.test` | Passenger |

## Deployment

**Live demo:** **https://tesla-pool-one.vercel.app** (log in with a demo account below). API: `https://tesla-pool-api.onrender.com/health`.

Free tiers: after 15 idle minutes the API sleeps, so the first request can take 30 to 60 seconds. Open the health link once to wake it before a demo.

| Part | Service | Settings |
|---|---|---|
| Database | **Neon** (PostgreSQL, free) | Use the direct connection string with `sslmode=require` |
| API | **Render** web service (Docker, free) | Root `api`, health check `/health`; env `NODE_ENV=production`, `DATABASE_URL` (Neon), `DATABASE_POOL_MAX=5`, `LOG_LEVEL=info`, `TRUST_PROXY_HOPS=2` |
| Web | **Vercel** (Next.js, free) | Root `web`; env `API_URL=https://<your-api>.onrender.com` |

On every start the API container runs `prisma migrate deploy`, then the idempotent seed, then the server, so a fresh Neon database is ready with no manual step.

**If free hosting is not available:** the same stack deploys on any machine with Docker. Copy `.env.example` to `.env`, set a strong `POSTGRES_PASSWORD`, and run `docker compose up -d --build`. Compose starts PostgreSQL, the API (which migrates and seeds itself) and the web app in order, gated by health checks. The browser only talks to Vercel; the `/api/*` rewrite forwards to Render, so the session cookie stays first-party (Secure in production) and no CORS is needed.

## API overview

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `200 {"status":"ok","database":"up"}` or `503` when the database is unreachable |
| POST | `/auth/signup` | Create a passenger account and log in (sets the session cookie) |
| POST | `/auth/login` | Log in with email and password (sets the session cookie); 5 attempts per minute (sign-up too) |
| POST | `/auth/logout` | End the session and clear the cookie |
| GET | `/auth/me` | The logged-in user |
| GET | `/zones` | The 14 zones for pickup and destination |
| GET | `/routes` | The six routes with their stops in driving order |
| GET | `/zones/:id/destinations` | Where a passenger can ride from this pickup (routes that are not too far round) |
| POST | `/rides` | Passenger: request a ride `{pickupZoneId, dropoffZoneId, seats}`; `400 NO_ROUTE` if no route serves it; joins a Tesla on the way at once if one fits |
| GET | `/rides/current` | Passenger: the active ride (driver, route with the car's position, co-riders' first names, fare, history) |
| GET | `/rides` | Passenger: ride history |
| GET | `/rides/:id` | Passenger: one of my rides (403 for someone else's) |
| POST | `/rides/:id/cancel` | Passenger: cancel until picked up |
| GET | `/driver/routes` | Driver: every route ranked from the car's zone, with riders waiting ahead and the suggested one |
| POST | `/driver/location` | Driver: where the car is `{zoneId}` (before a trip; stops update it after that) |
| POST | `/driver/route` | Driver: choose the route `{routeId}` (only between trips) |
| POST | `/driver/online`, `/driver/offline` | Driver: availability (a route is required; offline refused during a trip) |
| GET | `/driver/requests` | Driver: waiting requests with `canAccept` and a reason |
| POST | `/driver/requests/:id/accept` | Driver: accept (starts a trip on the route, or adds to the current one) |
| GET | `/driver/pool` | Driver: vehicle, route and current trip with its stops and passengers |
| GET | `/driver/trips` | Driver: past trips with passengers, cash collected, driver earnings and platform fee |
| POST | `/driver/pool/arrive`, `/driver/pool/depart` | Driver: arrive at the current stop; leave for the next one (409 while someone still waits here) |
| POST | `/driver/pool/passengers/:rideId/pickup`, `/dropoff`, `/no-show` | Driver: one passenger at this stop; drop-off locks their fare |
| POST | `/driver/pool/cancel` | Driver: cancel before the first pickup; passengers return to waiting |

Business errors return `{ statusCode, code, message }`, e.g. `409 SEATS_UNAVAILABLE`, `403 NOT_YOUR_RIDE`.

Through the web app every path is prefixed with `/api` (e.g. `/api/auth/login`).

### Errors

Services never mention HTTP: they throw a business error with a code, and one filter turns it into `{ statusCode, code, message }`.

| Status | When |
|---|---|
| `400` | Invalid input (DTO validation, unknown fields), `INVALID_ZONE`, `NO_ROUTE` |
| `401` | No valid session cookie, or wrong email/password |
| `403` | Wrong role for the route, `NOT_YOUR_RIDE`, `NO_VEHICLE` |
| `404` | `NOT_FOUND` (ride, route, zone, or a passenger not in this trip) |
| `409` | Business rules: `SEATS_UNAVAILABLE`, `NOT_COMPATIBLE`, `ALREADY_TAKEN`, `INVALID_TRANSITION`, `ACTIVE_RIDE_EXISTS`, `HAS_ACTIVE_POOL`, `NO_ACTIVE_POOL`, `DRIVER_OFFLINE`, `ROUTE_REQUIRED`, `POOL_NOT_OPEN`, or an email already registered |
| `429` | More than 5 sign-up or login attempts per minute |
| `503` | `BUSY`: the vehicle's lock was held for more than 3 s; safe to retry |

On the web, every error is shown next to the action that caused it, and a `401` from any screen (for example an expired session) sends the user back to the login page.

### Security basics

- **Passwords:** bcrypt (cost 10), at least 8 characters at sign-up; never returned by the API, and request bodies are not logged.
- **Sessions:** a random 32-byte token in an httpOnly, SameSite=Lax cookie (Secure in production), 12 h; only its SHA-256 hash is stored, so a database leak does not expose live sessions. Logout deletes the row.
- **Same origin:** the browser only talks to the web app; `/api/*` is forwarded to the API, so there is no CORS to configure.
- **Access control:** a session guard on every private route, a role guard (passenger vs driver), and an ownership check in the service (`403 NOT_YOUR_RIDE`). Co-riders see only first names, never fares.
- **Input:** a whitelisting `ValidationPipe`, UUID checks on every id in the URL, and database CHECKs as the last line.
- **Headers and limits:** helmet's security headers; 5 attempts per minute on sign-up and login, counted per real client: the first `X-Forwarded-For` address, which Vercel sets and overwrites, because counting proxy hops was not stable behind Vercel and Render (found by the live stress test, fixed in v1.0.1).
- **Secrets:** no real secrets in the repository: only `.env.example` files and the local-only Docker defaults in `docker-compose.yml`; the production database URL lives only in Render's settings. Logs redact cookies, authorization headers and `Set-Cookie`; the API refuses to start with invalid configuration.

## Fare model

`(৳30 + direct km × ৳15) × seats`, minus **20%** if another passenger rode with you on at least one hop. The fare is locked when you are dropped off. The estimate shown at request time is the solo fare, so nobody pays more than they saw, and nobody pays for the route's detour. Money is stored in integer paisa.

| Passenger | Trip | km | Estimate (solo) | Final (shared a hop) |
|---|---|---:|---:|---:|
| Nusrat | Banani → Mohakhali | 3 | ৳75 | ৳60 |
| Rafiq | Banani → Gulshan 1 | 4 | ৳90 | ৳72 |
| Shirin | Mohakhali → Bashundhara (joins on the way) | 7 | ৳135 | ৳108 |

Taking over a seat at the stop where someone else got off is not sharing: both pay their solo fare.

**Who gets the money.** The driver is paid for the work, not from the fares: **৳10 per km** with a passenger on board **+ ৳20 per pickup**. The platform keeps the rest. So a sharing discount never comes out of the driver's pocket: it is paid for by the extra passengers. For the story trip, ৳240 is collected, Jashim earns ৳180 and the platform keeps ৳60. Routes only sell trips that add at most 2 km or 40% to the direct distance, and a unit test checks every trip every route can sell, alone and in every group of up to three bookings (about 25,000 cases): the platform always keeps at least ৳10 and the driver is always paid, so nobody loses money.

### Routes and matching rules

Tesla Pool drives three fixed lines, each in both directions (six routes):

| Line | Stops |
|---|---|
| Airport Road | Uttara → Banani → Mohakhali → Gulshan 1 → Gulshan 2 → Bashundhara |
| Mirpur | Uttara → Mirpur 12 → Mirpur 11 → Mirpur 10 → Mirpur 2 → Mirpur 1 → Farmgate → Dhanmondi |
| Tejgaon | Banani → Mohakhali → Tejgaon → Farmgate → Dhanmondi |

A request joins a trip only if all four hold, checked again under the vehicle lock:

| Rule | Meaning |
|---|---|
| **R1** On the route, not too far round | The route passes the pickup, then the destination, and adds at most 2 km or 40% to the direct distance |
| **R2** Not passed | The car is at, or has not yet reached, the pickup stop |
| **R3** Seats | Free seats ≥ seats requested |
| **R4** Active | The trip is still running and the driver is online |

A new request joins the oldest trip that fits (if that car stays busy for more than 3 s, the request simply waits); otherwise it waits and drivers see it with the reason it does not fit. The driver picks a route before going online (the system suggests the one with the most riders waiting ahead) and keeps it until the trip ends. Passengers can cancel until they are picked up; the driver can cancel only before the first pickup, and then everyone goes back to waiting.

## Concurrency: Bullet's last seat

**The case:** Bullet has one seat left, and Nusrat and Shirin claim it at the same instant.

**Now: "one vehicle = one line".** Every change to a vehicle's seats or trip runs in a transaction that first locks that vehicle's row (`SELECT … FOR UPDATE`, `lock_timeout` 3 s), so two actions on the same car run one after the other, never together.
1. Both requests wait for Bullet's lock. The first one in re-checks the rules (R1–R4) on the locked data and takes the seat.
2. The second one re-checks, finds no free seat, and stays **REQUESTED**: it is not dropped, and other drivers see it.
3. Two database guards back this up even if the code had a bug: the seat update itself only succeeds if there is still room (`seats_taken ≤ capacity − n`, trip still active, car not past the pickup), and `CHECK seats_taken ≤ seat_capacity` refuses anything else. A compare-and-set on the request status means one request can never take two seats.
4. The same lock serialises the en-route case: "the car leaves Mohakhali" and "Shirin joins at Mohakhali" can never both succeed.

Tested with exactly this case (Nusrat and Shirin, five rounds), with 20 riders racing for the last seat (one wins, 19 keep waiting) and with the leave/join race. The design never deadlocks: every transaction takes a single vehicle lock, first, and a lock wait over 3 s returns `503 BUSY` instead of hanging.

**At larger scale:** the lock is per vehicle, so different cars never block each other and seat safety needs no distributed lock. What changes is everything around it: more API instances, a connection pooler, reads moved off the primary, idempotent retries and push updates. See the next section.

## Bonus: if Oi Tesla goes viral (1M passengers, 100k drivers)

**First, the numbers.** Suppose 20% of passengers ride twice a day: about 400,000 rides a day, and in the busiest hour about 60,000 rides, or ~17 seat decisions per second. PostgreSQL handles that easily. The heavy load is elsewhere: 100k drivers sending a location every 4 s is **25,000 writes/s**, and screens polling every 3 s would be **~67,000 requests/s** of mostly "no change". So the plan keeps the seat decision where it is and moves the high-volume, low-value traffic away from it.

```mermaid
flowchart LR
    P[Passenger and driver apps] -->|HTTPS| LB[Load balancer + rate limits]
    LB --> API[API instances, stateless, autoscaled]
    P <-->|SSE / WebSocket| RT[Realtime gateway]
    API -->|seat decisions, one row lock per vehicle| PG[(PostgreSQL primary, one per city area)]
    PG -->|replication| RR[(Read replicas: history, suggestions)]
    API -->|live driver positions, TTL| MEM[(In-memory store, geo index)]
    API -->|committed events| BUS[Event stream]
    BUS --> RT
    BUS --> W[Workers: notifications, fees, analytics]
```

| Topic | What we would do, and why |
|---|---|
| Load balancing, horizontal scaling | The API is already stateless (sessions are in the database), so run several instances behind a load balancer and autoscale on CPU and latency. |
| Database contention | Keep "one row lock per vehicle": contention only exists inside one car, never between cars. Keep transactions short (distances loaded before the lock, as today). |
| Indexing, read replicas | The hot queries are already indexed (`pools(status, route_id)`, `ride_requests(status, created_at)`, the partial unique indexes). Put a connection pooler (PgBouncer) in front. Serve history and suggestions from replicas; every seat decision stays on the primary. |
| Partitioning | Routes are local to a city, so partition by area: one primary per area. A trip never spans two partitions, so no cross-database transactions. |
| Caching | Cache what rarely changes (zones, routes, distances, destinations) in memory with a version key. Never cache seats or trip state: the lock decides those. |
| Geospatial search | With live GPS, store each driver's last position in an in-memory geo index (Redis GEO or H3 cells) with a short TTL, and query "cars near this pickup, on a route that passes it". PostGIS for the static route shapes. |
| Ride matching | Keep R1–R4 as the rule. Candidate search runs without a lock (as today); only the final seat is taken under the car's lock. For a very busy area, feed requests through a per-area queue so matching there runs in order. |
| Queues and events | After a commit, publish "seat taken", "arrived", "dropped off" to an event stream (transactional outbox, so no event is lost or sent for a rolled-back change). Workers handle notifications, fee settlement and analytics outside the request. |
| Real-time communication | Replace polling with SSE or WebSockets fed by the event stream; keep adaptive polling as a fallback. |
| Rate limiting | Per user and per IP at the load balancer (today only sign-up and login are limited, per client IP), stricter on ride requests and driver actions. |
| Idempotency | An `Idempotency-Key` header on every write; the first response is stored with the key and returned for any retry, so a double tap on a slow network never books twice. |
| Retry and failure strategy | A lock wait over 3 s already returns `503 BUSY`; clients retry with backoff and the same idempotency key. Auto-join is best effort: if it fails, the ride simply waits. Health checks remove broken instances. |
| Observability | Already structured JSON logs with a request id per request. Add metrics (seat decisions/s, lock waits, `BUSY` rate, p95 latency), tracing across web → API → database, and alerts on `BUSY` spikes. |
| Security | httpOnly Secure cookies, hashed session tokens and passwords, role and ownership checks (as today); add secrets in a manager, WAF and bot protection at the edge, audit logs for money changes, and least-privilege database users. |
| Deployment strategy | Build once, migrate with backward-compatible migrations (add column → deploy → backfill → enforce), then roll out gradually (blue/green or canary) with automatic rollback on error-rate alerts. |

What we would **not** add without a measured reason: microservices per feature, Kubernetes for a handful of services, or a queue in front of every write.

## Key decisions and trade-offs

| Decision | Trade-off we accepted |
|---|---|
| En-route pooling on fixed routes: a Tesla picks up anyone ahead on its route until full | Only trips a route carries without going far round are sold (72 of 102 zone pairs); more routes would serve the rest |
| One row lock per vehicle + database guards | Actions on the same car wait in line (fine: one car is in one place); no distributed locks or queues |
| Estimate = solo fare; −20% if you shared a hop; locked at drop-off | The final fare is known only at drop-off, but it can only go down |
| Driver paid for the work (৳10/km carried + ৳20/pickup), platform keeps the rest | Platform margin varies per trip; proven never below ৳10 by an exhaustive test |
| The system suggests a route, the driver decides | No automatic dispatch without live GPS |
| No seat hold: a fitting request takes its seat at once | The driver does not approve each join; they keep control through the route, accept, no-show and cancel |
| Polling every 3 s | Some wasted requests; simple and reliable on free hosting |
| Sessions in the database through a same-origin proxy | One database lookup per request; no CORS, revocable sessions |
| Pull requests with CI gates and merge commits into a protected `master` | Slower than pushing directly; the history shows every step |

## Known limitations

- **No live GPS or maps.** Dhaka is 14 zones and 6 fixed routes; the car's position is the stop the driver reports. 30 of the 102 zone pairs on a route are not sold because the route goes too far round.
- **Seats are counted per trip, not per stretch.** Anyone not yet dropped off holds their seat, so a join that would fit later on the route can be refused until someone gets off.
- **Driver pay has no time component.** No per-minute rate for traffic, no pay for driving to the first pickup or empty stretches, no surge or incentives.
- **Cash only.** The platform fee is recorded per trip, not collected.
- **Polling, not push.** Screens refresh every 3 s, route suggestions every 5 s, histories every 10 s.
- **No idempotency key.** A retried request gets a `409` rather than the original answer.
- **Requests do not expire.** A waiting request stays until it is matched or cancelled.
- **Demo helpers.** The login page has one-click demo accounts and the demo password is public; both are for the reviewer and must be turned off in a real deployment. Drivers cannot sign up (they are onboarded by the operator; one is seeded).
- **Expired sessions are rejected but not deleted;** a cleanup job is not built.
- **Rate limit on direct API calls.** Through the web app the client address cannot be faked, but a caller who hits the API URL directly could send a fake `X-Forwarded-For` to dodge the login limit. The fix is a gateway rate limit or accepting API traffic only from the web proxy.
- **Hosting.** The free API tier sleeps when idle (slow first request), and the API image is large (~790 MB) because it includes the Prisma CLI to run migrations at start.

## Next improvements

Each one, with how we would build it:

| Improvement | How |
|---|---|
| **Push updates instead of polling** | An SSE endpoint per screen (`/rides/current/stream`, `/driver/stream`). After each committed change the API publishes an event (PostgreSQL `LISTEN/NOTIFY` for one instance, a pub/sub channel for several) and the stream sends the new state. Keep adaptive polling as the fallback: fast during a trip, slow when idle, paused in background tabs. |
| **Idempotency keys** | The client sends an `Idempotency-Key` header on `POST /rides` and driver actions. A new `idempotency_keys` table (user, key, request hash, response, time) with a unique index on (user, key); the response is stored in the same transaction as the change, and a retry with the same key gets the stored response. Keys expire after 24 h. |
| **Request expiry** | An `expires_at` on each request (e.g. 10 minutes) and a new `EXPIRED` status. Expired requests are skipped and marked under the lock at auto-join and accept, plus a small scheduled sweep for the rest. |
| **"Pause new joins" for drivers** | An `accepting_joins` flag on the pool, changed under the vehicle lock. R4 checks it, and the conditional seat update includes it, so no join slips in after a pause. |
| **Seats per stretch of the route** | Instead of one counter for the whole trip, check the busiest hop of the new rider's stretch: for [pickup, drop-off), the seats of everyone on board on each hop plus the new seats must stay within capacity. Computed under the lock from `pool_members`; the database guard becomes a per-hop row with its own CHECK. A car full to Mohakhali could then take someone from Mohakhali onwards in advance. |
| **More routes, live GPS and dispatch** | Add routes from real demand (the zone pairs we cannot sell today). The driver app sends its position every few seconds; a geo index finds nearby cars on routes that pass the pickup; the request is offered to the best car and the driver accepts within a few seconds, or it goes to the next. A Leaflet + OpenStreetMap map on both screens. |
| **Driver pay per minute and for dead km** | Store the arrive and depart time of each stop, add a per-minute rate and a small rate for driving to the first pickup, then re-run the exhaustive earnings test with the new rates before release, so no trip loses money. |
| **TeslaPay wallet** | A double-entry ledger table. Paying a fare and deducting the platform fee happen in one transaction with a conditional update (`balance >= amount`), so a balance can never go negative. |
| **Operations** | Driver onboarding (the operator creates the driver and vehicle after document checks), an admin view of trips and fees owed, a scheduled job that deletes expired sessions, and a `DEMO_MODE` flag that hides the demo buttons and skips demo accounts in production. |
| **Scale** | The steps in the Bonus section above, in that order: connection pooler, replicas for reads, push updates, then partitioning by city area. |

## AI Usage

**Tool:** Claude (Anthropic), through Claude Code in VS Code.

**How the work was split.** I owned the product and the engineering decisions; Claude was my research partner and wrote the code to those decisions.

| | Me | Claude |
|---|---|---|
| Product and business | What to build, the USP (en-route pooling on fixed routes), the pricing rules and who earns what | Researched options, ran the numbers (e.g. every trip on every route for the fare split), pointed out risks |
| Architecture and design | The stack, the layered architecture, the data model, the concurrency approach, every rule for routes, matching and fares | Laid out the options with trade-offs and failure cases (race conditions, edge cases), and gave a recommendation |
| How the code is written | The rules the code must follow: controller → service → repository, one row lock per vehicle, database guards, money in integer paisa, tests against a real Postgres, readable code over clever code, one approved approach per feature | Wrote the code, tests, migrations and diagrams within those rules |
| Delivery | Approved each feature's approach before it was built, had every change explained before committing it, committed and merged through PRs with CI | Explained each change, ran the checks, kept the decision log up to date |

**How each feature went:** I described the problem and my first idea; Claude researched the options; I chose, and the choice was recorded with the alternatives and the reason; then Claude implemented it and I checked the result (tests, CI, the running app) before committing.

**Decisions where I went against the AI's recommendation**

| Topic | AI recommended | My decision and why |
|---|---|---|
| Backend framework | Fastify (lighter, built-in logging and validation) | **NestJS**: its module/controller/service structure enforces the layered architecture I wanted. |
| ORM | Drizzle | **Prisma**, with raw SQL only for the vehicle lock and the hand-written CHECK constraints. |
| En-route pooling | Keep same-zone pooling and defer en-route pickups, to meet the deadline | **Build it**: picking people up along the route until the car is full is the product. It shipped with its own race tests. |
| Fare split | The first model let the driver keep all cash, so the sharing discount was the driver's loss | **Three-party model**: I set the rule that the driver must never pay for a discount and the platform must earn. The driver is paid for the work, and a test over every possible trip proves nobody loses money. |

**One suggestion accepted, one rejected** (the PRD's format)

- **Accepted: "one vehicle = one line".** Every change to a vehicle's seats or trip locks that vehicle's row, backed by CHECK constraints and partial unique indexes. I chose it over Redis locks, queues and serializable transactions because the database guarantees correctness even if the code has a bug, it needs no extra infrastructure, and it can be tested with real races (20 riders for the last seat, "the car leaves" against "a rider joins at that stop").
- **Rejected: a 60-second seat hold where the driver confirms every join** (option Y). In en-route pooling the driver is driving between stops; asking them to tap within 60 seconds is unsafe, leaves the rider unsure, and brings back a HELD state and new races. A fitting request takes its seat at once instead.

**What I checked myself**
- The core rules are backed by tests: 55 unit and 40 end-to-end tests against a real PostgreSQL, including the races and one full journey from sign-up to the driver's earnings.
- CI (lint, types, unit, e2e, Docker build) must pass before anything reaches `master`, which is protected.
- A final audit of the whole system found one real race (a passenger's cancel against the driver's trip cancel). It was fixed and tested before release.
- A live stress test through the public URL (63 checks, including the races over the real network) found that the login rate limit did not count the real client behind Vercel and Render. It was fixed and re-checked live (v1.0.1).
- No secrets, keys or personal data were given to the AI. Demo accounts use the reserved `.test` domain.

## Demo video

*Link added at release.*
