import { z } from "zod"
import { normalizeText } from "./normalize.ts"
import type { Txn } from "./detail.ts"

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")

const Conditions = {
  merchant_contains: z.string().trim().min(1).max(200).optional(),
  merchant_equals: z.string().trim().min(1).max(200).optional(),
  merchant_starts_with: z.string().trim().min(1).max(200).optional(),
  description_contains: z.string().trim().min(1).max(200).optional(),
  account_id: z.string().min(1).max(200).optional(),
  category: z.string().min(1).max(100).optional(),
  flow_kind: z.enum(["activity", "bank_transfer", "peer_payment"]).optional(),
  direction: z.enum(["in", "out"]).optional(),
  amount_min_cents: z.number().int().min(0).optional(),
  amount_max_cents: z.number().int().min(0).optional(),
  date_from: isoDate.optional(),
  date_to: isoDate.optional(),
}
const amountsOrdered = (m: {
  amount_min_cents?: number
  amount_max_cents?: number
}) =>
  m.amount_min_cents == null ||
  m.amount_max_cents == null ||
  m.amount_min_cents <= m.amount_max_cents
const datesOrdered = (m: { date_from?: string; date_to?: string }) =>
  !m.date_from || !m.date_to || m.date_from <= m.date_to

/** One group of conditions that must all hold; used inside `any`. */
export const RuleCondition = z
  .object(Conditions)
  .strict()
  .refine((m) => Object.keys(m).length > 0, "Add at least one condition")
  .refine(amountsOrdered, "Minimum must not exceed maximum")
  .refine(datesOrdered, "The start date must come before the end date")

export const RuleMatch = z
  .object({
    ...Conditions,
    any: z.array(RuleCondition).min(1).max(10).optional(),
  })
  .strict()
  .refine((m) => Object.keys(m).length > 0, "Add at least one condition")
  .refine(amountsOrdered, "Minimum must not exceed maximum")
  .refine(datesOrdered, "The start date must come before the end date")
export type RuleMatch = z.infer<typeof RuleMatch>

export const SplitShare = z.object({
  category: z.string().min(1).max(100),
  /** Basis points: 2500 is 25%. */
  percent: z.number().int().min(1).max(10000),
})
export const RuleAction = z
  .object({
    category: z.string().min(1).max(100).optional(),
    merchant: z.string().trim().min(1).max(200).optional(),
    hide: z.boolean().optional(),
    mark_reviewed: z.boolean().optional(),
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
    split: z
      .array(SplitShare)
      .min(2, "Split into at least two parts")
      .max(10)
      .refine(
        (parts) => parts.reduce((s, p) => s + p.percent, 0) === 10000,
        "Split shares must add up to 100%"
      )
      .optional(),
    mark_recurring: z.boolean().optional(),
  })
  .strict()
  .refine(
    (a) =>
      Object.values(a).some(
        (v) => v !== undefined && !(Array.isArray(v) && !v.length)
      ),
    "Add at least one action"
  )
export type RuleAction = z.infer<typeof RuleAction>

export type Rule = {
  id: string
  position: number
  enabled: boolean
  match: RuleMatch
  action: RuleAction
  /** Only transactions whose bank date is on or after this; null for all. */
  appliesFrom: string | null
  createdAt: string
}

