export const TicketStatus = {
  Open: "OPEN",
  InProgress: "IN_PROGRESS",
  Waiting: "WAITING",
  Closed: "CLOSED"
} as const;

export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export type CategoryDisplay = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
};

export type PanelConfigInput = {
  channelId: string;
  title: string;
  description: string;
  categoryIds: string[];
};
