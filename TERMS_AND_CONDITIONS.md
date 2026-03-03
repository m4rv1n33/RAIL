# UKRRP Ticket System — Terms and Conditions

_Last updated: March 3, 2026_

## 1) Acceptance of Terms
By using the UKRRP Ticket System Discord bot, dashboard, or related services, you agree to these Terms and Conditions.

## 2) Service Purpose
The bot is used to create and manage support tickets in Discord, including ticket routing, claim/close workflows, transcript generation, and optional media backup handling.

## 3) Data the Bot and Services Collect
To operate correctly, the system may collect and process the following data:

### A) Discord Account and Identity Data
- Discord user IDs
- Discord usernames/display names (where available)
- Role IDs and membership information used for permission checks
- Guild/server IDs and channel IDs

### B) Ticket and Workflow Data
- Ticket ID and ticket number
- Ticket owner ID and claimer/support actor IDs
- Category and support team linkage
- Ticket status, timestamps, and close reasons
- Ticket events (for example: create, claim, unclaim, transfer, rename, close, inactivity warnings, media-forward events)

### C) Message and Transcript Data
- Ticket channel message content included in transcripts
- Message timestamps and author references
- Attachment URLs and related media references
- Generated transcript HTML content saved for dashboard viewing

### D) Media Backup Data
- Media backup thread identifiers and source linkage
- Starter message/thread references for media archive records
- Ticket-to-media-post link metadata

### E) Settings and Configuration Data
- Guild settings (for example transcript destination channel and related configuration values)
- Panel, category, and team configuration metadata used by the dashboard and bot

### F) Authentication and Session Data
- Dashboard login/session data required for authenticated access
- Discord OAuth-related account/session context handled by the API service

### G) Operational Logs
The system stores operational logs for reliability and debugging. These logs can include:
- Request method/path and response status
- User agent
- Cloudflare/request tracing values (for example `cf-ray`)
- **IP addresses** (for example from `cf-connecting-ip` and/or `x-forwarded-for` headers)

## 4) How Data Is Used
Data is used strictly to:
- Provide ticketing functionality
- Enforce access control and role-based permissions
- Generate and display transcripts
- Support moderation and audit needs
- Diagnose incidents, errors, and availability issues

## 5) Data Sharing
Data is primarily processed within Discord and this project’s configured infrastructure/services. Data may be exposed to authorized staff/superusers through the dashboard and transcript tooling according to configured permissions.

## 6) Retention and Deletion
Data is retained as needed for ticket operations, auditing, and support workflows. Superusers may use administrative tooling (such as transcript deletion actions) where available. Infrastructure-level logs may persist according to host/platform retention settings.

## 7) Security and Access
Access is controlled through Discord authentication, configured role checks, and internal service secrets for API↔bot communication. You are responsible for securing your Discord account and any administrator/superuser credentials.

## 8) Prohibited Use
You agree not to misuse the system, bypass access controls, or use the service for unlawful, abusive, or unauthorized activity.

## 9) Changes to These Terms
These Terms may be updated at any time. Continued use of the system after updates means you accept the revised Terms.

## 10) Contact
For questions about these Terms or data handling, contact the project administrator/owner for your deployment.
