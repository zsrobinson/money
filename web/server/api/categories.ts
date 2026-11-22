import { Hono } from "hono"
import { z } from "zod"
import { CATEGORY_COLORS, type CategoryInfo, type Computed } from "../model.ts"
import { body, HttpError, id, notFound, type Ctx } from "./context.ts"

const Icon = z.string().regex(/^[a-z0-9-]{1,40}$/, "Choose an icon")
const Color = z.enum(CATEGORY_COLORS)
const Group = z.enum(["income", "expense", "transfer"])

const CategoryCreate = z
  .object({
    label: z.string().trim().min(1).max(60),
    /** A top-level category, or none to make a new top-level one (a group). */
    parent: z.string().min(1).max(100).nullable().optional(),
    /** Required for a new top-level category. */
    group: Group.optional(),
    icon: Icon.nullable().optional(),
    color: Color.nullable().optional(),
  })
  .strict()
const CategoryPatch = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    hidden: z.boolean().optional(),
    icon: Icon.nullable().optional(),
    color: Color.nullable().optional(),
    budgetKind: z.enum(["fixed", "flexible", "non_monthly"]).optional(),
    /** Custom only: move under another top-level category, or to the top. */
    parent: z.string().min(1).max(100).nullable().optional(),
    /** Custom top-level only. */
    group: Group.optional(),
    /** Built-in only: null restores a merged category. */
    mergedInto: z.null().optional(),
  })
  .strict()

export function categoryJson(m: Computed, x: CategoryInfo, count = 0) {
  return {
    code: x.code,
    label: x.label,
    fullLabel: x.fullLabel,
    group: x.group,
    parent: x.parent,
    custom: x.custom,
    hidden: x.hidden,
    icon: x.icon,
    color: x.color,
    budgetKind: x.budgetKind,
    mergedInto: x.mergedInto,
    children: m.categories.filter((c) => c.parent === x.code).length,
    transactions: count,
  }
}

