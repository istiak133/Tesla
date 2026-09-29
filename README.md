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
- Role-based access (passenger / driver) and rate-limited login
- 14 Dhaka zones with a whole-kilometre distance table, and the fare and detour rules (unit-tested with the PRD examples)
- Seed data with the story cast (Jashim the driver, Nusrat, Rafiq, Shirin)
- Health endpoint with a real database check (`GET /health`)
- Structured JSON logging with a request id per request
- Environment validation at startup (the app refuses to start with bad config)
- Same-origin `/api` proxy from the web app to the API
- One-command local run with Docker Compose, plus CI on every pull request
- Ride requests with a solo fare estimate; automatic join into the oldest compatible open pool
- Drivers go online, see waiting requests (with the reason if they cannot take one) and accept them
- Seat capacity protected against concurrent requests (vehicle row lock + database CHECK), tested with eight riders racing for the last seat
- Passenger cancellation before the trip starts; an empty pool closes itself; full status history per ride
- Trip lifecycle driven by the driver: arrive → start (final fares locked, 20% pool discount if 2+ passengers) → complete, or cancel before the start (passengers go back to waiting)
- Invalid transitions rejected with 409; every change recorded in the ride history
- Web app for passengers and drivers: live status (polling every 3 s), loading / error / empty states, demo-account buttons on the login page

## Screenshots

| Login with demo accounts | Rafiq auto-joined Nusrat's pool |
|---|---|
| ![Login](docs/screenshots/login.png) | ![Passenger matched](docs/screenshots/passenger-matched.png) |

| Jashim's trip: 2 of 3 seats | Nusrat's fare locked at ৳60 after the start |
|---|---|
| ![Driver pool](docs/screenshots/driver-pool.png) | ![Fare locked](docs/screenshots/passenger-fare-locked.png) |

## Architecture

- System overview (one page): [`docs/system-overview.pdf`](docs/system-overview.pdf)
- One ride end to end: [`docs/ride-flow.pdf`](docs/ride-flow.pdf)
- Architecture and consistency model: [`docs/architecture.md`](docs/architecture.md)
- Database design (ERD, constraints, indexes): [`docs/erd.md`](docs/erd.md)
- State machines: [`docs/state-machine.md`](docs/state-machine.md)
- Every design decision with its reasoning: [`decisions.md`](decisions.md)

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
├── docs/                 architecture, ERD, state machines, diagrams
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
| POST | `/auth/login` | Log in with email and password (sets the session cookie); 5 attempts per minute |
| POST | `/auth/logout` | End the session and clear the cookie |
| GET | `/auth/me` | The logged-in user |
| GET | `/zones` | The 14 zones for pickup and destination |
| POST | `/rides` | Passenger: request a ride `{pickupZoneId, dropoffZoneId, seats}`; joins an open pool at once if one fits |
| GET | `/rides/current` | Passenger: the active ride (driver, co-riders' first names, fare, history) |
| GET | `/rides` | Passenger: ride history |
| GET | `/rides/:id` | Passenger: one of my rides (403 for someone else's) |
| POST | `/rides/:id/cancel` | Passenger: cancel before the trip starts |
| POST | `/driver/online`, `/driver/offline` | Driver: availability (offline refused during a trip) |
| GET | `/driver/requests` | Driver: waiting requests with `canAccept` and a reason |
| POST | `/driver/requests/:id/accept` | Driver: accept (creates the pool or adds to the open one) |
| GET | `/driver/pool` | Driver: vehicle and current trip with its passengers |
| POST | `/driver/pool/arrive`, `/start`, `/complete` | Driver: move the trip forward (409 out of order); start locks the fares |
| POST | `/driver/pool/cancel` | Driver: cancel before the start; passengers return to waiting |

Business errors return `{ statusCode, code, message }`, e.g. `409 SEATS_UNAVAILABLE`, `403 NOT_YOUR_RIDE`.

Through the web app every path is prefixed with `/api` (e.g. `/api/auth/login`).

More endpoints are added with each feature *(coming)*.

## Fare model

`(৳30 + km × ৳15) × seats`, minus **20%** if the pool has two or more passengers when the trip starts. The estimate shown at request time is the solo fare, so nobody pays more than they saw. Money is stored in integer paisa.

| Passenger | Trip | km | Estimate (solo) | Pooled with the other |
|---|---|---:|---:|---:|
| Nusrat | Banani → Mohakhali | 3 | ৳75 | ৳60 |
| Rafiq | Banani → Gulshan 1 | 4 | ৳90 | ৳72 |

Matching rules, detours and every other assumption: [`docs/assumptions.md`](docs/assumptions.md).

## Key decisions and trade-offs

See [`decisions.md`](decisions.md). A summary is added at release *(coming)*.

## Known limitations

- The API image includes the Prisma CLI so migrations can run at container start; free hosting tiers
  usually lack a separate migration step. This makes the image larger (~790 MB).
- More *(coming)*.

## Next improvements

*(coming)*

## AI Usage

*(completed at release)*

## Demo video

*(coming)*
