import { z } from "zod"
import { normalizeText } from "./normalize.ts"
import type { Txn } from "./detail.ts"

export const RuleMatch = z
  .object({
    merchant_contains: z.string().trim().min(1).max(200).optional(),
    merchant_equals: z.string().trim().min(1).max(200).optional(),
    account_id: z.string().min(1).max(200).optional(),
    category: z.string().min(1).max(100).optional(),
    direction: z.enum(["in", "out"]).optional(),
    amount_min_cents: z.number().int().min(0).optional(),
    amount_max_cents: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((m) => Object.keys(m).length > 0, "Add at least one condition")
  .refine(
    (m) =>
      m.amount_min_cents == null ||
      m.amount_max_cents == null ||
      m.amount_min_cents <= m.amount_max_cents,
    "Minimum must not exceed maximum"
  )
export type RuleMatch = z.infer<typeof RuleMatch>

export const RuleAction = z
  .object({
    category: z.string().min(1).max(100).optional(),
    merchant: z.string().trim().min(1).max(200).optional(),
    hide: z.boolean().optional(),
    mark_reviewed: z.boolean().optional(),
    tags: z.array(z.string().min(1).max(100)).max(20).optional(),
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
  createdAt: string
}

/** Precomputed normalized matcher; reads snapshot values only (no chaining). */
export function compileMatch(match: RuleMatch) {
  const contains = match.merchant_contains
    ? normalizeText(match.merchant_contains)
    : undefined
  const equals = match.merchant_equals
    ? normalizeText(match.merchant_equals)
    : undefined
  if (!Object.keys(match).length) return () => false
  return (t: Txn, text: string) => {
    if (contains !== undefined && !text.includes(contains)) return false
    if (equals !== undefined && text !== equals) return false
    if (match.account_id !== undefined && t.accountId !== match.account_id)
      return false
    if (match.category !== undefined && t.category !== match.category)
      return false
    if (match.direction === "in" && !(t.amountCents > 0)) return false
    if (match.direction === "out" && !(t.amountCents < 0)) return false
    const abs = Math.abs(t.amountCents)
    if (match.amount_min_cents !== undefined && abs < match.amount_min_cents)
      return false
    if (match.amount_max_cents !== undefined && abs > match.amount_max_cents)
      return false
    return true
  }
}

export const matchText = (t: Txn) =>
  normalizeText(t.merchant ?? t.description ?? "")

export type RuleOutcome = {
  category?: string
  merchant?: string
  hidden?: boolean
  reviewed?: boolean
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
    if (!rule.enabled || !test(t, text)) continue
    out.ruleIds.push(rule.id)
    const a = rule.action
    if (a.category !== undefined && out.category === undefined)
      out.category = a.category
    if (a.merchant !== undefined && out.merchant === undefined)
      out.merchant = a.merchant
    if (a.hide !== undefined && out.hidden === undefined) out.hidden = a.hide
    if (a.mark_reviewed !== undefined && out.reviewed === undefined)
      out.reviewed = a.mark_reviewed
    for (const tag of a.tags ?? [])
      if (!out.tags.includes(tag)) out.tags.push(tag)
  }
  return out
}

export function orderRules(rules: Rule[]) {
  return rules
    .toSorted(
      (a, b) =>
        a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .map((rule) => ({ rule, test: compileMatch(rule.match) }))
}
