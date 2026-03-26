# GDPR Technical Implementation Guide

This document outlines the technical implementation of GDPR compliance in the UKRRP Ticket System.

## Overview

The system implements GDPR Articles 5, 13-21 with focus on:
- **Data Minimization** (Article 5(1)(c)): Collect only necessary data
- **Storage Limitation** (Article 5(1)(e)): Auto-delete data after retention periods
- **Accountability** (Article 5(2)): Audit logging of all data processing
- **Data Subject Rights** (Articles 15-21): Access, Rectification, Erasure, Portability, Restriction, Objection

## Database Schema

### New Tables

#### `AuditLog` (audit_log)
Tracks all data processing activities for accountability and compliance verification.

**Columns:**
- `id` (UUID): Unique log entry ID
- `userId` (VARCHAR): User ID performing the action (if applicable)
- `guildId` (VARCHAR): Guild/community ID
- `action` (VARCHAR): Action type (DATA_ACCESS, DATA_MODIFICATION, DATA_DELETION, etc.)
- `resourceType` (VARCHAR): Type of resource (USER_DATA, TICKET, TRANSCRIPT, etc.)
- `resourceId` (VARCHAR): ID of the affected resource
- `details` (JSON): Additional action details
- `ipAddress` (VARCHAR): Client IP address
- `userAgent` (TEXT): Client user agent
- `createdAt` (DATETIME): Timestamp of action

**Indexes:** userId, guildId, action, createdAt

**Retention:** 90 days (automatically purged)

#### `UserConsent` (user_consent)
Tracks user consent for specific data processing activities.

**Columns:**
- `id` (UUID): Unique consent record ID
- `userId` (VARCHAR): User ID
- `guildId` (VARCHAR): Guild ID
- `consentType` (VARCHAR): Type of consent (e.g., MARKETING, ANALYTICS, OPTIONAL_FEATURES)
- `granted` (BOOLEAN): Whether consent is granted or revoked
- `grantedAt` (DATETIME): When consent was granted
- `revokedAt` (DATETIME): When consent was revoked
- `ipAddress` (VARCHAR): IP address when consent was changed
- `userAgent` (TEXT): User agent when consent was changed
- `createdAt` (DATETIME): Initial creation timestamp
- `updatedAt` (DATETIME): Last updated timestamp

**Indexes:** userId, guildId, granted, createdAt

**Retention:** Until user requests deletion

#### `DataDeletionRequest` (data_deletion_request)
Tracks user-initiated data deletion requests (Article 17 - Right to Erasure).

**Columns:**
- `id` (UUID): Unique request ID
- `userId` (VARCHAR): Requesting user ID
- `guildId` (VARCHAR): Guild ID
- `status` (VARCHAR): Request status (pending, completed, failed)
- `requestedAt` (DATETIME): When deletion was requested
- `completedAt` (DATETIME): When deletion was completed
- `ipAddress` (VARCHAR): IP of requesting user
- `userAgent` (TEXT): User agent of requesting user
- `reason` (VARCHAR): Why user requested deletion
- `createdAt` (DATETIME): Record creation time

**Indexes:** userId, guildId, status, requestedAt

**Retention:** 3 years (for legal documentation)

### Modified Tables

#### `Ticket`
Added column:
- `deletedAt` (DATETIME, nullable): Soft-delete timestamp for erasure requests

#### `TicketTranscript`
Added column:
- `deletedAt` (DATETIME, nullable): Soft-delete timestamp for erasure requests

## API Endpoints

### GDPR Data Subject Rights Endpoints

All endpoints require authentication. Client IP and User Agent are logged for audit purposes.

#### `GET /api/gdpr/export`
Export user's personal data (Article 20 - Data Portability)

**Authentication:** Required (session or header token)

**Response:**
```json
{
  "exportedAt": "2026-03-26T12:00:00Z",
  "userId": "discord_user_id",
  "guildId": "guild_id",
  "userData": {
    "username": "username",
    "discriminator": "0001",
    "avatar": "avatar_hash"
  },
  "ticketsOwned": [{ /* ticket data */ }],
  "ticketsClaimed": [{ /* ticket data */ }],
  "ticketEvents": [{ /* event data */ }],
  "transcripts": [{ /* transcript data */ }],
  "consents": [{ /* consent records */ }],
  "dataRetention": { /* retention policy */ }
}
```

**Audit Action:** `DATA_EXPORT_REQUESTED` → `DATA_EXPORT_COMPLETED`

