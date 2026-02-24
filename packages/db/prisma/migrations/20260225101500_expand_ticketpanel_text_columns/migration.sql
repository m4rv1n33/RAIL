-- Expand TicketPanel text columns to match API validator limits
ALTER TABLE `TicketPanel`
  MODIFY `title` VARCHAR(256) NOT NULL,
  MODIFY `description` TEXT NOT NULL;
