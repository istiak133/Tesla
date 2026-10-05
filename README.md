# 🚗 Dhaka Tesla Pool

**Share a seat. Split the fare. Survive Dhaka traffic.**

A ride-pooling MVP built around the PRD's cast: driver **Jashim** and his three-seat **Bullet**, and passengers **Nusrat**, **Rafiq** and **Shirin**.

- 🌐 **Live demo:** https://tesla-pool-one.vercel.app (choose Passenger or Driver, then a one-click demo account)
- 🎬 **Demo video:** https://www.youtube.com/watch?v=eTIudjhgNjY
- ✅ **Status:** MVP complete: en-route pooling on fixed routes, a stop-by-stop trip, fares and the driver/platform money split
- 🧪 **Quality:** 86 unit and 95 end-to-end tests against PostgreSQL, CI on every pull request
- 🆕 **After the submission (v1.4.0):** batch matching, seating all waiting riders together instead of one at a time (see [How a request finds a car](#-routes-and-matching-rules)). Everything up to v1.3.3 is what was submitted.

---

## 📑 Contents

[Problem](#-problem-statement) · [Features](#-features-implemented) · [Screenshots](#-screenshots) · [Architecture](#-architecture) · [Tech stack](#-tech-stack) · [Project structure](#-project-structure) · [Setup](#-setup) · [Tests](#-tests) · [Demo credentials](#-demo-credentials) · [Deployment](#-deployment) · [API](#-api-overview) · [Fare model](#-fare-model) · [Routes](#-routes-and-matching-rules) · [Concurrency](#-concurrency-bullets-last-seat) · [Scaling bonus](#-bonus-if-oi-tesla-goes-viral-1m-passengers-100k-drivers) · [Decisions](#-key-decisions-and-trade-offs) · [Limitations](#-known-limitations) · [Next](#-next-improvements) · [AI usage](#-ai-usage) · [Video](#-demo-video)

---

## 🎯 Problem statement

- 🧍 Nusrat (Banani → Mohakhali) and Rafiq (Banani → Gulshan 1) book overlapping but not identical trips a few minutes apart.
- ⚡ The system must decide quickly whether they can share Bullet.
- 💰 Each passenger needs an individual, fair fare.
- 🪑 Occupied seats must never exceed three, even when Nusrat and Shirin claim the last seat at the same instant.
- 🚗 The driver must see who is riding and at which stage.
- 🧾 Enough history must be kept to explain afterwards exactly what happened.

## ✨ Features implemented

**🔐 Accounts**
- Two account types, chosen first on both login and sign-up: **Passenger** or **Driver**
- Sign-up asks what real ride apps ask: full name, email, Bangladeshi mobile number, password, present and permanent address
- Drivers also give **an NID or a passport** (their choice), a driving licence number, and their Tesla (name and number plate); the car gets 3 seats
- Values are tidied before saving (`01712-345678` → `+8801712345678`, documents and plates in capitals); each email, phone, document, licence and plate belongs to one account
- Login checks the account type too; a server-side session in an httpOnly cookie; logout

**🧑 Passenger**
- Request a ride with a solo fare estimate; only trips a route serves are offered
- Seated automatically in a Tesla on its way: every 2 s all waiting riders are placed together, so the most people ride, the nearest car winning a tie (batch matching, v1.4.0)
- Live status with the route drawn and the car on it
- Cancel while waiting, while the car comes or while it waits at the stop (not once in the car); a double tap gets the same answer
- A late cancel (the car is already coming to your stop) costs ৳20, shown before you tap and paid with your next ride; free while the car is a stop or more away
- A seat freed by someone else's cancel, no-show or drop-off goes to you at the next matching round if you are waiting and fit
- Full ride history with every status change

**🚗 Driver**
- A **suggested route** from where the car is and where riders are waiting (one tap to take it, or pick another)
- Go online and see **only the requests your car can take**, nearest pickup first, each with its distance ("pickup 3 km ahead"); requests waiting 5+ minutes are lifted to the top
- A request reaches every driver whose car can take it; the **first to accept gets it**, and it leaves the other drivers' screens at once (the late tap gets "Another driver took this request")
- Only a trip's **first passenger** goes through the driver; everyone after that is seated by the system, and a request a running trip can take is shown to no driver
- Accept: a new trip starts **where the car is**, and the car drives stop by stop to the pickup
- Drive stop by stop: arrive → picked up / drop off / no-show → leave for the next stop
- Cancel before the first pickup (passengers go back to waiting)
- Past trips with cash collected, own earnings and the platform fee

**🔄 Pooling**
- 14 Dhaka zones on six routes (three lines, both directions)
- A Tesla already on its way picks up anyone waiting at a stop ahead until its seats are full
- Each passenger gets on and off at their own stop; seats are freed at drop-off; an empty trip closes itself

**💰 Money**
- Fares locked at drop-off: 20% off if another passenger shared at least one hop
- Driver paid for the work (৳10/km carried + ৳20/pickup); the platform keeps the rest; never negative for anyone

**🔐 Safety and quality**
- Seat capacity protected by a vehicle row lock plus database CHECKs, tested with Nusrat and Shirin racing for the last seat, 20 riders racing, and "the car leaves a stop" against "a passenger joins there"
- Invalid transitions rejected with `409`; role-based access; rate-limited sign-up and login
- Health endpoint with a real database check (`GET /health`); structured JSON logs with a request id; the app refuses to start with bad configuration
- One-command local run with Docker Compose; CI on every pull request

**🖥️ Web**
- Next.js app for both roles, with **live updates over Server-Sent Events** (a change reaches open screens in under 0.1 s in Docker and about 1.4 s on the free live hosting, where most of that is the action's own round trip to the API; polling only as a fallback); loading, error and empty states; a same-origin `/api` proxy (no CORS)

## 📸 Screenshots

| Login: choose Passenger or Driver, then a demo account | Driver sign-up: NID or passport, licence and the car |
|---|---|
| ![Login](docs/screenshots/login.png) | ![Driver sign-up](docs/screenshots/signup-driver.png) |

| Shirin joins Bullet on the way, at Mohakhali | Waiting requests, nearest pickup first |
|---|---|
| ![Passenger matched](docs/screenshots/passenger-matched.png) | ![Driver requests](docs/screenshots/driver-requests.png) |

| Jashim at Mohakhali: Nusrat gets off, Shirin gets on | Nusrat paid ৳60 for sharing a hop |
|---|---|
| ![Driver pool](docs/screenshots/driver-pool.png) | ![Fare locked](docs/screenshots/passenger-fare-locked.png) |

| Suggested route from where the car is | After the trip: Jashim earned ৳180 of ৳240 |
|---|---|
| ![Route suggestion](docs/screenshots/driver-route-suggestion.png) | ![Driver earnings](docs/screenshots/driver-earnings.png) |

## 📐 Architecture

![Final architecture](docs/final_architecture_design.png)

- 🗺️ Final architecture: [`docs/final_architecture_design.pdf`](docs/final_architecture_design.pdf)
- 🧱 Layered architecture with the numbered happy path: [`docs/architecture-diagram.pdf`](docs/architecture-diagram.pdf)
- 🗂️ System overview (request path, ERD, lifecycles): [`docs/system-overview.pdf`](docs/system-overview.pdf)
- 🔁 One ride end to end: [`docs/ride-flow.pdf`](docs/ride-flow.pdf)

```mermaid
flowchart LR
    B["Browser<br/>passenger and driver screens"] -->|"HTTPS · session cookie"| W["Next.js on Vercel<br/>pages · TanStack Query · /api/* proxy"]
    W -->|"same origin, no CORS"| A["NestJS API on Render<br/>controller → service → repository"]
    A -->|"transactions · SELECT … FOR UPDATE"| D[("PostgreSQL on Neon<br/>CHECK constraints · partial unique indexes")]
    W -. "event stream (SSE) · polling as fallback" .-> A
```

### 🗄️ Data model (ERD)

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : "logs in with"
    USERS ||--o| VEHICLES : "drives"
    USERS ||--o| DRIVER_PROFILES : "documents"
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
    POOLS ||--o{ RIDE_REQUESTS : "late-cancel fees"
    RIDE_REQUESTS ||--o{ RIDE_REQUESTS : "fee paid with"
    ZONES ||--o{ VEHICLES : "car is at"
    POOLS ||--o{ RIDE_EVENTS : "during trip"
    USERS ||--o{ RIDE_EVENTS : "actor (null = system)"

    USERS {
        uuid id PK
        text email "unique, CHECK lower case"
        text phone "unique, CHECK +8801XXXXXXXXX"
        text present_address
        text permanent_address
        enum role "PASSENGER or DRIVER"
        text password_hash "bcrypt"
    }
    DRIVER_PROFILES {
        uuid user_id PK
        enum id_type "NID or PASSPORT"
        text id_number "unique with id_type"
        text licence_number "unique"
    }
    VEHICLES {
        uuid id PK
        uuid driver_id FK "unique: one car per driver"
        text plate_number "unique"
        int seat_capacity "CHECK > 0"
        bool is_online
        uuid route_id FK
        uuid current_zone_id FK
    }
    POOLS {
        uuid id PK
        uuid vehicle_id FK "one active per vehicle"
        uuid route_id FK
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
        int cancellation_fee_paisa "0 or 2000, only if CANCELLED"
        uuid cancellation_fee_pool_id FK "the trip that earns it"
        uuid fee_paid_with_ride_id FK "the later ride that paid it"
        int dues_collected_paisa "earlier fees paid with this ride"
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

### 📋 Tables

| Table | What it holds | Key constraints and indexes |
|---|---|---|
| `users` | Passengers and drivers, one role each, with phone and present and permanent address | `email` unique, `CHECK email = lower(email)`; `phone` unique, `CHECK` +8801XXXXXXXXX; `role` is an enum |
| `driver_profiles` | What only a driver gives: NID or passport (type + number) and driving licence | primary key `user_id`; unique (id type, number) and licence; `CHECK` the number fits the type (NID 10/13/17 digits, passport letters + digits) |
| `sessions` | One row per login: the SHA-256 hash of the cookie token and its expiry | `token_hash` unique; index on `user_id`; deleted at logout |
| `zones` | The 14 Dhaka zones | `code` and `name` unique |
| `zone_distances` | Direct km between every ordered pair of zones (182 rows); sets the fare | primary key (from, to); `CHECK km > 0`, `CHECK from <> to` |
| `routes` | The six fixed routes (each direction on its own) | `code` and `name` unique |
| `route_stops` | The zones of a route in driving order, with km from the first stop | primary key (route, position); unique (route, zone); `CHECK position ≥ 0`, `CHECK km_from_start ≥ 0` |
| `vehicles` | Each driver's car: name, number plate, seats, online, chosen route, current zone. **Its row is the lock** for every seat change | `driver_id` unique (one car per driver); `plate_number` unique; `CHECK seat_capacity > 0` |
| `pools` | One trip of a car along its route: where it is (`status` + `current_stop`), seats taken, and the money split once completed | `CHECK seats_taken BETWEEN 0 AND seat_capacity`; **one active pool per vehicle** (partial unique index); `CHECK collected = driver + platform`; index on (status, route) for finding joinable trips |
| `pool_members` | A ride's seats in a pool, from its pickup stop to its drop-off stop | **one active seat per ride** (partial unique on `left_at IS NULL`); `CHECK pickup_stop < dropoff_stop`; index on `pool_id` |
| `ride_requests` | A passenger's trip: zones, seats, status, direct km, solo estimate and final fare, and any late-cancel fee (with the trip that earns it and the later ride that paid it) | **one active ride per passenger** (partial unique); `CHECK seats 1..3`, `CHECK pickup <> drop-off`, `CHECK fares ≥ 0`; indexes on (status, created) for the waiting list and (passenger, created) for history; `CHECK` fees ≥ 0, a fee only on a cancelled ride and always with its trip; partial index on unpaid fees per passenger |
| `ride_events` | The audit trail: every status change with from, to, actor, reason and time | index on (ride, created); the actor is null for the system |

- 💰 Money is integer paisa everywhere.
- 🕒 Times are `timestamptz` (UTC, shown in Dhaka time); ids are UUIDs.
- 💵 Payment is cash, so there is no payments table: each completed pool records what was collected and how it splits.
- ⭐ Ratings are out of scope.

## 🧰 Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query |
| Backend | NestJS 12 (REST), TypeScript |
| Database | PostgreSQL (17 in Docker, Neon in production), Prisma 7 (migrations, typed client) |
| Validation | class-validator / class-transformer |
| Logging | pino (nestjs-pino) |
| Tests | Vitest + Supertest, integration tests against real PostgreSQL |
| Tooling | Docker Compose, GitHub Actions |

### 🤔 Why these choices

| Choice | Alternatives considered | Why it fits ride-pooling | When we would switch |
|---|---|---|---|
| **REST** | GraphQL, tRPC | Few resources and screens with fixed shapes; business rules map cleanly to HTTP status codes (409 for a lost seat, 403 for someone else's ride); simple to test with Supertest and to cache | GraphQL when several clients (mobile apps, partners) need different shapes of the same data and over-fetching becomes a real cost |
| **NestJS** | Fastify, Express | Modules, controllers, services and guards enforce the layered architecture and keep auth checks in one place | For a single hot path, run Nest on its Fastify adapter; plain Fastify for a tiny service |
| **PostgreSQL** | MongoDB, MySQL | Row locks, CHECK constraints and partial unique indexes make seat safety a database guarantee, not only a code promise | Never for the core; at scale add read replicas and split by city area |
| **Prisma** | Drizzle, TypeORM, raw SQL | Typed queries for the pool, member and ride joins, and versioned migrations where the seat CHECKs and partial unique indexes are written by hand; raw SQL only for `SELECT … FOR UPDATE` | If most queries became hand-tuned SQL, a query builder (Drizzle, Kysely) |
| **Database sessions** | JWT | An httpOnly cookie through the same-origin proxy, revocable at logout, no token handling in the browser | Short-lived JWTs when many services must verify users without a database call, or for native mobile apps |
| **Next.js + TanStack Query** | React SPA (Vite), server-rendered pages | The `/api` rewrite gives a first-party cookie with no CORS; TanStack Query caches each screen, refetches it on a live hint, and gives loading and error states | A native app when drivers need background location |
| **Server-Sent Events** (live updates) | WebSockets, faster polling | One-way hints are all the screens need; plain HTTP through the same `/api` proxy and cookie; the browser reconnects by itself. Events carry no data, so nothing private can leak, and correctness never depends on them because every action is re-checked under the lock | WebSockets when drivers stream live GPS; a pub/sub backend (`LISTEN/NOTIFY`, Redis) once there is more than one API instance |
| **Vitest + Supertest on a real PostgreSQL** | Jest, mocked database | Race conditions and constraints can only be proven against the real database | Not planned |
| **Tailwind CSS** (styling) | CSS Modules, a component library (MUI, shadcn/ui) | Two small screens with clear states (loading, error, empty, the route line) built fast and consistently, with no design-system weight | A component library once there are many screens, forms and a design team |
| **class-validator DTOs** (validation) | Zod, Joi | Built into NestJS's `ValidationPipe`: every request body is checked and unknown fields are rejected before a service sees it | Zod if the web and API shared schemas in one monorepo |
| **pino** (logging) | Winston, console | Structured JSON with one request id per request, so a race or a failed booking can be traced across lines; session cookies are redacted | A log platform (Loki, Datadog) and metrics once there is real traffic |
| **bcryptjs + throttler** (password, rate limit) | argon2, a gateway rate limit | Pure JavaScript (no native build in Docker); 5 login or sign-up attempts per minute per IP stops guessing | argon2id and a gateway or Redis-backed rate limit when running several API instances |
| **Free tiers: Vercel, Render, Neon** | Koyeb, Fly.io, Supabase | Free and public; Render runs the same Docker image as local, and Neon is real PostgreSQL, so the row lock and constraints behave in production exactly as in the tests | Paid plans to remove cold starts |


## 📁 Project structure

```
.
├── api/                  NestJS API
│   ├── prisma/           schema and migrations
│   ├── src/
│   │   ├── auth/         sign-up, login, sessions, guards (session, role)
│   │   ├── users/        users repository
│   │   ├── geography/    zones, distances, routes, destinations (+ the seed data)
│   │   ├── rides/        passenger rides, PoolingService, MatcherService (batch matching rounds), the vehicle lock (RidesRepository)
│   │   ├── driver/       DriverService (route, online, accept, suggestions), TripService (stop by stop)
│   │   ├── pooling/      pure rules: route-plan.ts (R1–R4, sharing), assignment.ts (batch matching), route-suggestion.ts
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

- 🧱 Every API feature has the same layers: **controller** (HTTP only) → **service** (business rules) → **repository** (the only layer that talks to the database).
- 🧮 The rules that decide seats and money are pure functions with unit tests: `pooling/` and `fares/`.

## 🔧 Setup

### 📦 Prerequisites
- 🐳 To run everything: **Docker** with Docker Compose
- 🟢 To develop outside Docker: **Node.js 24** and npm

### 🔧 Environment variables
- ✅ No `.env` file is needed for `docker compose up`: every value has a safe local default.
- 🚫 Never commit real secrets; only the `.env.example` files are committed.

| File | Used by | Variables |
|---|---|---|
| [`.env.example`](.env.example) | Docker Compose | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_HOST_PORT`, `LOG_LEVEL`, `DATABASE_POOL_MAX` |
| [`api/.env.example`](api/.env.example) | API outside Docker | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_POOL_MAX`, `SESSION_TTL_HOURS`, `TRUST_PROXY_HOPS`, `MATCH_INTERVAL_MS` (the batching window, default 2000) |
| [`web/.env.example`](web/.env.example) | Web outside Docker | `API_URL` |

### 🐳 Run with Docker

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API (direct) | http://localhost:3001/health |
| API (through the web proxy) | http://localhost:3000/api/health |
| PostgreSQL | `localhost:5433` (user / password / db: `tesla`) |

- 🚦 Start order is enforced by health checks: database → API (runs migrations first) → web.
- 🛑 Stop with `docker compose down` (add `-v` to delete the database volume).

### 🌱 Migrations and seed data
- 🔄 Migrations run automatically when the API container starts (`prisma migrate deploy`). Outside Docker: `cd api && npm run prisma:deploy`.
- 🌱 The API container also upserts the zones, distances, routes and story cast on start (safe to repeat). Outside Docker: `cd api && npm run build && npm run db:seed`.

### 💻 Run without Docker

```bash
docker compose up -d db                              # only the database

cd api && cp .env.example .env && npm install
npm run prisma:deploy && npm run start:dev           # API on :3001

cd ../web && cp .env.example .env.local && npm install
npm run dev                                          # web on :3000
```

## 🧪 Tests

```bash
docker compose --profile test up -d db-test          # test database on :5434

cd api
npm test                                             # unit tests
DATABASE_URL=postgresql://tesla:tesla@localhost:5434/tesla_test npm run test:e2e
```

- 🤖 CI on every pull request: lint, type checks, unit tests, migrations, end-to-end tests against PostgreSQL, the web production build and the Docker image builds.
- 🌐 After every deploy, a **live end-to-end check** runs against the public URL (browser path: Vercel → Render → Neon).
  - It makes 63 checks of every feature, including 4 races over the real network: the last seat, two accepts, a cancel against a trip cancel, and leaving a stop against joining it.
  - It takes about a minute, with at most two requests at once.
  - It proves the deployed system behaves correctly. It is **not a load test**: how many users at once the free tier can hold has not been measured.
- 🎯 What the tests prove (the PRD's must-haves and the risky cases):

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
| Every cancel state, an empty trip closing, and a cancel racing a second cancel, an accept, a pickup and a no-show (5 rounds each, seat counter checked every round) | `api/test/cancel.e2e-spec.ts` |
| A freed seat goes straight to a waiting rider (cancel, no-show, drop-off), best rider first, never one behind the car; two cars freeing seats at once and a rider cancelling as her seat frees (5 rounds each) | `api/test/refill.e2e-spec.ts` |
| The ৳20 late-cancel fee: free while stops away and in the grace period, charged once the car is coming, a no-show too, and the money trail through the next ride and both drivers | `api/src/fares/cancellation.spec.ts`, `api/test/cancel-fee.e2e-spec.ts` |
| The route list shows only routes through the car, with riders waiting on each | `api/test/driver-routes.e2e-spec.ts` |
| Only takeable requests are listed; two drivers accepting the same request at once (5 rounds: one wins, no empty trip left); a taken request leaves the other lists; the event stream hears a change the moment it commits, per role, and needs a session | `api/src/realtime/realtime.service.spec.ts`, `api/test/live-dispatch.e2e-spec.ts` |
| A driver's trip cancel: riders back to waiting with no fee, re-seated at the next round in a running car that fits or shown to idle cars; the passenger can still cancel for free; a late-cancel fee stays owed through a cancelled next ride | `api/test/driver-cancel.e2e-spec.ts`, `api/test/cancel-fee.e2e-spec.ts` |
| Nobody loses money on any trip any route can sell (about 25,000 cases) | `api/src/fares/earnings.spec.ts` |
| Matching by the car's position: new trips start at the car, pickups behind are refused, the nearest car wins over an older trip, the list is nearest first with aging | `api/src/pooling/matching.spec.ts`, `api/test/matching.e2e-spec.ts` |
| Batch matching: riders placed together move more people than one at a time (4 seats against 3 in the example); nearest car, older trip and aging still decide ties; the search checked against an independent brute force on 400 random cases; a stale plan only misses a seat (a cancel or a departure after the plan); rounds never overlap; an idle driver's accept racing the matcher (5 rounds: one wins, no empty trip); a round publishes a live hint | `api/src/pooling/assignment.spec.ts`, `api/test/batch-matching.e2e-spec.ts` |
| Sign-up for both account types (every field checked, NID or passport, duplicates refused with nothing half made), login with the account type, and a new driver taking a real ride | `api/src/auth/identity.spec.ts`, `api/test/auth.e2e-spec.ts` |
| Everything together, from sign-up to the driver's earnings | `api/test/full-journey.e2e-spec.ts` |

## 🔑 Demo credentials

- 🔐 All demo accounts use the password **`tesla1234`** (local and demo use only).
- 👆 On the login page, choose **Passenger** or **Driver** first; the demo accounts of that type appear below the form.

| Name | Email | Role |
|---|---|---|
| Jashim | `jashim@teslapool.test` | Driver |
| Nusrat | `nusrat@teslapool.test` | Passenger |
| Rafiq | `rafiq@teslapool.test` | Passenger |
| Shirin | `shirin@teslapool.test` | Passenger |

## 🌐 Deployment

- 🌍 **Live demo:** **https://tesla-pool-one.vercel.app** (log in with a demo account above)
- 🩺 **API health:** `https://tesla-pool-api.onrender.com/health`
- 😴 **Cold start:** after 15 idle minutes the free API sleeps, so the first request can take 30 to 60 seconds. Open the health link once before a demo.

| Part | Service | Settings |
|---|---|---|
| Database | **Neon** (PostgreSQL, free) | Use the direct connection string with `sslmode=require` |
| API | **Render** web service (Docker, free) | Root `api`, health check `/health`; env `NODE_ENV=production`, `DATABASE_URL` (Neon), `DATABASE_POOL_MAX=5`, `LOG_LEVEL=info`, `TRUST_PROXY_HOPS=2` |
| Web | **Vercel** (Next.js, free) | Root `web`; env `API_URL=https://<your-api>.onrender.com` |

- 🔄 On every start the API container runs `prisma migrate deploy`, then the idempotent seed, then the server, so a fresh Neon database needs no manual step.
- 🍪 The browser only talks to Vercel; the `/api/*` rewrite forwards to Render, so the session cookie stays first-party (Secure in production) and no CORS is needed.
- 🧳 **If free hosting is not available:** the same stack deploys on any machine with Docker. Copy `.env.example` to `.env`, set a strong `POSTGRES_PASSWORD`, and run `docker compose up -d --build`. Compose starts PostgreSQL, the API (which migrates and seeds itself) and the web app in order, gated by health checks.

## 🔌 API overview

- 🔗 Through the web app every path is prefixed with `/api` (e.g. `/api/auth/login`).

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `200 {"status":"ok","database":"up"}` or `503` when the database is unreachable |
| POST | `/auth/signup/passenger` | Create a passenger account (name, email, phone, password, addresses) and log in |
| POST | `/auth/signup/driver` | The same plus NID or passport, licence, car name and plate: user, documents and car in one transaction |
| POST | `/auth/login` | Log in with the account type, email and password (sets the session cookie); 5 attempts per minute (sign-up too) |
| POST | `/auth/logout` | End the session and clear the cookie |
| GET | `/auth/me` | The logged-in user |
| GET | `/zones` | The 14 zones for pickup and destination |
| GET | `/routes` | The six routes with their stops in driving order |
| GET | `/zones/:id/destinations` | Where a passenger can ride from this pickup (routes that are not too far round) |
| POST | `/rides` | Passenger: request a ride `{pickupZoneId, dropoffZoneId, seats}`; `400 NO_ROUTE` if no route serves it; answers `REQUESTED`, and the next matching round (within `MATCH_INTERVAL_MS`) seats it in a Tesla on the way if one fits |
| GET | `/rides/current` | Passenger: the active ride (driver, route with the car's position, co-riders' first names, fare, history) |
| GET | `/rides` | Passenger: ride history |
| GET | `/rides/:id` | Passenger: one of my rides (403 for someone else's) |
| POST | `/rides/:id/cancel` | Passenger: cancel while `REQUESTED`, `MATCHED` or `DRIVER_ARRIVED`; ৳20 fee once the car is coming to the stop (`cancelNowFeePaisa` on the ride says so first); a cancelled ride is returned as it is; `409` after pickup or when finished |
| GET | `/driver/routes` | Driver: only the routes through the car's zone, ranked by riders waiting ahead, with the suggested one (none until the location is set) |
| POST | `/driver/location` | Driver: where the car is `{zoneId}` (before a trip; stops update it after that); a chosen route that does not pass the new zone is cleared and the driver goes offline |
| POST | `/driver/route` | Driver: choose the route `{routeId}` (only between trips; it must pass the car's zone) |
| POST | `/driver/online`, `/driver/offline` | Driver: availability (a route is required; offline refused during a trip) |
| GET | `/driver/requests` | Driver: the waiting requests this car can take, best first, with `pickupKmAhead` |
| GET | `/events/stream` | Server-Sent Events for the logged-in user: `change` events with topics (`requests` for drivers, `rides` for everyone) and a 25 s heartbeat; no data, screens refetch |
| POST | `/driver/requests/:id/accept` | Driver: accept (starts a trip at the car's stop on its route, or adds to the current one) |
| GET | `/driver/pool` | Driver: vehicle, route and current trip with its stops and passengers |
| GET | `/driver/trips` | Driver: past trips with passengers, cash collected, driver earnings and platform fee |
| POST | `/driver/pool/arrive`, `/driver/pool/depart` | Driver: arrive at the current stop; leave for the next one (409 while someone still waits here) |
| POST | `/driver/pool/passengers/:rideId/pickup`, `/dropoff`, `/no-show` | Driver: one passenger at this stop; drop-off locks their fare |
| POST | `/driver/pool/cancel` | Driver: cancel before the first pickup; passengers return to waiting (no fee) and are offered again at once |


### ❗ Errors

- 🧩 Services never mention HTTP: they throw a business error with a code, and one filter turns it into `{ statusCode, code, message }`.

| Status | When |
|---|---|
| `400` | Invalid input (DTO validation, unknown fields), `INVALID_ZONE`, `NO_ROUTE` |
| `401` | No valid session cookie, or wrong email/password; `WRONG_ACCOUNT_TYPE` when the password is right but the other account type was chosen (said only after the password matched) |
| `403` | Wrong role for the route, `NOT_YOUR_RIDE`, `NO_VEHICLE` |
| `404` | `NOT_FOUND` (ride, route, zone, or a passenger not in this trip) |
| `409` | Business rules: `SEATS_UNAVAILABLE`, `NOT_COMPATIBLE`, `ALREADY_TAKEN`, `INVALID_TRANSITION`, `ACTIVE_RIDE_EXISTS`, `HAS_ACTIVE_POOL`, `NO_ACTIVE_POOL`, `DRIVER_OFFLINE`, `ROUTE_REQUIRED`, `POOL_NOT_OPEN`; `ALREADY_REGISTERED` with the `field` (email, phone, idNumber, licenceNumber, plateNumber) |
| `429` | More than 5 sign-up or login attempts per minute |
| `503` | `BUSY`: the vehicle's lock was held for more than 3 s; safe to retry |

- 🖥️ On the web, every error is shown next to the action that caused it, and a `401` from any screen (for example an expired session) sends the user back to the login page.

### 🛡️ Security basics

- 🔑 **Passwords:** bcrypt (cost 10), at least 8 characters at sign-up; never returned by the API, and request bodies are not logged.
- 🍪 **Sessions:** a random 32-byte token in an httpOnly, SameSite=Lax cookie (Secure in production), 12 h; only its SHA-256 hash is stored, so a database leak does not expose live sessions. Logout deletes the row.
- 🌐 **Same origin:** the browser only talks to the web app; `/api/*` is forwarded to the API, so there is no CORS to configure.
- 🚪 **Access control:** a session guard on every private route, a role guard (passenger vs driver), and an ownership check in the service (`403 NOT_YOUR_RIDE`). Co-riders see only first names, never fares.
- ✅ **Input:** a whitelisting `ValidationPipe` (a client cannot send its own role), UUID checks on every id in the URL, and database CHECKs as the last line. Sign-up values are normalised first; the phone, NID and passport formats are checked again by CHECK constraints.
- 🪪 **One person, one account:** unique indexes on email, phone, (document type, number), licence and plate; a driver's user, documents and car are created in one transaction, so a refused sign-up leaves nothing behind.
- 🚦 **Headers and limits:** helmet's security headers; 5 attempts per minute on sign-up and login, counted per real client: the first `X-Forwarded-For` address, which Vercel sets and overwrites. Counting proxy hops was not stable behind Vercel and Render (found by the live end-to-end check, fixed in v1.0.1).
- 🔒 **Secrets:** no real secrets in the repository, only `.env.example` files and the local-only Docker defaults in `docker-compose.yml`; the production database URL lives only in Render's settings. Logs redact cookies, authorization headers and `Set-Cookie`; the API refuses to start with invalid configuration.

## 💰 Fare model

### 🚘 Sharing is automatic
- 🔁 Every ride can be shared: there is no "solo" option to choose.
- ⚡ Within a couple of seconds, the matching round puts the passenger into a car on its way that fits (right route, stop not passed, seats free), choosing for all waiting riders together; on a tie, the nearest car, then the older trip.
- ⏳ If nothing fits, the request waits and drivers see it with the reason.

### 🧮 The three formulas
| Who | Formula |
|---|---|
| 🧑 **Passenger pays** | `(৳30 + direct km × ৳15) × seats`, then **× 0.8** if they shared at least one hop |
| 🚗 **Driver earns** | `km driven with a passenger on board × ৳10` **+** `pickups × ৳20` |
| 🏢 **Platform keeps** | `all passengers' fares − driver earnings` |

### 📏 Passenger fare rules
- 📍 **Direct distance only:** the fare uses the straight zone-to-zone km, so nobody pays for the route's detour.
- 🪑 **Per seat:** two seats cost twice as much.
- 🤝 **Sharing = at least one hop together** with another rider who was really in the car. Cancelled riders and no-shows never count.
- 🔄 **Handing over a seat is not sharing:** getting on at the stop where someone else gets off gives no discount to either.
- 🧾 **The estimate is the maximum:** the price shown at request time is the solo fare. The final fare can only be the same or 20% lower.
- 🔒 **Locked at drop-off:** that is when it is known who you rode with.
- 💰 **Integer paisa:** money is never a floating-point number. Every subtotal is a multiple of ৳5, so 20% off is always whole taka.
- 💵 **Cash:** paid to the driver at drop-off.
- 💸 **Late-cancel fee:** ৳20 once the car is coming straight to your stop or is there (2-minute grace after getting the seat); a no-show costs the same. Paid with your next ride's cash.

### 🚗 Driver pay rules
- 🛣️ **Paid for the work, not from the fares:** a sharing discount never comes out of the driver's pocket.
- 📐 **Each hop counted once:** a hop with three passengers is still paid once.
- 👥 **More riders, more pay:** every pickup adds ৳20.
- 🚫 **A no-show is not a pickup,** so it is not paid as one; the rider's ৳20 fee goes to the driver instead.
- 💸 **Late-cancel fees are the driver's:** the platform pays them to the driver who came, and a driver who collects an earlier rider's fee in cash hands it to the platform. The trip's own split (`collected = driver + platform`) stays exactly as proven.
- 🔒 **Locked with the trip:** when the last passenger gets off, the trip stores what was collected, the driver's earnings and the platform fee. A database CHECK makes sure `collected = driver + platform`.

### 🏢 Platform rules
- 💼 **Keeps the difference:** the discount is paid for by the extra passengers in the car.
- 🧾 **Cash rides:** the platform fee is what the driver owes the platform (recorded per trip, shown on the driver's screen).
- 🛡️ **No loss on any trip:** routes only sell trips that add at most 2 km or 40% to the direct distance. A unit test runs every trip each route can sell, alone and in every group of up to three bookings (about 25,000 cases): the platform always keeps at least ৳10.

### 📊 Worked examples (route Uttara → Bashundhara)
| Passenger | Trip | km | Estimate (solo) | Final |
|---|---|---:|---:|---:|
| Nusrat | Banani → Mohakhali | 3 | ৳75 | ৳60 (shared a hop) |
| Rafiq | Banani → Gulshan 1 | 4 | ৳90 | ৳72 (shared a hop) |
| Shirin | Mohakhali → Bashundhara, joins on the way | 7 | ৳135 | ৳108 (shared a hop) |

| Trip | 🧑 Collected | 🚗 Driver | 🏢 Platform |
|---|---:|---:|---:|
| Nusrat alone (3 km carried, 1 pickup) | ৳75 | ৳50 | ৳25 |
| Nusrat + Rafiq (6 km, 2 pickups) | ৳132 | ৳100 | ৳32 |
| The story: Nusrat, Rafiq, Shirin (12 km, 3 pickups) | ৳240 | ৳180 | ৳60 |

### ✅ Why all three come out ahead
- 🧑 **Passengers** pay 20% less when they share, and never more than the estimate.
- 🚗 **The driver** earns by the km and the pickup, so a fuller car always pays more. In the story trip: ৳180, 75% of the fares.
- 🏢 **The platform** keeps the rest, never below ৳10 on any trip it sells. In the story trip: ৳60.

## 🧭 Routes and matching rules

- 🛣️ Tesla Pool drives **three fixed lines**, each in both directions (**six routes**):

| Line | Stops |
|---|---|
| Airport Road | Uttara → Banani → Mohakhali → Gulshan 1 → Gulshan 2 → Bashundhara |
| Mirpur | Uttara → Mirpur 12 → Mirpur 11 → Mirpur 10 → Mirpur 2 → Mirpur 1 → Farmgate → Dhanmondi |
| Tejgaon | Banani → Mohakhali → Tejgaon → Farmgate → Dhanmondi |

- ✅ A request joins a trip only if **all four** hold, checked again under the vehicle lock:

| Rule | Meaning |
|---|---|
| **R1** On the route, not too far round | The route passes the pickup, then the destination, and adds at most 2 km or 40% to the direct distance |
| **R2** Not passed | The car is at, or has not yet reached, the pickup stop |
| **R3** Seats | Free seats ≥ seats requested |
| **R4** Active | The trip is still running and the driver is online |

**📍 Where the car is**
- On a trip: the trip's current stop (where it stands, or the next stop it drives to).
- Between trips: the car's zone on its route (set by the driver once, then updated at every stop).
- **Approach km** = how far the car drives along its route to reach a pickup. A pickup behind the car has no approach km: a car never drives backwards.

**🎯 How a request finds a car**
- 🧮 **Batch matching (v1.4.0):** every 2 s (`MATCH_INTERVAL_MS`) one round takes **every** waiting request and **every** running trip with a free seat, and decides all the seats together. A request asked a moment ago answers `REQUESTED`; its seat follows within one round, and the screen updates live.
  - **Why together:** placing one request at a time can give an early rider a seat a better plan needed. Example: Jashim at Banani and Rahim at Uttara have 2 free seats each; R1 and R2 wait at Banani, R3 at Mohakhali, and R4 needs 2 seats from Uttara. One at a time puts R1 and R2 with Jashim and R3 with Rahim, and R4 is a seat short (3 seats moved). Together, Rahim's seats are kept for R4, the only rider no other car can reach (4 seats moved).
  - **How:** the method of Alonso-Mora et al. (PNAS 2017), reduced to a fixed one-way route. (1) Which trip could take which request (R1–R4). (2) For each trip, every group it could take together, built one size at a time; a group is checked only if every smaller group inside it fits. (3) At most one group per trip and each request once, with the best score, by an exact branch-and-bound search. The route fixes the order of pickups and drop-offs, so the costly ordering step of the paper does not exist here.
  - **Score, in order:** seats of riders waiting 5+ minutes (nobody waits for ever), then seats filled, then the shortest drive to the pickups (nearest car), then who waited longer; the older trip wins an exact tie.
  - **Safe even when stale:** the plan is not a write. Each trip in it is applied in its own transaction under that car's lock, and each seat is checked again (R1–R4, compare-and-set) inside a savepoint. A ride cancelled, taken or passed since the plan only loses that one seat; the rest stands, and the ride waits for the next round.
  - **One matcher, not four triggers:** it replaces the separate seating on a new request, on a freed seat, after an accept and after a driver's cancel. Two earlier bugs (D-021, D-022) were each a missing trigger; with one round over everything, that kind of bug cannot happen.
- 🚗 **A new trip starts where the car is:** when an idle driver accepts, the trip begins at the car's own stop and the car drives stop by stop to the pickup, able to take others on the way. A pickup behind the car is refused ("Behind your car"), and so is a car that is not on its route ("set your location first").
- 🧭 **Route choice:** the driver picks a route before going online (the system suggests the one with the most riders waiting ahead); it must pass the car's zone, and it stays fixed until the trip ends.
- 📋 **The driver's list, best first:** requests the driver can take and that have waited 5+ minutes (oldest first, so nobody waits for ever), then the others they can take by nearest pickup, then those they cannot take, each with the reason.
- ⏳ **Waiting:** a request that fits a running trip is the matcher's and is shown to **no** driver, so no tap can undo the plan; a request that fits none waits and is shown to the idle drivers who can take it (a trip's first passenger).
- ❌ **Cancelling:** passengers can cancel until they are picked up; the driver can cancel only before the first pickup, and then everyone goes back to waiting, with no fee.
  - 🔁 Riders sent back by a driver's cancel are offered again at the next round: a running car that fits takes them, otherwise every idle car that can take them sees them.
  - A cancel frees the seat at once, closes the trip if it is now empty, and never raises a co-rider's fare (sharing counts only riders who were in the car).
  - 💸 **Late cancel ৳20:** once the car is coming straight to the rider's stop or is there (after a 2-minute grace from getting the seat), a cancel or a no-show costs ৳20, all of it for the driver who came. It is paid in cash with the rider's next ride.
  - A cancel racing the driver (accept, pickup, no-show, trip cancel) is decided under the same vehicle lock: exactly one wins, and the other side is told why. Cancelling twice returns the cancelled ride instead of an error.
- ♻️ **Freed seats are refilled:** after a cancel, a no-show or a drop-off, the next round offers the seat to waiting riders who fit, by the same score.
- 📡 **Idle cars get requests by broadcast:** a request that fits no running trip goes to every driver whose car can take it; the first to accept gets it, and it leaves the others' screens at once.
- 🧲 **After the first accept, the system seats the rest:** the next round sees the new trip and every rider waiting for it, whatever order the accept and the requests arrived in.

## 🔒 Concurrency: Bullet's last seat

- 🎯 **The case:** Bullet has one seat left, and Nusrat and Shirin claim it at the same instant.
- 🧵 **Now: "one vehicle = one line".** Every change to a vehicle's seats or trip runs in a transaction that first locks that vehicle's row (`SELECT … FOR UPDATE`, `lock_timeout` 3 s), so two actions on the same car run one after the other, never together.

**What happens, step by step**
1. 📥 Both requests are stored, as separate rows: neither is lost. The next matching round sees both and plans one of them into the seat (v1.4.0).
2. 🚦 Applying the plan takes Bullet's lock and re-checks the rules (R1–R4) on the locked data before the seat is taken. The other rider stays **REQUESTED**: not dropped, and offered again next round.
   - The lock is what makes this safe, not the plan. If two matchers ran at once (two API instances), each sure the seat was its rider's, they would queue on Bullet's lock and only the first would get it. The tests apply conflicting plans in parallel to prove exactly this (2 riders, and 20 riders, for one seat).
3. 🛡️ Two database guards back this up even if the code had a bug: the seat update itself only succeeds if there is still room (`seats_taken ≤ capacity − n`, trip still active, car not past the pickup), and `CHECK seats_taken ≤ seat_capacity` refuses anything else. A compare-and-set on the request status means one request can never take two seats.
4. 🔁 The same lock serialises the en-route case: "the car leaves Mohakhali" and "Shirin is seated at Mohakhali" can never both succeed.

**The other side: two drivers, one request**
- 🙋 **The case:** Nusrat's request fits two idle cars, and Jashim and Rahim tap Accept at the same instant.
- 🔐 Each accept locks only its own car, so the two never wait on each other's car. Each ends with a compare-and-set `REQUESTED → MATCHED` on Nusrat's request.
- ✅ PostgreSQL's row lock on that one request lets exactly one update through. The other sees `MATCHED`, and its whole transaction rolls back, including the empty trip it had just started. That driver gets `409 ALREADY_TAKEN` "Another driver took this request".
- 📡 Every other screen drops the request over Server-Sent Events almost at once (80 ms in Docker, about 1.4 s end to end on the free live hosting), so late taps are rare.
- 🧾 **Two passengers at the same instant:** both requests are always stored, because they are separate rows. The only contest is for the seat, settled above.

**Proof**
- 🧪 Tested with exactly this case (Nusrat and Shirin, five rounds), with 20 riders racing for the last seat (one wins, 19 keep waiting) and with the leave/join race.
- 🧪 Two drivers accepting the same request, five rounds: always one `200` and one `409`, one seat, and no empty trip left behind. Measured in the browser: the request left the other driver's screen in 80 ms.
- 🔓 No deadlocks: a transaction takes at most one vehicle lock, and takes it first. A deadlock needs a transaction to hold one lock while waiting for another, and that state never arises here. Refilling a freed seat then locks waiting rides with `SKIP LOCKED`, which never waits, and a passenger's own cancel of a waiting ride is a single compare-and-set that holds no other lock. A lock wait over 3 s returns `503 BUSY` instead of hanging.

**At larger scale**
- 📈 The lock is per vehicle, so different cars never block each other and seat safety needs no distributed lock.
- 🧰 What changes is everything around it: more API instances, a connection pooler, reads moved off the primary, idempotent retries, and live updates relayed across instances (next section).
- 🎯 Broadcast becomes **sequential offers**: offer the nearest driver first for a few seconds, then widen, so drivers stop racing for the same tap. The compare-and-set stays as the final guard, and an idempotency key makes a retried accept safe.

## 📈 Bonus: if Oi Tesla goes viral (1M passengers, 100k drivers)

**🔢 First, the numbers**
- 🧑‍🤝‍🧑 If 20% of passengers ride twice a day: about **400,000 rides a day**, about 60,000 in the busiest hour, so **~17 seat decisions per second**. PostgreSQL handles that easily.
- 📍 The heavy load is elsewhere: 100k drivers sending a location every 4 s is **25,000 writes/s**.
- 🔁 Screens polling every 3 s would be **~67,000 requests/s**, mostly "no change". That is why screens get pushed hints over SSE today and poll only as a fallback.
- 🎯 So the plan keeps the seat decision where it is and moves the high-volume, low-value traffic away from it.

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
| Real-time communication | SSE hints are built (D-020). At scale, feed them from `LISTEN/NOTIFY` or a Redis/NATS channel so every API instance hears every change, and send per-user topics so only affected screens refetch. |
| Rate limiting | Per user and per IP at the load balancer (today only sign-up and login are limited, per client IP), stricter on ride requests and driver actions. |
| Idempotency | An `Idempotency-Key` header on every write; the first response is stored with the key and returned for any retry, so a double tap on a slow network never books twice. |
| Retry and failure strategy | A lock wait over 3 s already returns `503 BUSY`; clients retry with backoff and the same idempotency key. Matching is best effort: a seat that cannot be taken in a round simply waits for the next one. Health checks remove broken instances. |
| Observability | Already structured JSON logs with a request id per request. Add metrics (seat decisions/s, lock waits, `BUSY` rate, p95 latency), tracing across web → API → database, and alerts on `BUSY` spikes. |
| Security | httpOnly Secure cookies, hashed session tokens and passwords, role and ownership checks (as today); add secrets in a manager, WAF and bot protection at the edge, audit logs for money changes, and least-privilege database users. |
| Deployment strategy | Build once, migrate with backward-compatible migrations (add column → deploy → backfill → enforce), then roll out gradually (blue/green or canary) with automatic rollback on error-rate alerts. |

- 🚫 What we would **not** add without a measured reason: microservices per feature, Kubernetes for a handful of services, or a queue in front of every write.

## 📌 Key decisions and trade-offs

| Decision | Trade-off we accepted |
|---|---|
| En-route pooling on fixed routes: a Tesla picks up anyone ahead on its route until full | Only trips a route carries without going far round are sold (72 of 102 zone pairs); more routes would serve the rest |
| One row lock per vehicle + database guards | Actions on the same car wait in line (fine: one car is in one place); no distributed locks or queues |
| Estimate = solo fare; −20% if you shared a hop; locked at drop-off | The final fare is known only at drop-off, but it can only go down |
| Driver paid for the work (৳10/km carried + ৳20/pickup), platform keeps the rest | Platform margin varies per trip; proven never below ৳10 by an exhaustive test |
| The system suggests a route, the driver decides | No automatic dispatch without live GPS |
| Matching by the car's position: nearest car first, trips start at the car, 5-minute aging on the driver's list | Greedy, one request at a time; idle cars are reached through the driver's list, not offered automatically |
| Cancel is idempotent and decided under the vehicle lock; a late cancel costs ৳20, paid with the next ride | A rider who never rides again never pays the fee; in return nobody is asked for cash without a ride, and the driver who came is still paid |
| A freed seat goes straight to a waiting rider | Riders are seated without being asked; in return nobody waits for a driver's tap while a seat is empty |
| Batch matching every 2 s instead of one request at a time (v1.4.0) | A rider waits up to one round (about 1 s on average) before getting a seat, and a request a running trip can take is hidden from drivers so no tap undoes the plan; in return the most people ride, and one matcher replaces four separate triggers |
| No seat hold: a fitting request takes its seat at once | The driver does not approve each join; they keep control through the route, accept, no-show and cancel |
| Live hints over SSE, data refetched by each screen | One small refetch per hint per open screen; in return no ride data travels in events, and polling still works if the stream drops |
| Broadcast to idle drivers, first accept wins | Drivers can race for the same tap (settled by the compare-and-set; the late one is told why); in return a request is filled by whoever is free first |
| Sessions in the database through a same-origin proxy | One database lookup per request; no CORS, revocable sessions |
| Account type chosen first; separate passenger and driver sign-up | Two endpoints and two forms to keep in step; each gets only the fields it needs, and a client can never pick its own role |
| Pull requests with CI gates and merge commits into a protected `master` | Slower than pushing directly; the history shows every step |

## 🚧 Known limitations

- 🗺️ **No live GPS or maps.** Dhaka is 14 zones and 6 fixed routes; the car's position is the stop the driver reports. 30 of the 102 zone pairs on a route are not sold because the route goes too far round.
- 🎯 **Matching is greedy and only among running trips.** A request is matched the moment it arrives, to the nearest car already on a trip; an idle car nearby only sees it in its list. Approach km is measured from the stop the car stands at or drives to, not from a live GPS position. The empty drive to the first pickup is not paid.
- 🪑 **Seats are counted per trip, not per stretch.** Anyone not yet dropped off holds their seat, so a join that would fit later on the route can be refused until someone gets off.
- ⏱️ **Driver pay has no time component.** No per-minute rate for traffic, no pay for driving to the first pickup or empty stretches, no surge or incentives.
- 💵 **Cash only.** The platform fee is recorded per trip, not collected.
- 🔁 **Live updates need a single API instance.** The event bus is in-process, so a second API instance would not hear the first one's changes (its screens would fall back to polling). The fix is `LISTEN/NOTIFY` or Redis behind the same interface.
- 🔂 **No idempotency key.** A retried request gets a `409` rather than the original answer.
- ⌛ **Requests do not expire.** A waiting request stays until it is matched or cancelled.
- 💸 **The late-cancel fee is only as good as the next ride.** It is paid in cash with the rider's next ride, so someone who never rides again never pays it. Requesting and cancelling is not rate-limited.
- 🧪 **Demo helpers.** The login page has one-click demo accounts and the demo password is public; both are for the reviewer and must be turned off in a real deployment. Drivers sign up on their own: their documents are stored but not yet checked by a person, and phone numbers are not verified (no OTP yet).
- 🗑️ **Expired sessions are rejected but not deleted;** a cleanup job is not built.
- 🚦 **Rate limit on direct API calls.** Through the web app the client address cannot be faked, but a caller who hits the API URL directly could send a fake `X-Forwarded-For` to dodge the login limit. The fix is a gateway rate limit or accepting API traffic only from the web proxy.
- 📉 **No load test yet.** Correctness under races is tested, but not throughput: how many riders and drivers at once the free Render and Neon tiers can serve is unknown.
- 😴 **Hosting.** The free API tier sleeps when idle (slow first request), and the API image is large (~790 MB) because it includes the Prisma CLI to run migrations at start.

## 🚀 Next improvements

- 🛠️ Each one, with how we would build it:

| Improvement | How |
|---|---|
| **Offers to idle cars** | Batch matching (v1.4.0) seats riders in running trips. Idle cars still get a trip's first passenger by broadcast. Next: offer the best request to one idle nearby car, which accepts within a few seconds or the offer moves to the next car, so drivers stop racing for the same tap. The seat is still taken under each car's lock. |
| **Batch matching at city scale** | Built in v1.4.0 for running trips: an exact search over each round's requests, which takes milliseconds at this size. At city scale: run it per area, find candidate cars with a geo index (H3 cells or PostGIS), use live ETAs in place of route km, swap the exact search for an ILP solver with a time limit behind the same `planAssignment` function, elect one instance per round, and count seats per stretch of the route so the group-pruning rule starts removing groups. The solver's output stays a plan, not a write. |
| **Live updates across instances, and sequential offers** | Back `RealtimeService` with PostgreSQL `LISTEN/NOTIFY` (then Redis or NATS) so every instance relays every change, and name a vehicle or ride in each hint. Replace the broadcast with an `offers` table (one row per request and driver, with an expiry): offer the nearest driver first, widen after a few seconds, and keep the compare-and-set as the final guard. |
| **Idempotency keys** | The client sends an `Idempotency-Key` header on `POST /rides` and driver actions. A new `idempotency_keys` table (user, key, request hash, response, time) with a unique index on (user, key); the response is stored in the same transaction as the change, and a retry with the same key gets the stored response. Keys expire after 24 h. |
| **Request expiry** | An `expires_at` on each request (e.g. 10 minutes) and a new `EXPIRED` status. Expired requests are skipped and marked under the lock at auto-join and accept, plus a small scheduled sweep for the rest. |
| **"Pause new joins" for drivers** | An `accepting_joins` flag on the pool, changed under the vehicle lock. R4 checks it, and the conditional seat update includes it, so no join slips in after a pause. |
| **Seats per stretch of the route** | Instead of one counter for the whole trip, check the busiest hop of the new rider's stretch: for [pickup, drop-off), the seats of everyone on board on each hop plus the new seats must stay within capacity. Computed under the lock from `pool_members`; the database guard becomes a per-hop row with its own CHECK. A car full to Mohakhali could then take someone from Mohakhali onwards in advance. |
| **More routes, live GPS and dispatch** | Add routes from real demand (the zone pairs we cannot sell today). The driver app sends its position every few seconds; a geo index finds nearby cars on routes that pass the pickup; the request is offered to the best car and the driver accepts within a few seconds, or it goes to the next. A Leaflet + OpenStreetMap map on both screens. |
| **Driver pay per minute and for dead km** | Store the arrive and depart time of each stop, add a per-minute rate and a small rate for driving to the first pickup, then re-run the exhaustive earnings test with the new rates before release, so no trip loses money. |
| **Fee by wallet, and a cancel limit** | With the TeslaPay wallet, the ৳20 late-cancel fee is taken at the moment of the cancel, in the same locked transaction, instead of waiting for the next ride. A per-passenger limit of 3 cancels after a match per hour, then a short cool-down. |
| **TeslaPay wallet** | A double-entry ledger table. Paying a fare and deducting the platform fee happen in one transaction with a conditional update (`balance >= amount`), so a balance can never go negative. |
| **Phone OTP** | At sign-up and on a new device: a 6-digit code by SMS, stored as a hash with a 5-minute expiry and 5 tries, then `phone_verified_at` on the user. Ride requests and going online need a verified phone. |
| **Document checks for drivers** | A `verification_status` on `driver_profiles` (pending → approved / rejected), photos of the NID or passport and the licence in object storage, and an admin screen. A driver goes online only when approved. |
| **JWT for mobile apps** | Keep the cookie session for the web. For native apps: a short-lived access JWT (15 min) and a rotating refresh token stored as a hash (like today's sessions), so logout and stolen-token revocation still work. |
| **Google sign-in** | OAuth 2.0 / OpenID Connect with Google: verify the ID token, link by verified email in an `auth_identities` table (provider, subject), then ask only for what Google does not give (phone, address, and for drivers the documents). |
| **Load test** | A k6 script that ramps up simulated riders and drivers (request, accept, every stop action, cancel) against a staging copy, never the free production tier. It reports p95 latency, error rate, `503 BUSY` from the vehicle lock and database connection use, and it should run before each release. |
| **Operations** | An admin view of trips and fees owed, a scheduled job that deletes expired sessions, and a `DEMO_MODE` flag that hides the demo buttons and skips demo accounts in production. |
| **Scale** | The steps in the Bonus section above, in that order: connection pooler, replicas for reads, push updates, then partitioning by city area. |

## 🤖 AI Usage

- 🧰 **Tool:** Claude (Anthropic), through Claude Code in VS Code.
- 🧭 **How the work was split:** I owned the product and the engineering decisions; Claude was my research partner and wrote the code to those decisions.

| | Me | Claude |
|---|---|---|
| Product and business | What to build, the USP (en-route pooling on fixed routes), the pricing rules and who earns what | Researched options, ran the numbers (e.g. every trip on every route for the fare split), pointed out risks |
| Architecture and design | The stack, the layered architecture, the data model, the concurrency approach, every rule for routes, matching and fares | Laid out the options with trade-offs and failure cases (race conditions, edge cases), and gave a recommendation |
| How the code is written | The rules the code must follow: controller → service → repository, one row lock per vehicle, database guards, money in integer paisa, tests against a real Postgres, readable code over clever code, one approved approach per feature | Wrote the code, tests, migrations and diagrams within those rules |
| Delivery | Approved each feature's approach before it was built, had every change explained before committing it, committed and merged through PRs with CI | Explained each change, ran the checks, kept the decision log up to date |

**🔄 How each feature went**
1. 💡 I described the problem and my first idea.
2. 🔍 Claude researched the options.
3. ✅ I chose, and the choice was recorded with the alternatives and the reason.
4. 🛠️ Claude implemented it, and I checked the result (tests, CI, the running app) before committing.

**🙅 Decisions where I went against the AI's recommendation**

| Topic | AI recommended | My decision and why |
|---|---|---|
| Backend framework | Fastify (lighter, built-in logging and validation) | **NestJS**: its module/controller/service structure enforces the layered architecture I wanted. |
| ORM | Drizzle | **Prisma**, with raw SQL only for the vehicle lock and the hand-written CHECK constraints. |
| En-route pooling | Keep same-zone pooling and defer en-route pickups, to meet the deadline | **Build it**: picking people up along the route until the car is full is the product. It shipped with its own race tests. |
| Fare split | The first model let the driver keep all cash, so the sharing discount was the driver's loss | **Three-party model**: I set the rule that the driver must never pay for a discount and the platform must earn. The driver is paid for the work, and a test over every possible trip proves nobody loses money. |

**⚖️ One suggestion accepted, one rejected** (the PRD's format)

- ✅ **Accepted: "one vehicle = one line".** Every change to a vehicle's seats or trip locks that vehicle's row, backed by CHECK constraints and partial unique indexes. I chose it over Redis locks, queues and serializable transactions because the database guarantees correctness even if the code has a bug, it needs no extra infrastructure, and it can be tested with real races (20 riders for the last seat, "the car leaves" against "a rider joins at that stop").
- ❌ **Rejected: a 60-second seat hold where the driver confirms every join** (option Y). In en-route pooling the driver is driving between stops; asking them to tap within 60 seconds is unsafe, leaves the rider unsure, and brings back a HELD state and new races. A fitting request takes its seat at once instead.

**🔎 What I checked myself**
- 🧪 The core rules are backed by tests: 86 unit and 95 end-to-end tests against a real PostgreSQL, including the races and one full journey from sign-up to the driver's earnings.
- 🤖 CI (lint, types, unit, e2e, Docker build) must pass before anything reaches `master`, which is protected.
- 🕵️ A final audit of the whole system found one real race (a passenger's cancel against the driver's trip cancel). It was fixed and tested before release.
- ❌ A later audit of the passenger cancel ran every race around it as real parallel requests. The data was always right, but three answers were wrong: a double tap got `409`, a cancel racing a no-show got `409`, and a driver racing a cancel was not told the rider cancelled. All three were fixed and tested (D-016). The same run exposed a flaky test (too much work for vitest's 5 s limit), which was split up rather than retried.
- 🌐 A live end-to-end check through the public URL (63 checks, including the races over the real network) found that the login rate limit did not count the real client behind Vercel and Render. It was fixed and re-checked live (v1.0.1).
- 🔐 No secrets, keys or personal data were given to the AI. Demo accounts use the reserved `.test` domain.

## 🎬 Demo video

- 🎥 **Watch:** https://www.youtube.com/watch?v=eTIudjhgNjY
