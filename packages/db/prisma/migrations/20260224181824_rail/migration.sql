-- CreateTable
CREATE TABLE `SupportTeam` (
    `id` VARCHAR(191) NOT NULL,
    `guildId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isManagement` BOOLEAN NOT NULL DEFAULT false,
    `escalationTeamId` VARCHAR(191) NULL,

    INDEX `SupportTeam_guildId_idx`(`guildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SupportTeamRole` (
    `id` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,

    INDEX `SupportTeamRole_teamId_idx`(`teamId`),
    UNIQUE INDEX `SupportTeamRole_teamId_roleId_key`(`teamId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketCategory` (
    `id` VARCHAR(191) NOT NULL,
    `guildId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `example` VARCHAR(191) NOT NULL,
    `supportTeamId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `parentChannelId` VARCHAR(191) NULL,
    `modalSchema` JSON NULL,

    INDEX `TicketCategory_guildId_idx`(`guildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketPanel` (
    `id` VARCHAR(191) NOT NULL,
    `guildId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TicketPanel_guildId_idx`(`guildId`),
    INDEX `TicketPanel_channelId_idx`(`channelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketPanelCategory` (
    `id` VARCHAR(191) NOT NULL,
    `panelId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    INDEX `TicketPanelCategory_panelId_idx`(`panelId`),
    UNIQUE INDEX `TicketPanelCategory_panelId_categoryId_key`(`panelId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ticket` (
    `id` VARCHAR(191) NOT NULL,
    `guildId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `supportTeamId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `claimedById` VARCHAR(191) NULL,
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closeReason` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ticket_guildId_idx`(`guildId`),
    INDEX `Ticket_ownerId_idx`(`ownerId`),
    INDEX `Ticket_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketEvent` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketEvent_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketTranscript` (
    `id` VARCHAR(191) NOT NULL,
    `ticketId` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TicketTranscript_ticketId_key`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SupportTeam` ADD CONSTRAINT `SupportTeam_escalationTeamId_fkey` FOREIGN KEY (`escalationTeamId`) REFERENCES `SupportTeam`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SupportTeamRole` ADD CONSTRAINT `SupportTeamRole_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `SupportTeam`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketCategory` ADD CONSTRAINT `TicketCategory_supportTeamId_fkey` FOREIGN KEY (`supportTeamId`) REFERENCES `SupportTeam`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketPanelCategory` ADD CONSTRAINT `TicketPanelCategory_panelId_fkey` FOREIGN KEY (`panelId`) REFERENCES `TicketPanel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketPanelCategory` ADD CONSTRAINT `TicketPanelCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `TicketCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `TicketCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_supportTeamId_fkey` FOREIGN KEY (`supportTeamId`) REFERENCES `SupportTeam`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketEvent` ADD CONSTRAINT `TicketEvent_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketTranscript` ADD CONSTRAINT `TicketTranscript_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