---

#### `POST /api/gdpr/delete-request`
Request account and associated data deletion (Article 17 - Right to Erasure)

**Authentication:** Required

**Request Body:**
```json
{
  "reason": "User requested deletion (optional)"
}
```

**Response:**
```json
{
  "status": "pending",
  "requestId": "request_uuid",
  "message": "Deletion request created. Please contact support to confirm.",
  "supportEmail": "legal@m4rv1n.dev"
}
```

**Audit Action:** `DELETION_REQUEST_CREATED`

**Note:** Deletion requests must be confirmed by superuser after 30-day verification period.

---

#### `POST /api/gdpr/delete-confirm`
Confirm and execute deletion request (Superuser only)

**Authentication:** Required + Superuser status required

**Request Body:**
```json
{
  "userId": "discord_user_id",
  "requestId": "request_uuid"
}
```

**Response:**
```json
{
  "status": "completed",
  "message": "User data successfully deleted",
  "deletedItems": {
    "tickets": 5,
    "events": 12,
    "transcripts": 3,
    "consents": 1
  }
}
```

**Audit Action:** `USER_DATA_DELETED` or `USER_DATA_DELETION_FAILED`

---

#### `GET /api/gdpr/consent-status`
Check user's consent status for data processing (Article 7 - Proof of Consent)

**Authentication:** Required

**Response:**
```json
{
  "userId": "discord_user_id",
  "guildId": "guild_id",
  "consents": [
    {
      "consentType": "marketing",
      "granted": true,
      "grantedAt": "2026-01-01T00:00:00Z"
    }
  ],
  "defaultProcessingBasis": [
    {
      "basis": "contract",
      "description": "Necessary for service provision"
    },
    {
      "basis": "legal_obligation",
      "description": "Compliance with regulations"
    },
    {
      "basis": "legitimate_interests",
      "description": "System administration and security"
    }
  ]
}
```

**Audit Action:** `DATA_ACCESS` (consent status viewed)

---

#### `GET /api/gdpr/audit-log?userId=...&guildId=...&limit=100`
Retrieve audit logs (Superuser only)

**Authentication:** Required + Superuser status required

**Query Parameters:**
- `userId` (optional): Filter by user ID
- `guildId` (optional): Filter by guild ID
- `action` (optional): Filter by action type
- `resourceType` (optional): Filter by resource type
- `limit` (optional, default 100, max 1000): Number of records

**Response:**
```json
{
  "auditLogs": [
    {
      "id": "log_uuid",
      "userId": "discord_user_id",
      "guildId": "guild_id",
      "action": "DATA_ACCESS",
      "resourceType": "TRANSCRIPT",
      "resourceId": "transcript_id",
      "details": { /* action details */ },
      "ipAddress": "192.0.2.1",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2026-03-26T12:00:00Z"
    }
  ]
}
```

**Audit Action:** `AUDIT_LOG_ACCESSED`

## Automated Data Retention

### Retention Cleanup Service

Located in `apps/api/src/services/retention.ts`

**Retention Policies:**
- **Closed Tickets:** 24 months after closure (GDPR Storage Limitation)
- **Operational Logs:** 90 days (balanced retention for troubleshooting)
- **Sessions:** Until logout or expiration

**Functions:**

#### `runRetentionCleanup()`
Main cleanup function - should run daily via cron job or scheduled task

**Execution:**
```bash
# In backend startup or scheduler
import { runRetentionCleanup } from './services/retention.js';

// Run daily at 2 AM
schedule.scheduleJob('0 2 * * *', async () => {
  const result = await runRetentionCleanup();
  console.log('Retention cleanup result:', result);
});
```

**Cleanup Tasks:**
1. Delete closed tickets older than 24 months
2. Delete orphaned transcripts
3. Delete expired session data
4. Purge old audit logs (90 days)

**Audit Action:** `RETENTION_CLOSED_TICKETS_DELETED`, `RETENTION_AUDIT_LOGS_PURGED`, etc.

#### `softDeleteUserData(userId, guildId)`
Called when deletion request is confirmed (Article 17)

**Actions:**
- Mark user's tickets as deleted (soft delete)
- Mark user's transcripts as deleted (soft delete)
- Delete user's events
- Revoke all user consents
- Anonymize event records

**Returns:**
```json
{
  "success": true,
  "deletedItemCount": 42
}
```

## Audit Logging

### Audit Middleware

Located in `apps/api/src/middleware/auditLog.ts`

