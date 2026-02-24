-- Remove obsolete management/escalation fields from SupportTeam
ALTER TABLE `SupportTeam` DROP FOREIGN KEY `SupportTeam_escalationTeamId_fkey`;
ALTER TABLE `SupportTeam` DROP COLUMN `isManagement`, DROP COLUMN `escalationTeamId`;
