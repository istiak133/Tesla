# Dhaka Tesla Pool

Share a seat. Split the fare. Survive Dhaka traffic.

A ride-pooling MVP: passengers request rides, drivers accept them, and several passengers can share one
vehicle without ever exceeding its seats. Built around the PRD's cast: driver **Jashim** and his
three-seat **Bullet**, and passengers **Nusrat**, **Rafiq** and **Shirin**.

> **Status:** project foundation is in place (API, web app, database, Docker, CI). Feature work is in
> progress on `feature/*` branches. Sections marked *(coming)* are filled in as those features land.

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

```
Browser → Next.js (web, /api proxy) → NestJS (API) → PostgreSQL
```

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS |
| Backend | NestJS 12 (REST), TypeScript |
| Database | PostgreSQL 17, Prisma 7 (migrations, typed client) |
| Validation | class-validator / class-transformer |
| Logging | pino (nestjs-pino) |
| Tests | Vitest + Supertest, integration tests against real PostgreSQL |
| Tooling | Docker Compose, GitHub Actions |

The reasons behind each choice, the alternatives considered and what would make us switch are recorded
in [`decisions.md`](decisions.md). A summary is added here with the features *(coming)*.

## Project structure

```
.
├── api/                  NestJS API
│   ├── prisma/           schema and migrations
│   ├── src/
│   │   ├── config/       environment validation, logger setup
│   │   ├── database/     PrismaService (the single database client)
│   │   └── health/       GET /health (controller → service → repository)
│   └── test/             end-to-end tests
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

## Demo credentials

All demo accounts use the password **`tesla1234`** (local and demo use only).

| Name | Email | Role |
|---|---|---|
| Jashim | `jashim@teslapool.test` | Driver |
| Nusrat | `nusrat@teslapool.test` | Passenger |
| Rafiq | `rafiq@teslapool.test` | Passenger |
| Shirin | `shirin@teslapool.test` | Passenger |

## Deployment

*(coming)* Planned on free tiers: Vercel (web), Render or Koyeb (API), Neon (PostgreSQL).

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

More endpoints are added with each feature *(coming)*.

## Fare model

`(৳30 + direct km × ৳15) × seats`, minus **20%** if another passenger rode with you on at least one hop. The fare is locked when you are dropped off. The estimate shown at request time is the solo fare, so nobody pays more than they saw, and nobody pays for the route's detour. Money is stored in integer paisa.

| Passenger | Trip | km | Estimate (solo) | Final (shared a hop) |
|---|---|---:|---:|---:|
| Nusrat | Banani → Mohakhali | 3 | ৳75 | ৳60 |
| Rafiq | Banani → Gulshan 1 | 4 | ৳90 | ৳72 |
| Shirin | Mohakhali → Bashundhara (joins on the way) | 7 | ৳135 | ৳108 |

Taking over a seat at the stop where someone else got off is not sharing: both pay their solo fare.

**Who gets the money.** The driver is paid for the work, not from the fares: **৳10 per km** with a passenger on board **+ ৳20 per pickup**. The platform keeps the rest. So a sharing discount never comes out of the driver's pocket: it is paid for by the extra passengers. For the story trip, ৳240 is collected, Jashim earns ৳180 and the platform keeps ৳60. Routes only sell trips that add at most 2 km or 40% to the direct distance, and a unit test checks every trip every route can sell: nobody loses money (see D-010 in [`decisions.md`](decisions.md)).

Routes, matching rules (R1–R4) and every other assumption: [`docs/assumptions.md`](docs/assumptions.md).

## Key decisions and trade-offs

See [`decisions.md`](decisions.md). A summary is added at release *(coming)*.

## Known limitations

- The API image includes the Prisma CLI so migrations can run at container start; free hosting tiers
  usually lack a separate migration step. This makes the image larger (~790 MB).
- More *(coming)*.

## Next improvements

*(coming)*

## AI Usage

**Tool:** Claude (Anthropic), through Claude Code in VS Code.

**How the work was split.** I owned the product and the engineering decisions; Claude was my research partner and wrote the code to those decisions.

| | Me | Claude |
|---|---|---|
| Product and business | What to build, the USP (en-route pooling on fixed routes), the pricing rules and who earns what | Researched options, ran the numbers (e.g. every trip on every route for the fare split), pointed out risks |
| Architecture and design | The stack, the layered architecture, the data model, the concurrency approach, every rule in [`docs/assumptions.md`](docs/assumptions.md) | Laid out the options with trade-offs and failure cases (race conditions, edge cases), and gave a recommendation |
| How the code is written | The rules the code must follow: controller → service → repository, one row lock per vehicle, database guards, money in integer paisa, tests against a real Postgres, readable code over clever code, one approved approach per feature | Wrote the code, tests, migrations and diagrams within those rules |
| Delivery | Approved each feature's approach before it was built, had every change explained before committing it, committed and merged through PRs with CI | Explained each change, ran the checks, kept [`decisions.md`](decisions.md) up to date |

**How each feature went:** I described the problem and my first idea; Claude researched the options; I chose, and the choice was written down in `decisions.md` with the alternatives and the reason (D-001 to D-011); then Claude implemented it and I checked the result (tests, CI, the running app) before committing.

**Decisions where I went against the AI's recommendation**

| Topic | AI recommended | My decision and why |
|---|---|---|
| Backend framework | Fastify (lighter, built-in logging and validation) | **NestJS**: its module/controller/service structure enforces the layered architecture I wanted. |
| ORM | Drizzle | **Prisma**, with raw SQL only for the vehicle lock and the hand-written CHECK constraints. |
| En-route pooling | Keep same-zone pooling and defer en-route pickups, to meet the deadline | **Build it** (D-008): picking people up along the route until the car is full is the product. It shipped with its own race tests. |
| Fare split | The first model let the driver keep all cash, so the sharing discount was the driver's loss | **Three-party model** (D-010): I set the rule that the driver must never pay for a discount and the platform must earn. The driver is paid for the work, and a test over every possible trip proves nobody loses money. |

**One suggestion accepted, one rejected** (the PRD's format)

- **Accepted: "one vehicle = one line".** Every change to a vehicle's seats or trip locks that vehicle's row, backed by CHECK constraints and partial unique indexes. I chose it over Redis locks, queues and serializable transactions because the database guarantees correctness even if the code has a bug, it needs no extra infrastructure, and it can be tested with real races (20 riders for the last seat, "the car leaves" against "a rider joins at that stop").
- **Rejected: a 60-second seat hold where the driver confirms every join** (option Y). In en-route pooling the driver is driving between stops; asking them to tap within 60 seconds is unsafe, leaves the rider unsure, and brings back a HELD state and new races. A fitting request takes its seat at once instead (D-009).

**What I checked myself**
- Every claim is backed by a test: 52 unit and 39 end-to-end tests against a real PostgreSQL, including the races and one full journey from sign-up to the driver's earnings.
- CI (lint, types, unit, e2e, Docker build) must pass before anything reaches `master`, which is protected.
- A final audit of the whole system found one real race (a passenger's cancel against the driver's trip cancel). It was fixed and tested before release (D-011).
- No secrets, keys or personal data were given to the AI. Demo accounts use the reserved `.test` domain.

## Demo video

*(coming)*
