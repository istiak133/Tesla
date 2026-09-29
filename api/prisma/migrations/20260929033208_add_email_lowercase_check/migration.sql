-- Hand-written: Prisma schema cannot express CHECK constraints (see docs/erd.md).
-- Emails are normalised to lower case in the application; the database enforces it too.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
