import { Hono } from "hono"
import {
  applyRules,
  compileMatch,
  matchText,
  RuleAction,
  RuleMatch,
} from "../rules.ts"
import { z } from "zod"
import {
  HttpError,
  notFound,
  body,
  id,
  now,
  txnJson,
  type Ctx,
} from "./context.ts"
import type { Computed } from "../model.ts"
import { RuleBody } from "./schemas.ts"

export function registerRules(api: Hono, ctx: Ctx) {
  const { model, db, write, validCategory } = ctx
  const checkAction = (m: Computed, a: RuleAction) => {
    if (a.category) validCategory(m, a.category)
    for (const p of a.split ?? []) validCategory(m, p.category)
  }
  api.get("/rules", (c) => {
    const m = model.get()
    const tests = m.rules.map((r) => ({ rule: r, test: compileMatch(r.match) }))
    const counts = new Map<string, number>()
    for (const t of m.txns) {
      const text = matchText(t)
      for (const { rule, test } of tests)
        if (
          (!rule.appliesFrom || t.snapshot.date >= rule.appliesFrom) &&
          test(t, text)
        )
          counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1)
    }
    return c.json(
      m.rules.map((r) => ({ ...r, matches: counts.get(r.id) ?? 0 }))
    )
  })
  api.get("/rules/:id", (c) => {
    const r = model.get().rules.find((x) => x.id === c.req.param("id"))
    if (!r) throw notFound("Rule")
    return c.json(r)
  })
  api.post("/rules/preview", async (c) => {
    const b = await body(
      c,
      z
        .object({
          match: RuleMatch,
          action: RuleAction.optional(),
          ruleId: z.string().optional(),
          appliesFrom: z.string().nullable().optional(),
        })
        .strict()
    )
    const m = model.get()
    const test = compileMatch(b.match)
    const matched = m.txns.filter(
      (t) =>
        (!b.appliesFrom || t.snapshot.date >= b.appliesFrom) &&
        test(t, matchText(t))
    )
    // Would this rule actually decide each field, given the rules ahead of it?
    const ahead = m.rules.filter((r) => r.enabled && r.id !== b.ruleId)
    let changes = 0
    if (b.action?.category) {
      const ordered = ahead.map((rule) => ({
        rule,
        test: compileMatch(rule.match),
      }))
      for (const t of matched) {
        const before = applyRules(ordered, t)
        if (!before.category && t.categoryEff !== b.action.category) changes++
      }
    }
    return c.json({
      total: matched.length,
      changes,
      items: matched.slice(0, 25).map((t) => txnJson(m, t)),
    })
  })
  api.post("/rules", async (c) => {
    const b = await body(c, RuleBody)
    const m = model.get()
    checkAction(m, b.action)
    const ruleId = id("rule")
    write(() => {
      const max = (
        db
          .prepare("SELECT COALESCE(MAX(position), -1) AS p FROM rules")
          .get() as { p: number }
      ).p
      db.prepare(
        "INSERT INTO rules(id,position,enabled,match_json,action_json,created_at,applies_from) VALUES(?,?,?,?,?,?,?)"
      ).run(
        ruleId,
        max + 1,
        Number(b.enabled ?? true),
        JSON.stringify(b.match),
        JSON.stringify(b.action),
        now(),
        b.appliesFrom ?? null
      )
    })
    return c.json({ id: ruleId }, 201)
  })
  api.patch("/rules/:id", async (c) => {
    const b = await body(c, RuleBody.partial())
    const m = model.get()
    const r = m.rules.find((x) => x.id === c.req.param("id"))
    if (!r) throw notFound("Rule")
    if (b.action) checkAction(m, b.action)
    write(() =>
      db
        .prepare(
          "UPDATE rules SET match_json=?, action_json=?, enabled=?, applies_from=? WHERE id=?"
        )
        .run(
          JSON.stringify(b.match ?? r.match),
          JSON.stringify(b.action ?? r.action),
          Number(b.enabled ?? r.enabled),
          b.appliesFrom === undefined ? r.appliesFrom : b.appliesFrom,
          r.id
        )
    )
    return c.json({ ok: true })
  })
  api.delete("/rules/:id", (c) => {
    write(() =>
      db.prepare("DELETE FROM rules WHERE id=?").run(c.req.param("id"))
    )
    return c.json({ ok: true })
  })
  api.post("/rules/order", async (c) => {
    const b = await body(
      c,
      z.object({ ids: z.array(z.string()).max(1000) }).strict()
    )
    const known = new Set(model.get().rules.map((r) => r.id))
    if (b.ids.length !== known.size || b.ids.some((x) => !known.has(x)))
      throw new HttpError(409, "Rules changed; reload and try again")
    write(() =>
      b.ids.forEach((ruleId, i) =>
        db.prepare("UPDATE rules SET position=? WHERE id=?").run(i, ruleId)
      )
    )
    return c.json({ ok: true })
  })
}
