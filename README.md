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

- Health endpoint with a real database check (`GET /health`)
- Structured JSON logging with a request id per request
- Environment validation at startup (the app refuses to start with bad config)
- Same-origin `/api` proxy from the web app to the API
- One-command local run with Docker Compose, plus CI on every pull request
- Ride, pooling, driver and passenger features *(coming)*

## Screenshots

*(coming)*

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
| [`api/.env.example`](api/.env.example) | API outside Docker | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `DATABASE_POOL_MAX` |
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
Seed data with the story cast *(coming)*.

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

*(coming, with seed data)*

## Deployment

*(coming)* Planned on free tiers: Vercel (web), Render or Koyeb (API), Neon (PostgreSQL).

## API overview

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `200 {"status":"ok","database":"up"}` or `503` when the database is unreachable |

More endpoints are added with each feature *(coming)*.

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
