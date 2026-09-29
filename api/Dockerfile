# ---------- Stage 1: install all dependencies and build ----------
FROM node:24-alpine AS build
WORKDIR /app

# The Prisma schema and config are needed before `npm ci`,
# because the postinstall script runs `prisma generate`.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Keep only the packages needed at runtime.
RUN npm prune --omit=dev


# ---------- Stage 2: small runtime image ----------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

# Do not run as root inside the container.
USER node

EXPOSE 3001

# Apply pending migrations, upsert the demo cast (safe to repeat), then start the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed/seed.js && node dist/main.js"]