type Condition = z.infer<typeof RuleCondition>
function compileCondition(match: Omit<Condition, never>) {
  const contains = match.merchant_contains
    ? normalizeText(match.merchant_contains)
    : undefined
  const equals = match.merchant_equals
    ? normalizeText(match.merchant_equals)
    : undefined
  const starts = match.merchant_starts_with
    ? normalizeText(match.merchant_starts_with)
    : undefined
  const description = match.description_contains
    ? normalizeText(match.description_contains)
    : undefined
  return (t: Txn, text: string) => {
    // Rules read the bank's date even after a person corrects it.
    const date = snapshotDate(t)
    if (contains !== undefined && !text.includes(contains)) return false
    if (equals !== undefined && text !== equals) return false
    if (starts !== undefined && !text.startsWith(starts)) return false
    if (
      description !== undefined &&
      !normalizeText(t.description ?? "").includes(description)
    )
      return false
    if (match.account_id !== undefined && t.accountId !== match.account_id)
      return false
    if (match.category !== undefined && t.category !== match.category)
      return false
    if (match.flow_kind !== undefined && t.flowKind !== match.flow_kind)
      return false
    if (match.direction === "in" && !(t.amountCents > 0)) return false
    if (match.direction === "out" && !(t.amountCents < 0)) return false
    const abs = Math.abs(t.amountCents)
    if (match.amount_min_cents !== undefined && abs < match.amount_min_cents)
      return false
    if (match.amount_max_cents !== undefined && abs > match.amount_max_cents)
      return false
    if (match.date_from !== undefined && date < match.date_from) return false
    if (match.date_to !== undefined && date > match.date_to) return false
    return true
  }
}

/** Precomputed normalized matcher; reads snapshot values only (no chaining). */
export function compileMatch(match: RuleMatch) {
  if (!Object.keys(match).length) return () => false
  const { any, ...all } = match
  const every = Object.keys(all).length ? compileCondition(all) : undefined
  const some = any?.map(compileCondition)
  return (t: Txn, text: string) =>
    (!every || every(t, text)) && (!some || some.some((f) => f(t, text)))
}

export const snapshotDate = (t: Txn) =>
  (t as { snapshot?: { date: string } }).snapshot?.date ?? t.date

export const matchText = (t: Txn) =>
  normalizeText(t.merchant ?? t.description ?? "")

export type RuleOutcome = {
  category?: string
  merchant?: string
  hidden?: boolean
  reviewed?: boolean
  split?: { category: string; percent: number }[]
  recurring?: boolean
  tags: string[]
  ruleIds: string[]
}

/** Enabled rules by position, id. First matching rule wins per field; tags union. */
export function applyRules(
  rules: { rule: Rule; test: ReturnType<typeof compileMatch> }[],
  t: Txn,
  text = matchText(t)
): RuleOutcome {
  const out: RuleOutcome = { tags: [], ruleIds: [] }
  for (const { rule, test } of rules) {
    if (!rule.enabled) continue
    // The bank's date decides "only new transactions", like matching.
    if (rule.appliesFrom && snapshotDate(t) < rule.appliesFrom) continue
    if (!test(t, text)) continue
    out.ruleIds.push(rule.id)
    const a = rule.action
    if (a.category !== undefined && out.category === undefined)
      out.category = a.category
    if (a.merchant !== undefined && out.merchant === undefined)
      out.merchant = a.merchant
    if (a.hide !== undefined && out.hidden === undefined) out.hidden = a.hide
    if (a.mark_reviewed !== undefined && out.reviewed === undefined)
      out.reviewed = a.mark_reviewed
    if (a.split !== undefined && out.split === undefined) out.split = a.split
    if (a.mark_recurring !== undefined && out.recurring === undefined)
      out.recurring = a.mark_recurring
    for (const tag of a.tags ?? [])
      if (!out.tags.includes(tag)) out.tags.push(tag)
  }
  return out
}

/**
 * A rule's percentage split in cents: each part truncates toward zero and the
 * last takes the remainder. Zero parts drop; fewer than two parts left means
 * no split, and the caller uses `single` as the category instead.
 */
export function splitByShare(
  amountCents: number,
  shares: { category: string; percent: number }[]
): { parts: { category: string; amountCents: number }[]; single?: string } {
  let used = 0
  const parts = shares.map((s, i) => {
    const cents =
      i === shares.length - 1
        ? amountCents - used
        : Math.trunc((amountCents * s.percent) / 10000)
    used += cents
    return { category: s.category, amountCents: cents }
  })
  const kept = parts.filter((p) => p.amountCents !== 0)
  if (kept.length >= 2) return { parts: kept }
  return { parts: [], single: kept[0]?.category }
}

export function orderRules(rules: Rule[]) {
  return rules
    .toSorted(
      (a, b) =>
        a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map((rule) => ({ rule, test: compileMatch(rule.match) }))
}
