# Dhaka Tesla Pool: API

The NestJS API (Prisma, PostgreSQL). Setup, the API overview, the rules and the tests are in the
[root README](../README.md); the reasons for each design choice are in [decisions.md](../decisions.md).

```bash
npm install
npm run start:dev      # API on :3001 (needs DATABASE_URL, see .env.example)
npm test               # unit tests
npm run test:e2e       # end-to-end tests (needs the test database, see the root README)
```
