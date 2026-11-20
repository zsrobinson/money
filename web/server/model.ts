import type { AppDb } from "./app-db.ts"
import type { Account, Detail, DetailStore, Txn } from "./detail.ts"
import { normalizeText } from "./normalize.ts"
import {
  applyRules,
  matchText,
  orderRules,
  RuleAction,
  RuleMatch,
  type Rule,
} from "./rules.ts"

export type Group = "income" | "expense" | "transfer"
export type CategoryInfo = {
  code: string
  label: string
  group: Group
  /** Owned top-level code this rolls up to (itself when owned). */
  owned: string
  parent: string | null
  custom: boolean
  hidden: boolean
  sort: number
}
export type Split = { idx: number; amountCents: number; category: string; note: string | null }
export type EffTxn = Txn & {
  snapshot: { category: string; merchant: string | null }
  categoryEff: string
  merchantEff: string | null
  merchantKey: string
  hidden: boolean
  reviewed: boolean
  note: string | null
  tags: string[]
  splits: Split[] | null
  ruleIds: string[]
  override: { category: boolean; merchant: boolean; hidden: boolean; reviewed: boolean }
}
export type AccountView = Account & {
  name: string
  institution: string
  sourceStatus: string
  hidden: boolean
  excludeNetWorth: boolean
  liability: boolean
  /** Signed: liabilities are negative. Null when unknown. */
  balanceCents: number | null
}
export type Allocation = { txn: EffTxn; category: string; owned: string; group: Group; amountCents: number }

export type Computed = {
  detail: Detail
  today: string
  categories: CategoryInfo[]
  category: (code: string) => CategoryInfo
  accounts: AccountView[]
  account: Map<string, AccountView>
  txns: EffTxn[]
  txn: Map<string, EffTxn>
  allocations: Allocation[]
  rules: Rule[]
  tags: { id: string; name: string; hue: string | null }[]
}

export const isLiability = (a: Pick<Account, "type">) =>
  a.type === "credit" || a.type === "loan"

export function loadRules(db: AppDb): Rule[] {
  return (
    db.prepare("SELECT * FROM rules ORDER BY position, id").all() as Record<string, unknown>[]
  ).flatMap((r) => {
    const match = RuleMatch.safeParse(JSON.parse(String(r.match_json)))
    const action = RuleAction.safeParse(JSON.parse(String(r.action_json)))
    // A rule written by a newer app version is ignored rather than misapplied.
    if (!match.success || !action.success) return []
    return [
      {
        id: String(r.id),
        position: Number(r.position),
        enabled: Boolean(r.enabled),
        match: match.data,
        action: action.data,
        createdAt: String(r.created_at),
      },
    ]
  })
}

function buildCategories(detail: Detail, db: AppDb) {
  const rows = db.prepare("SELECT * FROM categories").all() as {
    code: string
    label: string
    grp: Group
    parent: string | null
    hidden: number
    sort: number | null
  }[]
  const edits = new Map(rows.map((r) => [r.code, r]))
  const owned = new Map(detail.categories.map((c) => [c.code, c]))
  const list: CategoryInfo[] = detail.categories.map((c) => {
    const edit = edits.get(c.code)
    return {
      code: c.code,
      label: edit?.label || c.label,
      group: c.group,
      owned: c.code,
      parent: null,
      custom: false,
      hidden: Boolean(edit?.hidden),
      sort: edit?.sort ?? c.sort,
    }
  })
  for (const r of rows) {
    if (owned.has(r.code)) continue
    const parent = r.parent ? owned.get(r.parent) : undefined
    if (!parent) continue
    list.push({
      code: r.code,
      label: r.label,
      group: parent.group,
      owned: parent.code,
      parent: parent.code,
      custom: true,
      hidden: Boolean(r.hidden),
      sort: r.sort ?? parent.sort + 0.5,
    })
  }
  const map = new Map(list.map((c) => [c.code, c]))
  const fallback = map.get("other")
  const category = (code: string): CategoryInfo =>
    map.get(code) ??
    fallback ?? {
      code,
      label: code,
      group: "expense",
      owned: code,
      parent: null,
      custom: false,
      hidden: false,
      sort: 999,
    }
  list.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  return { list, category }
}

