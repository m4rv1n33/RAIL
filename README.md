# RAIL Ticket System

RAIL Ticket System is a TypeScript monorepo with three main apps:
- API service for auth, settings, tickets metadata, and dashboard endpoints
- Discord bot for ticket workflows, transcript generation, media backup forwarding, and command handling
- Dashboard web app for teams, categories, panels, and transcripts management

Branding used across the project:
- RAIL Ticket System
- Powered by RAIL, built by @m4rv1n_33

## Repository layout

- `apps/api` Express API
- `apps/bot` Discord bot
- `apps/dashboard` React + Vite dashboard
- `packages/db` Prisma schema, migrations, and DB package
- `packages/shared` shared types and validators
- `data/guild-settings.json` guild level settings storage

## Prerequisites

- Node.js 20+
- npm 10+
- MySQL compatible database for Prisma
- A Discord application with bot + OAuth2 configured

## Install

```bash
npm install
```

## Environment setup

Create env files for each app before running locally.

### API (`apps/api/.env`)

Required:
- `PORT` (example `3001`)
- `SESSION_SECRET`
- `DASHBOARD_ORIGIN` (example `http://localhost:5173`)
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI` (example `http://localhost:3001/auth/callback`)
- `DISCORD_BOT_TOKEN`

Internal API bridge for panel publish and force close:
- `BOT_INTERNAL_URL` (example `http://localhost:3002`)
- `BOT_INTERNAL_SECRET`

Optional:
- `SUPERUSERS_JSON`
- `DEV_BYPASS_USER_ID` (do not use in production)
- `DISCORD_LOG_WEBHOOK_URL`
- `DISCORD_LOG_CHANNEL_ID` (fallback when webhook fails)

### Bot (`apps/bot/.env`)

Required:
- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_GUILD_ID`

Internal server:
- `PORT` (or `INTERNAL_PORT`)
- `BOT_INTERNAL_SECRET` (must match API)

Dashboard transcript links:
- `DASHBOARD_URL` or `PUBLIC_DASHBOARD_URL` or `DASHBOARD_ORIGIN`

Optional:
- `TRANSCRIPT_CHANNEL_ID`
- `MEDIA_FORUM_CHANNEL_ID`
- `ATTACHMENT_FORUM_CHANNEL_ID`
- `ATTACHMENT_ARCHIVE_CHANNEL_ID`
- `MEDIA_ARCHIVE_CHANNEL_ID`
- `SUPERUSERS_JSON`
- `DEV_BYPASS_USER_ID` (do not use in production)
- `DISCORD_LOG_WEBHOOK_URL`
- `DISCORD_LOG_CHANNEL_ID` (fallback when webhook fails)
- `TEAM_AUTOCOMPLETE_CACHE_TTL_MS`
- `ATTACHMENT_STORAGE_CACHE_TTL_MS`

Note: the current bot code includes a hardcoded media backup channel id. Update or remove that before production if you need full env based control.

### Dashboard (`apps/dashboard/.env`)

Required:
- `VITE_API_BASE` (example `http://localhost:3001`)
- `VITE_GUILD_ID`

Optional log relay for Vite process:
- `DISCORD_LOG_WEBHOOK_URL`
- `DISCORD_BOT_TOKEN`
- `DISCORD_LOG_CHANNEL_ID`

## Database

Generate Prisma client:

```bash
npm run db:generate
```

Run migrations:

```bash
npm run db:migrate
```

## Run locally

Use separate terminals:

```bash
npm run dev:api
npm run dev:bot
npm run dev:dashboard
```

## Build

Build all packages and apps:

```bash
npm run build
```

Or build specific apps:

```bash
npm run build -w @rail/api
npm run build -w @rail/bot
npm run build -w @rail/dashboard
```

## Access model

Dashboard access is role based:
- Staff role `1406675931589902466` can access transcripts view
- Management roles `1407413756971188346` and `1469431145161818123` can access teams, categories, panels, and settings
- Discord administrators can access management views
- Superuser has additional privileged actions such as force close and delete all transcripts

## Recent Updates

- Added ticket participant management commands:
	- `/add account:<user>`
	- `/remove account:<user>` or `/remove role:<role>`
- Added force unclaim command:
	- `/forceunclaim` (superusers and Discord administrators only)
- Added inactivity override command:
	- `/autoclose exclude` to exempt a ticket from inactivity warning/auto-close checks
- Added ticket creation blacklist support for role `1478457037607403610`
- Added transcript access filtering by support-team role hierarchy
- Added configurable claimer bypass roles (dashboard settings)
- Improved mobile OAuth reliability with signed auth-token fallback in addition to session/cookie auth

## Dashboard Settings

Guild settings now include:
- `transcriptChannelId`
- `mediaForumChannelId`
- `claimerBypassRoleIds` (roles that can manage claimed tickets without being the claimer)

## Logging relay

API, bot, and dashboard Vite relay follow this order:
1. Try `DISCORD_LOG_WEBHOOK_URL`
2. If webhook fails and fallback config exists, send via bot token and channel id
