# GDPR Implementation Integration Checklist

## Step 1: Update Prisma Schema

Add these new models to `packages/db/prisma/schema.prisma`:

```prisma
model AuditLog {
  id            String   @id @default(cuid())
  userId        String?
  guildId       String?
  action        String
  resourceType  String
  resourceId    String?
  details       Json?
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime @default(now())

  @@index([userId])
  @@index([guildId])
  @@index([action])
  @@index([createdAt])
}

model UserConsent {
  id            String   @id @default(cuid())
  userId        String
  guildId       String
  consentType   String
  granted       Boolean  @default(false)
  grantedAt     DateTime?
  revokedAt     DateTime?
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, guildId, consentType])
  @@index([userId])
  @@index([guildId])
  @@index([granted])
  @@index([createdAt])
}

model DataDeletionRequest {
  id            String   @id @default(cuid())
  userId        String
  guildId       String
  status        String   @default("pending")
  requestedAt   DateTime @default(now())
  completedAt   DateTime?
  ipAddress     String?
  userAgent     String?
  reason        String?
  createdAt     DateTime @default(now())

  @@index([userId])
  @@index([guildId])
  @@index([status])
  @@index([requestedAt])
}
```

Also update `Ticket` and `TicketTranscript` models:

```prisma
model Ticket {
  // ... existing fields ...
  closedAt      DateTime?
  deletedAt     DateTime?  // ADD THIS LINE
  
  // ... rest of model ...
  @@index([deletedAt])
}

model TicketTranscript {
  // ... existing fields ...
  createdAt     DateTime @default(now())
  deletedAt     DateTime?  // ADD THIS LINE
  
  // ... rest of model ...
  @@index([deletedAt])
}
```

Run migration:
```bash
cd packages/db
npm run db:migrate
```

## Step 2: Install Dependencies

Add required packages to `apps/api/package.json`:

```json
{
  "dependencies": {
    "uuid": "^9.0.0",
    "node-cron": "^3.0.0"
  }
}
```

## Step 3: Update App.ts

Update `apps/api/src/app.ts` to include GDPR routes and setup retention cleanup:

```typescript
import { gdprRouter } from "./routes/gdpr.js";
import { runRetentionCleanup } from "./services/retention.js";
import { purgeOldAuditLogs } from "./middleware/auditLog.js";
import cron from "node-cron";

export const createApp = () => {
  const app = express();
  
  // ... existing middleware setup ...

  // Register GDPR routes
  app.use("/api/gdpr", gdprRouter);
  
  // Register other routes
  app.use("/api/auth", authRouter);
  app.use("/api/panels", panelsRouter);
  // ... etc ...

  return app;
};

export const startRetentionCleanup = () => {
  // Run retention cleanup daily at 2 AM UTC
  const cleanupJob = cron.schedule("0 2 * * *", async () => {
    console.info("[scheduler] Starting daily retention cleanup...");
    try {
      const result = await runRetentionCleanup();
      if (!result.success) {
        console.error("[scheduler] Retention cleanup failed:", result.error);
      } else {
        console.info("[scheduler] Retention cleanup completed:", result.results);
      }
    } catch (error) {
      console.error("[scheduler] Retention cleanup error:", error);
    }
  });

  // Run audit log purge weekly on Mondays at 3 AM UTC
  const auditPurgeJob = cron.schedule("0 3 * * 1", async () => {
    console.info("[scheduler] Starting weekly audit log purge...");
    try {
      const purgedCount = await purgeOldAuditLogs(90);
      console.info(`[scheduler] Audit log purge completed: ${purgedCount} entries removed`);
    } catch (error) {
      console.error("[scheduler] Audit log purge error:", error);
    }
  });

  return { cleanupJob, auditPurgeJob };
};
```

Update `apps/api/src/index.ts`:

```typescript
import { createApp, startRetentionCleanup } from "./app.js";

const app = createApp();
const { cleanupJob, auditPurgeJob } = startRetentionCleanup();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[api] Server running on port ${PORT}`);
  console.log("[scheduler] Retention cleanup and audit purge jobs scheduled");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.info("[api] Shutting down gracefully...");
  cleanupJob.stop();
  auditPurgeJob.stop();
  process.exit(0);
});
```

## Step 4: Add Audit Logging to Key Routes

Update existing route handlers to log data access/modification.

Example for `apps/api/src/routes/transcripts.ts`:

```typescript
import { logDataAccess, logDataModification } from "../middleware/auditLog.js";

// In the transcript retrieval handler:
transcriptsRouter.get("/:id", requireSession, async (req, res) => {
  // ... existing logic ...
  
  // Log data access
  await logDataAccess(req, "TRANSCRIPT", transcriptId, {
    action: "view",
    viewedBy: req.session.user?.id,
  });
  
  res.json(transcript);
});

