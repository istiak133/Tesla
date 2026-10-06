# Dhaka Tesla Pool: web

The Next.js web app. It calls the API through its own `/api/*` path (proxied in `next.config.ts`),
so the session cookie stays first-party. Setup and everything else is in the [root README](../README.md).

```bash
npm install
npm run dev            # web on :3000 (needs API_URL, see .env.example)
npm test               # unit tests (lib/)
```