export function registerCategories(api: Hono, ctx: Ctx) {
  const { model, db, write } = ctx
  const row = (code: string) =>
    db.prepare("SELECT * FROM categories WHERE code=?").get(code) as
      Record<string, unknown> | undefined
  /** Store a full row, keeping the columns this edit does not touch. */
  const save = (x: CategoryInfo, patch: Record<string, unknown>) => {
    const cur = row(x.code) ?? {}
    const next = {
      label: x.custom ? x.label : (cur.label ?? null),
      grp: x.group,
      parent: x.custom ? x.parent : null,
      hidden: Number(x.hidden && !x.mergedInto),
      sort: cur.sort ?? null,
      icon: cur.icon ?? null,
      color: cur.color ?? null,
      merged_into: cur.merged_into ?? null,
      budget_kind: cur.budget_kind ?? null,
      ...patch,
    }
    db.prepare(
      `INSERT INTO categories(code,label,grp,parent,hidden,sort,icon,color,merged_into,budget_kind)
       VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET label=excluded.label,
       grp=excluded.grp, parent=excluded.parent, hidden=excluded.hidden, sort=excluded.sort,
       icon=excluded.icon, color=excluded.color, merged_into=excluded.merged_into,
       budget_kind=excluded.budget_kind`
    ).run(
      x.code,
      // A built-in keeps its own name unless renamed; an empty label means that.
      (next.label as string | null) ?? "",
      next.grp as string,
      next.parent as string | null,
      next.hidden as number,
      next.sort as number | null,
      next.icon as string | null,
      next.color as string | null,
      next.merged_into as string | null,
      next.budget_kind as string | null
    )
  }
  const counts = (m: Computed) => {
    const n = new Map<string, number>()
    for (const t of m.txns) {
      n.set(t.categoryEff, (n.get(t.categoryEff) ?? 0) + 1)
      for (const s of t.splits ?? [])
        if (s.category !== t.categoryEff)
          n.set(s.category, (n.get(s.category) ?? 0) + 1)
    }
    return n
  }

  api.get("/categories", (c) => {
    const m = model.get()
    const n = counts(m)
    return c.json(m.categories.map((x) => categoryJson(m, x, n.get(x.code))))
  })
  api.post("/categories", async (c) => {
    const b = await body(c, CategoryCreate)
    const m = model.get()
    let group = b.group
    let sort: number | null = null
    if (b.parent) {
      const parent = m.categories.find((x) => x.code === b.parent)
      if (!parent || parent.parent)
        throw new HttpError(422, "Choose a top-level category to put it in")
      group = parent.group
      sort = parent.sort
    } else if (!group)
      throw new HttpError(422, "Choose income, spending or transfers")
    const code = id("cat")
    write(() =>
      db
        .prepare(
          "INSERT INTO categories(code,label,grp,parent,hidden,sort,icon,color) VALUES(?,?,?,?,0,?,?,?)"
        )
        .run(
          code,
          b.label,
          group!,
          b.parent ?? null,
          sort,
          b.icon ?? null,
          b.color ?? null
        )
    )
    return c.json({ code }, 201)
  })
  api.patch("/categories/:code", async (c) => {
    const b = await body(c, CategoryPatch)
    const m = model.get()
    const cat = m.categories.find((x) => x.code === c.req.param("code"))
    if (!cat) throw notFound("Category")
    const patch: Record<string, unknown> = {}
    if (b.label !== undefined) patch.label = b.label
    if (b.hidden !== undefined) patch.hidden = Number(b.hidden)
    if (b.icon !== undefined) patch.icon = b.icon
    if (b.color !== undefined) patch.color = b.color
    if (b.budgetKind !== undefined) patch.budget_kind = b.budgetKind
    if (b.mergedInto === null) {
      if (cat.custom || !cat.mergedInto)
        throw new HttpError(422, "Only a merged built-in category restores")
      patch.merged_into = null
      patch.hidden = 0
    }
    if (b.parent !== undefined || b.group !== undefined) {
      if (!cat.custom)
        throw new HttpError(422, "Built-in categories stay where they are")
      const kids = m.categories.filter((x) => x.parent === cat.code)
      if (b.parent) {
        const parent = m.categories.find((x) => x.code === b.parent)
        if (!parent || parent.parent || parent.code === cat.code)
          throw new HttpError(422, "Choose a top-level category to put it in")
        if (kids.length)
          throw new HttpError(
            409,
            "Move the categories inside it first; categories nest one level"
          )
        patch.parent = parent.code
        patch.grp = parent.group
      } else if (b.parent === null) {
        patch.parent = null
        patch.grp = b.group ?? cat.group
      } else if (b.group !== undefined) {
        if (cat.parent)
          throw new HttpError(
            422,
            "A category inside another takes its group from it"
          )
        patch.grp = b.group
      }
    }
    write(() => {
      save(cat, patch)
      // Children follow their custom parent's group.
      if (patch.grp && !patch.parent)
        db.prepare("UPDATE categories SET grp=? WHERE parent=?").run(
          patch.grp as string,
          cat.code
        )
    })
    return c.json({ ok: true })
  })

  /**
   * Move everything in one category to another: edits, splits, rules and
   * budgets. A custom category is then deleted; a built-in one is marked
   * merged, so the bank's category also counts under the target.
   */
  const merge = (m: Computed, from: CategoryInfo, into: CategoryInfo) => {
    if (from.code === into.code)
      throw new HttpError(422, "Choose a different category")
    if (into.mergedInto)
      throw new HttpError(422, "That category was merged; choose its target")
    const kids = m.categories.filter((x) => x.parent === from.code)
    if (kids.length && (into.parent || into.group !== from.group))
      throw new HttpError(
        409,
        "Its categories need a top-level category in the same group; move them first"
      )
    db.prepare("UPDATE txn_overrides SET category=? WHERE category=?").run(
      into.code,
      from.code
    )
    db.prepare("UPDATE txn_splits SET category=? WHERE category=?").run(
      into.code,
      from.code
    )
    db.prepare("UPDATE manual_txns SET category=? WHERE category=?").run(
      into.code,
      from.code
    )
    for (const r of m.rules) {
      const a = r.action
      const touches =
        a.category === from.code ||
        a.split?.some((p) => p.category === from.code)
      if (!touches) continue
      const next = {
        ...a,
        ...(a.category === from.code ? { category: into.code } : {}),
        ...(a.split
          ? {
              split: a.split.map((p) =>
                p.category === from.code ? { ...p, category: into.code } : p
              ),
            }
          : {}),
      }
      db.prepare("UPDATE rules SET action_json=? WHERE id=?").run(
        JSON.stringify(next),
        r.id
      )
    }
    // Budgets add together so the money stays planned.
    for (const table of ["budgets", "budget_plans"] as const) {
      const key = table === "budgets" ? "month" : "from_month"
      for (const r of db
        .prepare(
          `SELECT ${key} AS k, amount_cents FROM ${table} WHERE category=?`
        )
        .all(from.code) as { k: string; amount_cents: number }[]) {
        if (r.amount_cents >= 0)
          db.prepare(
            `INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT DO UPDATE SET amount_cents=max(amount_cents,0)+excluded.amount_cents`
          ).run(r.k, into.code, r.amount_cents)
      }
      db.prepare(`DELETE FROM ${table} WHERE category=?`).run(from.code)
    }
    db.prepare("UPDATE categories SET parent=? WHERE parent=?").run(
      into.code,
      from.code
    )
    if (from.custom)
      db.prepare("DELETE FROM categories WHERE code=?").run(from.code)
    else save(from, { merged_into: into.code, hidden: 1 })
  }
  api.post("/categories/:code/merge", async (c) => {
    const b = await body(c, z.object({ into: z.string().min(1) }).strict())
    const m = model.get()
    const from = m.categories.find((x) => x.code === c.req.param("code"))
    const into = m.categories.find((x) => x.code === b.into)
    if (!from) throw notFound("Category")
    if (!into) throw new HttpError(422, "Choose an existing category")
    write(() => merge(m, from, into))
    return c.json({ ok: true })
  })
  /** Delete a custom category, moving anything in it to `moveTo`. */
  api.delete("/categories/:code", (c) => {
    const m = model.get()
    const cat = m.categories.find((x) => x.code === c.req.param("code"))
    if (!cat?.custom)
      throw new HttpError(422, "Only your own categories can be deleted")
    const target = c.req.query("moveTo")
    const used =
      m.txns.some(
        (t) =>
          t.categoryEff === cat.code ||
          t.splits?.some((s) => s.category === cat.code)
      ) ||
      m.rules.some(
        (r) =>
          r.action.category === cat.code ||
          r.action.split?.some((p) => p.category === cat.code)
      ) ||
      m.categories.some((x) => x.parent === cat.code)
    if (target) {
      const into = m.categories.find((x) => x.code === target)
      if (!into) throw new HttpError(422, "Choose an existing category")
      write(() => merge(m, cat, into))
    } else if (used)
      throw new HttpError(
        409,
        "Choose a category to move its transactions and rules to"
      )
    else
      write(() => {
        db.prepare("DELETE FROM categories WHERE code=?").run(cat.code)
        db.prepare("DELETE FROM budgets WHERE category=?").run(cat.code)
        db.prepare("DELETE FROM budget_plans WHERE category=?").run(cat.code)
      })
    return c.json({ ok: true })
  })

  const TagBody = z
    .object({
      name: z.string().trim().min(1).max(40),
      hue: z
        .enum(["re", "or", "ye", "gr", "cy", "bl", "pu", "ma"])
        .nullable()
        .optional(),
    })
    .strict()
  api.get("/tags", (c) => {
    const m = model.get()
    const counts = new Map<string, number>()
    for (const t of m.txns)
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return c.json(
      m.tags.map((t) => ({ ...t, transactions: counts.get(t.id) ?? 0 }))
    )
  })
  api.post("/tags", async (c) => {
    const b = await body(c, TagBody)
    const tagId = id("tag")
    try {
      write(() =>
        db
          .prepare("INSERT INTO tags VALUES(?,?,?)")
          .run(tagId, b.name, b.hue ?? null)
      )
    } catch {
      throw new HttpError(409, "A tag with that name already exists")
    }
    return c.json({ id: tagId }, 201)
  })
  api.patch("/tags/:id", async (c) => {
    const b = await body(c, TagBody.partial())
    const tag = model.get().tags.find((t) => t.id === c.req.param("id"))
    if (!tag) throw notFound("Tag")
    try {
      write(() =>
        db
          .prepare("UPDATE tags SET name=?, hue=? WHERE id=?")
          .run(
            b.name ?? tag.name,
            b.hue === undefined ? tag.hue : b.hue,
            tag.id
          )
      )
    } catch {
      throw new HttpError(409, "A tag with that name already exists")
    }
    return c.json({ ok: true })
  })
  api.delete("/tags/:id", (c) => {
    const tagId = c.req.param("id")
    write(() => {
      db.prepare("DELETE FROM txn_tags WHERE tag_id=?").run(tagId)
      db.prepare("DELETE FROM tags WHERE id=?").run(tagId)
      // Rules stop adding it; a rule left with no action is turned off.
      for (const r of model.get().rules) {
        if (!r.action.tags?.includes(tagId)) continue
        const action = {
          ...r.action,
          tags: r.action.tags.filter((t) => t !== tagId),
        }
        if (!action.tags.length) delete (action as { tags?: string[] }).tags
        const empty = !Object.keys(action).length
        db.prepare("UPDATE rules SET action_json=?, enabled=? WHERE id=?").run(
          JSON.stringify(empty ? r.action : action),
          empty ? 0 : Number(r.enabled),
          r.id
        )
      }
    })
    return c.json({ ok: true })
  })
}