function compute(detail: Detail, db: AppDb, today: string): Computed {
  const { list: categories, category } = buildCategories(detail, db)
  const sourceById = new Map(detail.sources.map((s) => [s.id, s]))
  const accountOverrides = new Map(
    (
      db.prepare("SELECT * FROM account_overrides").all() as {
        account_id: string
        display_name: string | null
        hidden: number
        exclude_net_worth: number
      }[]
    ).map((r) => [r.account_id, r])
  )
  const accounts: AccountView[] = detail.accounts.map((a) => {
    const o = accountOverrides.get(a.id)
    const liability = isLiability(a)
    const source = sourceById.get(a.sourceId)
    return {
      ...a,
      name: o?.display_name || a.label,
      institution: source?.institution ?? "Source",
      sourceStatus: source?.status ?? "healthy",
      hidden: Boolean(o?.hidden),
      excludeNetWorth: Boolean(o?.exclude_net_worth),
      liability,
      balanceCents:
        a.currentCents == null ? null : liability ? -a.currentCents : a.currentCents,
    }
  })
  const rules = loadRules(db)
  const ordered = orderRules(rules)
  const overrides = new Map(
    (
      db.prepare("SELECT * FROM txn_overrides").all() as {
        txn_id: string
        category: string | null
        merchant: string | null
        note: string | null
        hidden: number | null
        reviewed: number | null
      }[]
    ).map((r) => [r.txn_id, r])
  )
  const splits = new Map<string, Split[]>()
  for (const r of db
    .prepare("SELECT * FROM txn_splits ORDER BY txn_id, idx")
    .all() as { txn_id: string; idx: number; amount_cents: number; category: string; note: string | null }[]) {
    let s = splits.get(r.txn_id)
    if (!s) splits.set(r.txn_id, (s = []))
    s.push({ idx: r.idx, amountCents: r.amount_cents, category: r.category, note: r.note })
  }
  const txnTags = new Map<string, string[]>()
  for (const r of db.prepare("SELECT * FROM txn_tags").all() as { txn_id: string; tag_id: string }[]) {
    let s = txnTags.get(r.txn_id)
    if (!s) txnTags.set(r.txn_id, (s = []))
    s.push(r.tag_id)
  }
  const tags = db.prepare("SELECT id, name, hue FROM tags ORDER BY name").all() as Computed["tags"]
  const tagIds = new Set(tags.map((t) => t.id))
  const txns: EffTxn[] = detail.transactions.map((t) => {
    const r = applyRules(ordered, t, matchText(t))
    const o = overrides.get(t.id)
    const categoryEff = o?.category ?? r.category ?? t.category
    const merchantEff = o?.merchant ?? r.merchant ?? t.merchant
    const allTags = [...r.tags]
    for (const tag of txnTags.get(t.id) ?? []) if (!allTags.includes(tag)) allTags.push(tag)
    return {
      ...t,
      snapshot: { category: t.category, merchant: t.merchant },
      categoryEff,
      merchantEff,
      merchantKey: normalizeText(merchantEff ?? t.description ?? ""),
      hidden: o?.hidden != null ? Boolean(o.hidden) : (r.hidden ?? false),
      reviewed: o?.reviewed != null ? Boolean(o.reviewed) : (r.reviewed ?? false),
      note: o?.note ?? null,
      tags: allTags.filter((id) => tagIds.has(id)),
      splits: splits.get(t.id) ?? null,
      ruleIds: r.ruleIds,
      override: {
        category: o?.category != null,
        merchant: o?.merchant != null,
        hidden: o?.hidden != null,
        reviewed: o?.reviewed != null,
      },
    }
  })
  const allocations: Allocation[] = []
  for (const t of txns) {
    if (t.hidden) continue
    const parts = t.splits?.length
      ? t.splits.map((s) => ({ category: s.category, amountCents: s.amountCents }))
      : [{ category: t.categoryEff, amountCents: t.amountCents }]
    for (const p of parts) {
      const c = category(p.category)
      allocations.push({ txn: t, category: c.code, owned: c.owned, group: c.group, amountCents: p.amountCents })
    }
  }
  return {
    detail,
    today,
    categories,
    category,
    accounts,
    account: new Map(accounts.map((a) => [a.id, a])),
    txns,
    txn: new Map(txns.map((t) => [t.id, t])),
    allocations,
    rules,
    tags,
  }
}

/** Recomputes when the snapshot reloads or the app database is written. */
export function createModel(store: DetailStore, db: AppDb, today: () => string) {
  let version = 0
  let cached: { key: string; value: Computed } | undefined
  return {
    get(): Computed {
      const detail = store.get()
      const key = `${detail.loadedAt}:${version}:${today()}`
      if (cached?.key !== key) cached = { key, value: compute(detail, db, today()) }
      return cached.value
    },
    /** Call after every committed app database write. */
    invalidate() {
      version++
    },
    db,
    store,
  }
}
export type Model = ReturnType<typeof createModel>
