ALTER TABLE `Ticket`
  ADD COLUMN `ticketNumber` INTEGER NOT NULL AUTO_INCREMENT,
  ADD UNIQUE INDEX `Ticket_ticketNumber_key`(`ticketNumber`);
