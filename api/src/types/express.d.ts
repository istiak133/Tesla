import type { PublicUser } from '../auth/auth.types.js';

// Tells TypeScript that Express requests may carry the logged-in user
// (set by SessionAuthGuard).
declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export {};
