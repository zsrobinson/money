import { z } from "zod"
import { isDate } from "../analytics.ts"
import { RuleAction, RuleMatch } from "../rules.ts"

export const TxnPatch = z
  .object({
    category: z.string().min(1).max(100).nullable().optional(),
    merchant: z.string().trim().min(1).max(200).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    hidden: z.boolean().nullable().optional(),
    reviewed: z.boolean().nullable().optional(),
    date: z.string().refine(isDate, "Use a valid date").nullable().optional(),
    tags: z.array(z.string().max(100)).max(20).optional(),
    /** Manual transactions only. */
    amountCents: z
      .number()
      .int()
      .refine((v) => v !== 0 && Math.abs(v) <= 1e12, "Enter an amount")
      .optional(),
  })
  .strict()

export const SplitsBody = z
  .object({
    splits: z
      .array(
        z.object({
          amountCents: z
            .number()
            .int()
            .refine((v) => v !== 0, "Split amounts cannot be zero"),
          category: z.string().min(1).max(100),
          note: z.string().trim().max(500).nullable().optional(),
        })
      )
      .max(20),
  })
  .strict()

export const RuleBody = z
  .object({
    match: RuleMatch,
    action: RuleAction,
    enabled: z.boolean().optional(),
    /** Only transactions dated on or after this; null for all history. */
    appliesFrom: z
      .string()
      .refine(isDate, "Use a valid date")
      .nullable()
      .optional(),
  })
  .strict()
