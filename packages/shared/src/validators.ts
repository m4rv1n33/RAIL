import { z } from "zod";

export const panelConfigSchema = z.object({
  channelId: z.string().min(1),
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(4000),
  categoryIds: z.array(z.string().min(1)).min(0)
});

export const panelUpdateSchema = z.object({
  channelId: z.string().min(1),
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(4000),
  categories: z
    .array(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean()
      })
    )
    .min(1)
});

export const categorySchema = z.object({
  name: z.string().min(2).max(64),
  description: z.string().min(1).max(4000),
  supportTeamId: z.string().min(1),
  parentChannelId: z.string().optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  modalSchema: z
    .object({
      title: z.string().min(1).max(45),
      fields: z
        .array(
          z.object({
            id: z.string().min(1).max(32),
            label: z.string().min(1).max(45),
            style: z.enum(["short", "paragraph"]),
            required: z.boolean().default(true),
            placeholder: z.string().max(100).optional(),
            minLength: z.number().int().min(0).max(4000).optional(),
            maxLength: z.number().int().min(1).max(4000).optional()
          })
        )
        .min(1)
        .max(5)
    })
    .optional()
    .nullable()
});
