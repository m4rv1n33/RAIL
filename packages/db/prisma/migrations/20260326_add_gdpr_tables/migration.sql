-- Create audit logs table for tracking data processing activities
CREATE TABLE AuditLog (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(255),
  guildId VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  resourceType VARCHAR(100),
  resourceId VARCHAR(255),
  details JSON,
  ipAddress VARCHAR(45),
  userAgent TEXT,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  
  INDEX idx_userId (userId),
  INDEX idx_guildId (guildId),
  INDEX idx_action (action),
  INDEX idx_createdAt (createdAt)
);

-- Create consent tracking table for GDPR consent management
CREATE TABLE UserConsent (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(255) NOT NULL,
  guildId VARCHAR(255) NOT NULL,
  consentType VARCHAR(100) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT false,
  grantedAt DATETIME(3),
  revokedAt DATETIME(3),
  ipAddress VARCHAR(45),
  userAgent TEXT,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  
  UNIQUE KEY unique_consent (userId, guildId, consentType),
  INDEX idx_userId (userId),
  INDEX idx_guildId (guildId),
  INDEX idx_granted (granted),
  INDEX idx_createdAt (createdAt)
);

-- Create data deletion request tracking table
CREATE TABLE DataDeletionRequest (
  id VARCHAR(36) PRIMARY KEY,
  userId VARCHAR(255) NOT NULL,
  guildId VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  requestedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completedAt DATETIME(3),
  ipAddress VARCHAR(45),
  userAgent TEXT,
  reason VARCHAR(255),
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  
  INDEX idx_userId (userId),
  INDEX idx_guildId (guildId),
  INDEX idx_status (status),
  INDEX idx_requestedAt (requestedAt)
);

-- Add deletion tracking to existing Ticket table
ALTER TABLE Ticket ADD COLUMN deletedAt DATETIME(3) AFTER closedAt;
ALTER TABLE Ticket ADD INDEX idx_deletedAt (deletedAt);

-- Add retention metadata to TicketTranscript
ALTER TABLE TicketTranscript ADD COLUMN deletedAt DATETIME(3) AFTER createdAt;
ALTER TABLE TicketTranscript ADD INDEX idx_deletedAt (deletedAt);

-- Add audit log entry for schema migration
INSERT INTO AuditLog (id, action, resourceType, details, createdAt) 
VALUES (
  UUID(),
  'SCHEMA_MIGRATION',
  'DATABASE',
  JSON_OBJECT('migration', 'add_gdpr_tables', 'version', '20260326'),
  CURRENT_TIMESTAMP(3)
);
