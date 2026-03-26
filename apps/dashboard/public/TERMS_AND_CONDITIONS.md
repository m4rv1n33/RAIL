# RAIL Ticketing System - Privacy Notice and Terms of Use

_Last updated: March 26, 2026_

## 1) Introduction and Data Controller

This Privacy Notice describes how the UKRRP Ticket System (the "Service") collects, processes, and protects your personal data in compliance with the General Data Protection Regulation (GDPR) and applicable data protection laws.

The organization operating this Service is the data controller responsible for your personal data.

## 2) Acceptance of Terms
By using the UKRRP Ticket System Discord bot, dashboard, or related services, you acknowledge that you have read and understood this Privacy Notice and agree to the processing of your personal data as described herein.

## 3) Service Purpose and Legal Basis
The Service is used to create and manage support tickets in Discord, including ticket routing, claim/close workflows, transcript generation, and optional media backup handling. Personal data processing is based on:
- **Contract Performance**: Processing necessary to provide the ticketing service
- **Legal Obligation**: Compliance with applicable laws and regulations
- **Legitimate Interests**: System administration, security, and fraud prevention
- **Explicit Consent**: Where provided by you for specific processing activities

## 4) Categories of Personal Data Collected
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
- Ticket events (create, claim, unclaim, transfer, rename, close, inactivity warnings, media-forward events)

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
- Guild settings (transcript destination channel and related configuration values)
- Panel, category, and team configuration metadata

### F) Authentication and Session Data
- Dashboard login/session data required for authenticated access
- Discord OAuth-related account/session context
- Signed authentication token data for cross-platform login continuity

### G) Operational and Technical Data
- Request method/path and response status
- User agent information
- Cloudflare/request tracing values (cf-ray)
- **IP addresses** (cf-connecting-ip, x-forwarded-for headers)

## 5) Processing Purposes
Personal data is processed strictly for:
- Providing ticketing functionality and service delivery
- Enforcing access control and role-based permissions
- Generating and displaying transcripts
- Support, moderation, and audit requirements
- Diagnosing incidents, errors, and system availability issues
- Ensuring system security and preventing unauthorized access
- Compliance with legal and regulatory obligations

## 6) Data Recipients and Sharing
Personal data is:
- Primarily processed within Discord and project infrastructure
- Accessible to authorized staff/superusers through the dashboard according to configured role-based permissions
- Shared with Discord as a platform partner for core functionality
- Not sold or transferred to third parties without explicit consent
- Subject to transcript visibility rules based on support-team role hierarchy

## 7) Data Retention
Personal data is retained for:
- **Active Tickets**: Duration of ticket lifecycle plus applicable legal retention periods
- **Closed Tickets**: Up to 24 months from closure, or as required by applicable law
- **Operational Logs**: Up to 90 days or as required by infrastructure providers
- **Session Data**: Until session expiration or user logout
- **Transcripts**: As long as referenced tickets exist, or until administrator deletion

Superusers may use administrative tooling (such as transcript deletion actions) to remove data where permitted. You may request deletion subject to legal obligations.

## 8) Your Rights Under GDPR
You have the right to:
- **Access** (Article 15): Request a copy of your personal data
- **Rectification** (Article 16): Correct inaccurate personal data
- **Erasure** (Article 17): Request deletion of your data ("right to be forgotten"), subject to legal obligations
- **Restrict Processing** (Article 18): Limit how your data is used
- **Data Portability** (Article 20): Receive your data in a structured format
- **Object** (Article 21): Oppose certain processing activities
- **Lodge a Complaint**: With your local supervisory authority if you believe your rights are violated

To exercise these rights, contact the data controller or project administrator for your deployment.

## 9) Data Security and Protection
The Service implements:
- Access control through Discord authentication and configured role checks
- Internal service secrets for API↔bot communication
- Transcript visibility rules based on role hierarchy
- Configurable security policies for authorized staff actions
- Industry-standard security measures to protect against unauthorized access

**Your Responsibility**: You are responsible for securing your Discord account and any administrator/superuser credentials.

## 10) International Data Transfers
Personal data may be transferred to and processed in countries other than your country of residence. Where such transfers occur, appropriate safeguards are implemented in accordance with GDPR Chapter V, including standard contractual clauses or adequacy decisions.

## 11) Data Processor Information
The Service may process data on behalf of Discord and other platform partners. Where data processors are used, Data Processing Agreements are maintained in compliance with GDPR Article 28.

## 12) Changes to This Privacy Notice
This Privacy Notice may be updated to reflect changes in data processing practices, legal requirements, or Service functionality. Material changes will be communicated to users. Continued use of the Service after updates constitutes acceptance of revised terms.

## 13) Prohibited Use
You agree not to:
- Misuse the system or bypass access controls
- Use the Service for unlawful, abusive, discriminatory, or unauthorized activity
- Attempt to access data beyond your authorized scope
- Interfere with system security or data integrity

## 14) Contact and Data Protection Officer
For questions about this Privacy Notice, data handling practices, or to exercise your GDPR rights:

**Email:** legal@m4rv1n.dev

For urgent data protection matters or to exercise your GDPR rights, contact our data controller at the email address above.

## 15) Complaint Rights
If you believe the Service violates your data protection rights, you have the right to lodge a complaint with your applicable supervisory authority without prejudice to any other legal remedies.