// In ticket update handler:
ticketsRouter.put("/:id", requireSession, async (req, res) => {
  const oldTicket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  
  // ... update logic ...
  
  // Log modification
  await logDataModification(req, "TICKET", ticketId, {
    from: oldTicket,
    to: updatedTicket,
  });
  
  res.json(updatedTicket);
});
```

## Step 5: Set Environment Variables

Add to `.env` file:

```bash
# GDPR/Privacy
GDPR_ENABLED=true
SUPPORT_EMAIL=legal@m4rv1n.dev
DATA_RETENTION_CLOSED_TICKETS_DAYS=720  # 24 months
DATA_RETENTION_LOGS_DAYS=90
DATA_RETENTION_SESSIONS_DAYS=1

# Retention cleanup schedule (cron format)
RETENTION_CLEANUP_SCHEDULE="0 2 * * *"  # Daily at 2 AM UTC
AUDIT_PURGE_SCHEDULE="0 3 * * 1"        # Weekly Monday at 3 AM UTC
```

## Step 6: Create Database Migration

If using automatic migrations, the migration is already in place.

Manual SQL migration (if needed):

```sql
-- Apply migration from packages/db/prisma/migrations/20260326_add_gdpr_tables/migration.sql
```

## Step 7: Update Routes Registration

Ensure `app.ts` registers all routes properly:

```typescript
appRouter.use("/api/auth", authRouter);
app.use("/api/panels", panelsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/discord", discordRouter);
app.use("/api/transcripts", transcriptsRouter);
app.use("/api/gdpr", gdprRouter);  // ADD THIS
```

## Step 8: Testing

### Manual Testing

**Test Data Export:**
```bash
curl -X GET http://localhost:3000/api/gdpr/export \
  -H "x-guild-id: 123456789" \
  -H "Cookie: ukrrp_auth=..."
```

**Test Deletion Request:**
```bash
curl -X POST http://localhost:3000/api/gdpr/delete-request \
  -H "x-guild-id: 123456789" \
  -H "Content-Type: application/json" \
  -H "Cookie: ukrrp_auth=..." \
  -d '{"reason": "Testing"}'
```

**Test Audit Log Retrieval (superuser):**
```bash
curl -X GET "http://localhost:3000/api/gdpr/audit-log?limit=50" \
  -H "x-guild-id: 123456789" \
  -H "Cookie: ukrrp_auth=..."
```

### Automated Testing

Create `apps/api/src/routes/__tests__/gdpr.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
// Add tests for GDPR endpoints
```

Run tests:
```bash
npm test
```

## Step 9: Documentation Updates

- [ ] Update README.md with GDPR compliance info
- [ ] Add GDPR_TECHNICAL_IMPLEMENTATION.md to documentation
- [ ] Update Privacy Notice in TERMS_AND_CONDITIONS.md (already done)
- [ ] Create GDPR_INCIDENT_RESPONSE.md for breach procedures

## Step 10: Deployment

1. Before deploying:
   - Ensure all tests pass
   - Review audit logging setup
   - Verify retention policies
   - Test data export functionality

2. During deployment:
   - Run database migrations: `npm run db:migrate`
   - Deploy updated application code
   - Start retention cleanup jobs
   - Monitor application logs

3. After deployment:
   - Verify GDPR endpoints are accessible
   - Test data export
   - Monitor audit logs
   - Check retention cleanup execution

## Verification Checklist

- [ ] AuditLog table created and indexed
- [ ] UserConsent table created and indexed
- [ ] DataDeletionRequest table created and indexed
- [ ] Ticket and TicketTranscript tables updated with deletedAt fields
- [ ] GDPR routes registered in app.ts
- [ ] Retention cleanup job scheduled
- [ ] Audit purge job scheduled
- [ ] Environment variables configured
- [ ] Data export endpoint working
- [ ] Deletion request endpoint working
- [ ] Superuser deletion confirmation working
- [ ] Audit logs being written correctly
- [ ] Old data auto-deleted after retention periods
- [ ] Session secrets enforced
- [ ] Rate limiting on auth endpoints

## Ongoing Maintenance

### Weekly
- Monitor audit logs for anomalies
- Check data deletion request queue
- Verify retention cleanup execution

### Monthly
- Review GDPR compliance status
- Check audit log volume
- Verify data retention policies

### Quarterly
- Full GDPR compliance audit
- Data Protection Impact Assessment (DPIA) review
- Update incident response procedures

## Support

For questions or issues:
- Review GDPR_TECHNICAL_IMPLEMENTATION.md
- Check audit logs for errors
- Contact: legal@m4rv1n.dev