**Features:**
- Non-blocking async logging (doesn't impact request latency)
- Automatic IP address capture
- User agent tracking
- Structured action logs

**Usage in Routes:**
```typescript
import { logDataAccess, logDataModification, logDataDeletion } from '../middleware/auditLog.js';

// Log data access
await logDataAccess(req, 'TRANSCRIPT', transcriptId, { action: 'view' });

// Log modification
await logDataModification(req, 'TICKET', ticketId, { 
  from: { status: 'open' }, 
  to: { status: 'closed' } 
});

// Log deletion
await logDataDeletion(req, 'TICKET', ticketId, 'User deletion request');
```

**Audit Log Retention:** 90 days (automatically purged)

## Data Export Format

User data exports include:
- Personal identity data (username, avatar)
- All tickets owned by user
- All tickets claimed by user
- All events performed by user
- All transcripts accessible to user
- Consent records
- Data retention policies

**Export file format:** JSON

Example export structure:
```json
{
  "exportedAt": "2026-03-26T12:00:00Z",
  "userId": "...",
  "userData": { /* identity */ },
  "ticketsOwned": [ /* array of tickets */ ],
  "ticketsClaimed": [ /* array of tickets */ ],
  "transcripts": [ /* array of transcripts */ ],
  "consents": [ /* consent records */ ]
}
```

## Security Considerations

### Data Protection
- All personal data transmission uses HTTPS/TLS
- Session secrets required (fails at startup if missing)
- Authentication tokens signed with HMAC-SHA256
- Rate limiting on auth endpoints (prevents brute force)

### Storage Security
- Passwords not stored (OAuth with Discord)
- Sensitive data in encrypted fields (where applicable)
- Database access restricted by application layer
- Regular backups with encryption at rest

### Audit Trail Security
- Immutable audit logs (append-only)
- Separate audit log retention (90 days minimum)
- IP address and user agent captured with all actions
- Cannot be modified or deleted by regular users

## Compliance Verification

### GDPR Articles Covered

| Article | Requirement | Implementation |
|---------|-------------|-----------------|
| 5(1)(c) | Data Minimization | Only collect necessary user/ticket data |
| 5(1)(e) | Storage Limitation | Auto-delete after retention periods |
| 5(2) | Accountability | Audit logging of all data processing |
| 13 | Info at Collection | Not applicable (no direct collection) |
| 15 | Right of Access | `/api/gdpr/export` endpoint |
| 16 | Right to Rectification | User can close/rename tickets |
| 17 | Right to Erasure | `/api/gdpr/delete-request` endpoint |
| 18 | Right to Restrict | User can request deletion |
| 20 | Right to Portability | `/api/gdpr/export` JSON format |
| 21 | Right to Object | User can request deletion |
| 28 | Data Processing Agreement | Maintained with Discord |

### Testing Checklist

- [ ] Export endpoint returns valid JSON with all user data
- [ ] Deletion requests created with pending status
- [ ] Superuser can confirm deletion requests
- [ ] Deleted data is permanently removed/soft-deleted
- [ ] Audit logs record all data access/modification
- [ ] Old data automatically deleted after retention period
- [ ] Audit logs purged after 90 days
- [ ] Rate limiting prevents brute force attacks
- [ ] Session secret required (app fails to start without it)

## Incident Response

### Data Breach Procedure
1. Immediately log incident in audit system
2. Notify affected users via email
3. Contact data protection authority (for EU residents)
4. Document breach details including:
   - When discovered
   - Likely impact
   - Measures taken to mitigate
   - Contact information for questions

### Deletion Request Verification
1. User creates deletion request via `/api/gdpr/delete-request`
2. 30-day verification period begins
3. Support confirms request authenticity
4. Superuser approves deletion via `/api/gdpr/delete-confirm`
5. System soft-deletes/anonymizes all user data

## Monitoring and Maintenance

### Daily Tasks
- Run retention cleanup at 2 AM UTC: `runRetentionCleanup()`
- Monitor for data deletion requests due for processing
- Check audit log volume and purge old entries

### Weekly Tasks
- Review audit logs for unusual patterns
- Verify backup encryption status
- Check data export functionality

### Quarterly Tasks
- Compliance audit against GDPR articles
- Data Protection Impact Assessment (DPIA) review
- Consent records validation

## Support Resources

For GDPR questions or data subject requests:
- Email: legal@m4rv1n.dev
- Response time: 30 days (GDPR requirement)
