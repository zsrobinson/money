import { randomBytes } from "node:crypto"
import type { Context } from "hono"
import { z } from "zod"
import { isDate, isMonth } from "../analytics.ts"
import type { AccountView, Computed, EffTxn, Model } from "../model.ts"

export { isDate }
export const id = (prefix: string) =>
  `${prefix}_${randomBytes(8).toString("hex")}`
export const now = () => new Date().toISOString()

export class HttpError extends Error {
  constructor(
    public status: 400 | 404 | 409 | 422 | 429,
    message: string
  ) {
    super(message)
  }
}
export const notFound = (what: string) =>
  new HttpError(404, `${what} not found`)

export async function body<T extends z.ZodType>(
  c: Context,
  schema: T
): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new HttpError(400, "Send a JSON body")
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success)
    throw new HttpError(
      422,
      parsed.error.issues[0]?.message ?? "Invalid request"
    )
  return parsed.data
}

export function accountJson(a: AccountView) {
  return {
    id: a.id,
    name: a.name,
    label: a.label,
    officialName: a.officialName,
    institution: a.institution,
    sourceId: a.sourceId,
    sourceStatus: a.sourceStatus,
    type: a.type,
    subtype: a.subtype,
    mask: a.mask,
    currency: a.currency,
    balanceCents: a.balanceCents,
    availableCents: a.availableCents,
    limitCents: a.limitCents,
    liability: a.liability,
    availability: a.availability,
    scope: a.scope,
    hidden: a.hidden,
    excludeNetWorth: a.excludeNetWorth,
    manual: a.manual,
    manualType: a.manualType,
  }
}

export function txnJson(c: Computed, t: EffTxn) {
  const account = c.account.get(t.accountId)
  return {
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    currency: t.currency,
    merchant: t.merchantEff,
    description: t.description,
    category: t.categoryEff,
    accountId: t.accountId,
    accountName: account?.name ?? "Account",
    pending: t.pending,
    hidden: t.hidden,
    reviewed: t.reviewed,
    needsReview: t.needsReview,
    note: t.note,
    tags: t.tags,
    split: Boolean(t.splits?.length),
    flowKind: t.flowKind,
    transferPairId: t.transferPairId,
    manual: Boolean(t.manual),
  }
}

const SETTINGS = {
  defaultRange: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]),
  weekStartsOn: z.enum(["sunday", "monday"]),
  showPending: z.boolean(),
  reviewNewTransactions: z.boolean(),
  /** Transactions on or after this day count for review; null for all. */
  reviewSince: z.string().refine(isDate, "Use a valid date").nullable(),
  /** Category budgets, or flex budgeting (fixed, flexible, non-monthly). */
  budgetMode: z.enum(["category", "flex"]),
  /** Category code to the first month whose leftover carries forward. */
  budgetRollover: z.record(z.string(), z.string().refine(isMonth)),
  /** Source id to when someone asked for an early sync; the sync unit honours it. */
  syncRequests: z.record(z.string(), z.string()),
}
export const SettingsBody = z.object(SETTINGS).partial().strict()
export type Settings = {
  [K in keyof typeof SETTINGS]: z.infer<(typeof SETTINGS)[K]>
}
const DEFAULT_SETTINGS: Settings = {
  defaultRange: "6m",
  weekStartsOn: "monday",
  showPending: true,
  reviewNewTransactions: true,
  reviewSince: null,
  budgetMode: "category",
  budgetRollover: {},
  syncRequests: {},
}

/** What every route module shares: the model, writes and settings. */
export function createContext(model: Model) {
  const db = model.db
  /** One write transaction; the model recomputes after it commits. */
  const write = <T>(fn: () => T): T => {
    db.exec("BEGIN IMMEDIATE")
    try {
      const out = fn()
      db.exec("COMMIT")
      model.invalidate()
      return out
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
  /** Each key is checked on its own, so one bad value never resets the rest. */
  const settings = (): Settings => {
    const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>
    for (const r of db
      .prepare("SELECT key, value_json FROM settings")
      .all() as { key: string; value_json: string }[]) {
      const schema = SETTINGS[r.key as keyof typeof SETTINGS]
      if (!schema) continue
      try {
        const parsed = schema.safeParse(JSON.parse(r.value_json))
        if (parsed.success) out[r.key] = parsed.data
      } catch {
        /* keep the default */
      }
    }
    return out as Settings
  }
  /** Call inside `write`. */
  const setSetting = (key: keyof Settings, value: unknown) =>
    db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json"
      )
      .run(key, JSON.stringify(value))
  const validCategory = (c: Computed, code: string) => {
    if (!c.categories.some((x) => x.code === code))
      throw new HttpError(422, "Choose an existing category")
  }
  const recurringOverrides = () =>
    new Map(
      (
        db.prepare("SELECT * FROM recurring_overrides").all() as {
          merchant_key: string
          status: string
          cadence: string | null
          expected_cents: number | null
        }[]
      ).map((r) => [r.merchant_key, r])
    )
  return {
    model,
    db,
    write,
    settings,
    setSetting,
    validCategory,
    recurringOverrides,
  }
}
export type Ctx = ReturnType<typeof createContext>
