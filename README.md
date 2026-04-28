# RAIL Ticket System

RAIL Ticket System is a TypeScript monorepo for Discord support operations.
It combines:

- An Express API for OAuth, dashboard endpoints, settings, and admin tooling
- A Discord bot for ticket lifecycle workflows and internal actions
- A React dashboard for teams, categories, panels, transcripts, and GDPR actions

## Monorepo structure

- `apps/api` API service (Express)
- `apps/bot` Discord bot service
- `apps/dashboard` Dashboard app (React + Vite)
- `packages/db` Prisma schema, migrations, and DB package
- `packages/shared` Shared validators/types used across apps
- `data/guild-settings.json` Runtime guild settings cache

## Core features

- Discord OAuth login + dashboard sessions
- Team and category management
- Ticket panel creation/publish and sync
- Ticket lifecycle controls (claim, unclaim, force-unclaim, close, inactivity handling)
- Transcript listing and detail view
- GDPR admin tools and retention cleanup jobs
- Internal API bridge between API and bot for panel publish / force-close actions

## Requirements

- Node.js 20+
- npm 10+
- MySQL-compatible database
- Discord application (OAuth2 + bot)

## Quick start

Install dependencies:

```bash
npm install
```

Generate Prisma client and apply migrations:

```bash
npm run db:generate
npm run db:migrate
```

Start the services in separate terminals:

```bash
npm run dev:api
npm run dev:bot
npm run dev:dashboard
```

## Build

Build everything:

```bash
npm run build
```

Build a single workspace:

```bash
npm run build -w @rail/api
npm run build -w @rail/bot
npm run build -w @rail/dashboard
```

## Environment variables

Create `.env` files per app.

### API (`apps/api/.env`)

Required:

- `PORT` (example: `3001`)
- `SESSION_SECRET`
- `DASHBOARD_ORIGIN` (example: `http://localhost:5173`)
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` (example: `http://localhost:3001/auth/callback`)
- `DISCORD_BOT_TOKEN`
- `BOT_INTERNAL_URL` (example: `http://localhost:3002`)
- `BOT_INTERNAL_SECRET`

Common optional:

- `DASHBOARD_ORIGINS` (comma-separated additional allowed origins)
- `SESSION_COOKIE_SECURE`
- `SESSION_COOKIE_SAMESITE`
- `SUPERUSERS_JSON`
- `DEV_BYPASS_USER_ID` (dev only)
- `AUTH_COOKIE_NAME`
- `SUPPORT_EMAIL`
- `DISCORD_LOG_WEBHOOK_URL`
- `DISCORD_LOG_CHANNEL_ID`

### Bot (`apps/bot/.env`)

Required:

- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_GUILD_ID`
- `BOT_INTERNAL_SECRET` (must match API)
- `PORT` or `INTERNAL_PORT` (example: `3002`)

Common optional:

- `DASHBOARD_ORIGIN` / `DASHBOARD_URL` / `PUBLIC_DASHBOARD_URL`
- `TRANSCRIPT_CHANNEL_ID`
- `MEDIA_FORUM_CHANNEL_ID`
- `ATTACHMENT_FORUM_CHANNEL_ID`
- `ATTACHMENT_ARCHIVE_CHANNEL_ID`
- `MEDIA_ARCHIVE_CHANNEL_ID`
- `TICKET_INACTIVE_WARN_HOURS`
- `TICKET_INACTIVE_CLOSE_HOURS`
- `TEAM_AUTOCOMPLETE_CACHE_TTL_MS`
- `ATTACHMENT_STORAGE_CACHE_TTL_MS`
- `RENAME_MIN_INTERVAL_MS`
- `SUPERUSER_SHOW_IDS`
- `SUPERUSERS_JSON`
- `DEV_BYPASS_USER_ID` (dev only)
- `DISCORD_LOG_WEBHOOK_URL`
- `DISCORD_LOG_CHANNEL_ID`

### Dashboard (`apps/dashboard/.env`)

Required:

- `VITE_API_BASE` (example: `http://localhost:3001`)
- `VITE_GUILD_ID`

## Access model summary

- Transcript-only access: staff-level role
- Management access: management roles and Discord administrators
- Superuser: additional privileged actions (for example, global transcript deletion and forced actions)

Exact role IDs are configured in code and/or runtime settings for your deployment.

## Notes

- Keep secrets out of source control.
- Prefer webhook-based logging (`DISCORD_LOG_WEBHOOK_URL`) when available.
- If panel publish fails, verify `BOT_INTERNAL_URL` and `BOT_INTERNAL_SECRET` on both API and bot.
