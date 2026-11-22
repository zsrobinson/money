import type { AppDb } from "./app-db.ts"
import type { Account, Detail, DetailStore, Txn } from "./detail.ts"
import { normalizeText } from "./normalize.ts"
import {
  applyRules,
  matchText,
  orderRules,
  splitByShare,
  RuleAction,
  RuleMatch,
  type Rule,
} from "./rules.ts"

export type Group = "income" | "expense" | "transfer"
export type BudgetKind = "fixed" | "flexible" | "non_monthly"
export type CategoryInfo = {
  code: string
  label: string
  /** The built-in name before any shortening or rename, for tooltips. */
  fullLabel: string
  group: Group
  /** Owned top-level code this rolls up to outside the app. */
  owned: string
  parent: string | null
  custom: boolean
  hidden: boolean
  sort: number
  /** A lucide icon name from the app's set. */
  icon: string
  /** A palette key (see CATEGORY_COLORS); fixed so a category keeps its colour. */
  color: string
  /** Built-in only: merged into this category. */
  mergedInto: string | null
  budgetKind: BudgetKind
}
export type Split = {
  idx: number
  amountCents: number
  category: string
  note: string | null
  /** Owned code outside the app, from the evaluator's result before a merge. */
  owned?: string
}
export type EffTxn = Txn & {
  snapshot: { category: string; merchant: string | null; date: string }
  categoryEff: string
  /** Owned code outside the app, from the evaluator's result before a merge. */
  ownedEff: string
  merchantEff: string | null
  merchantKey: string
  hidden: boolean
  reviewed: boolean
  note: string | null
  tags: string[]
  splits: Split[] | null
  /** A rule's percentage split rather than the person's own. */
  ruleSplit: boolean
  /** Counted in the review queue: not reviewed, after the review start. */
  needsReview: boolean
  /** A rule marks this merchant as recurring. */
  markedRecurring: boolean
  ruleIds: string[]
  override: {
    category: boolean
    merchant: boolean
    hidden: boolean
    reviewed: boolean
    date: boolean
  }
}
export type AccountView = Account & {
  /** Kept by hand in the app database. */
  manual: boolean
  /** For manual accounts: cash, credit, loan, investment, property, vehicle or other. */
  manualType: string | null
  closedAt: string | null
  name: string
  institution: string
  sourceStatus: string
  hidden: boolean
  excludeNetWorth: boolean
  liability: boolean
  /** Signed: liabilities are negative. Null when unknown. */
  balanceCents: number | null
}
export type Allocation = {
  txn: EffTxn
  category: string
  owned: string
  group: Group
  amountCents: number
}

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
  /** Snapshot history plus manual accounts' stated balances, by account. */
  balanceHistory: Detail["balanceHistory"]
  review: { enabled: boolean; since: string | null }
}

/** Fixed colours for built-in categories so each keeps one colour everywhere. */
export const CATEGORY_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "magenta",
  "red-soft",
  "orange-soft",
  "yellow-soft",
  "green-soft",
  "cyan-soft",
  "blue-soft",
  "purple-soft",
  "magenta-soft",
  "gray",
] as const
/** Built-in top-level categories each hold their own palette slot. */
const BUILT_IN_STYLE: Record<string, { icon: string; color: string }> = {
  food: { icon: "utensils", color: "orange" },
  transport: { icon: "car", color: "blue" },
  shopping: { icon: "shopping-bag", color: "magenta" },
  travel: { icon: "plane", color: "cyan" },
  personal_care: { icon: "sparkles", color: "magenta-soft" },
  housing: { icon: "house", color: "yellow" },
  health: { icon: "heart-pulse", color: "red" },
  entertainment: { icon: "clapperboard", color: "purple" },
  income: { icon: "banknote", color: "green" },
  fees: { icon: "receipt", color: "red-soft" },
  loan_payments: { icon: "landmark", color: "cyan-soft" },
  bank_transfer: { icon: "arrow-left-right", color: "green-soft" },
  internal_transfer: { icon: "repeat", color: "blue-soft" },
  peer_payment: { icon: "users", color: "purple-soft" },
  other: { icon: "circle-dashed", color: "gray" },
}
export const BUILT_IN_COLORS = Object.fromEntries(
  Object.entries(BUILT_IN_STYLE).map(([k, v]) => [k, v.color])
)
/** Shorter names where the built-in one truncates in lists. */
const SHORT_LABELS: Record<string, string> = {
  bank_transfer: "Transfers",
  internal_transfer: "Internal transfers",
  other: "Other",
}
/** Peer payments count in spending and income by default, not transfers. */
const GROUP_DEFAULTS: Record<string, Group> = { peer_payment: "expense" }
/** Outside the app, a custom top-level category reports as this owned code. */
export const OWNED_FOR_GROUP: Record<Group, string> = {
  income: "income",
  expense: "other",
  transfer: "bank_transfer",
}
const hashIndex = (s: string, n: number) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % n
}
export const MANUAL_TYPES = [
  "cash",
  "credit",
  "loan",
  "investment",
  "property",
  "vehicle",
  "other",
] as const
const SNAPSHOT_TYPE: Record<string, { type: string; subtype: string | null }> =
  {
    cash: { type: "depository", subtype: "cash" },
    credit: { type: "credit", subtype: "credit card" },
    loan: { type: "loan", subtype: null },
    investment: { type: "investment", subtype: null },
    property: { type: "other", subtype: "property" },
    vehicle: { type: "other", subtype: "vehicle" },
    other: { type: "other", subtype: null },
  }

export const isLiability = (a: Pick<Account, "type">) =>
  a.type === "credit" || a.type === "loan"

const ACTION_KEYS = new Set([
  "category",
  "merchant",
  "hide",
  "mark_reviewed",
  "tags",
  "split",
  "mark_recurring",
])

export function loadRules(db: AppDb): Rule[] {
  return (
    db.prepare("SELECT * FROM rules ORDER BY position, id").all() as Record<
      string,
      unknown
    >[]
  ).flatMap((r) => {
    const match = RuleMatch.safeParse(JSON.parse(String(r.match_json)))
    // Action keys this version does not know are ignored; unknown match
    // keys make the rule match nothing (the strict schema skips it).
    const rawAction = JSON.parse(String(r.action_json)) as unknown
    const action = RuleAction.safeParse(
      rawAction && typeof rawAction === "object" && !Array.isArray(rawAction)
        ? Object.fromEntries(
            Object.entries(rawAction).filter(([k]) => ACTION_KEYS.has(k))
          )
        : rawAction
    )
    // A rule written by a newer app version is ignored rather than misapplied.
    if (!match.success || !action.success) return []
    return [
      {
        id: String(r.id),
        position: Number(r.position),
        enabled: Boolean(r.enabled),
        match: match.data,
        action: action.data,
        appliesFrom: (r.applies_from as string | null) ?? null,
        createdAt: String(r.created_at),
      },
    ]
  })
}

function buildCategories(detail: Detail, db: AppDb) {
  const rows = db.prepare("SELECT * FROM categories ORDER BY rowid").all() as {
    code: string
    label: string
    grp: Group
    parent: string | null
    hidden: number
    sort: number | null
    icon: string | null
    color: string | null
    merged_into: string | null
    budget_kind: string | null
  }[]
  const edits = new Map(rows.map((r) => [r.code, r]))
  const owned = new Map(detail.categories.map((c) => [c.code, c]))
  const kind = (k: string | null | undefined): BudgetKind =>
    k === "flexible" || k === "non_monthly" ? k : "fixed"
  const list: CategoryInfo[] = detail.categories.map((c) => {
    const edit = edits.get(c.code)
    const style = BUILT_IN_STYLE[c.code]
    return {
      code: c.code,
      label: edit?.label || SHORT_LABELS[c.code] || c.label,
      fullLabel: c.label,
      group: GROUP_DEFAULTS[c.code] ?? c.group,
      owned: c.code,
      parent: null,
      custom: false,
      hidden: Boolean(edit?.hidden) || Boolean(edit?.merged_into),
      sort: edit?.sort ?? c.sort,
      icon: edit?.icon || style?.icon || "circle",
      color:
        edit?.color ||
        style?.color ||
        CATEGORY_COLORS[hashIndex(c.code, CATEGORY_COLORS.length)],
      mergedInto:
        edit?.merged_into && edit.merged_into !== c.code
          ? edit.merged_into
          : null,
      budgetKind: kind(edit?.budget_kind),
    }
  })
  const byCode = new Map(list.map((c) => [c.code, c]))
  const custom = rows.filter((r) => !owned.has(r.code))
  // Custom top-level rows first, so their children can find them. Without
  // a colour of their own they take the first slot no other top-level
  // category holds, in creation order.
  const taken = new Set(list.map((c) => c.color))
  const nextSlot = () =>
    CATEGORY_COLORS.find((c) => !taken.has(c)) ??
    CATEGORY_COLORS[taken.size % CATEGORY_COLORS.length]
  for (const r of custom.filter((r) => !r.parent)) {
    const group: Group = ["income", "expense", "transfer"].includes(r.grp)
      ? r.grp
      : "expense"
    const info: CategoryInfo = {
      code: r.code,
      label: r.label,
      fullLabel: r.label,
      group,
      owned: OWNED_FOR_GROUP[group],
      parent: null,
      custom: true,
      hidden: Boolean(r.hidden),
      sort: r.sort ?? 900,
      icon: r.icon || "folder",
      color: r.color || nextSlot(),
      mergedInto: null,
      budgetKind: kind(r.budget_kind),
    }
    taken.add(info.color)
    list.push(info)
    byCode.set(r.code, info)
  }
  for (const r of custom.filter((r) => r.parent)) {
    const parent = byCode.get(r.parent!)
    // One level of children; a row whose parent is gone is ignored.
    if (!parent || parent.parent) continue
    const info: CategoryInfo = {
      code: r.code,
      label: r.label,
      fullLabel: r.label,
      group: parent.group,
      owned: parent.custom ? parent.owned : parent.code,
      parent: parent.code,
      custom: true,
      hidden: Boolean(r.hidden),
      sort: r.sort ?? parent.sort + 0.5,
      icon: r.icon || parent.icon,
      // A tint of its parent's colour, so the family reads together.
      color: r.color || `${parent.color}/tint`,
      mergedInto: null,
      budgetKind: kind(r.budget_kind ?? parent.budgetKind),
    }
    list.push(info)
    byCode.set(r.code, info)
  }
  // Outside the app, a merged built-in's code (and anything rolling up to it)
  // reports as the merge target.
  for (const c of list) {
    const target = byCode.get(c.owned)?.mergedInto
    if (target && byCode.has(target)) c.owned = target
  }
  const fallback = byCode.get("other")
  const category = (code: string): CategoryInfo =>
    byCode.get(code) ??
    fallback ?? {
      code,
      label: code,
      fullLabel: code,
      group: "expense",
      owned: code,
      parent: null,
      custom: false,
      hidden: false,
      sort: 999,
      icon: "circle",
      color: "orange-soft",
      mergedInto: null,
      budgetKind: "fixed",
    }
  /** A merged built-in category's transactions count under its target. */
  const resolve = (code: string) => {
    const target = byCode.get(code)?.mergedInto
    return target && byCode.has(target) ? target : code
  }
  list.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  return { list, category, resolve }
}

type ManualAccountRow = {
  id: string
  name: string
  type: string
  currency: string
  created_at: string
  closed_at: string | null
}
type ManualTxnRow = {
  id: string
  account_id: string
  date: string
  amount_cents: number
  merchant: string | null
  category: string
  created_at: string
}

/**
 * Manual accounts' balances: the latest stated balance on or before a day,
 * plus that account's manual transactions after it. A liability's amount
 * owed moves opposite to the transaction amount.
 */
export function manualHistory(
  account: { type: string },
  statements: { date: string; cents: number }[],
  txns: { date: string; amountCents: number }[]
) {
  const liability = account.type === "credit" || account.type === "loan"
  const dates = [
    ...new Set([...statements.map((s) => s.date), ...txns.map((t) => t.date)]),
  ].sort()
  const stated = new Map(statements.map((s) => [s.date, s.cents]))
  const moved = new Map<string, number>()
  for (const t of txns)
    moved.set(
      t.date,
      (moved.get(t.date) ?? 0) + (liability ? -t.amountCents : t.amountCents)
    )
  const out: { date: string; cents: number; estimated: boolean }[] = []
  let balance = 0
  for (const d of dates) {
    // A statement is the balance at the end of its day, after that day's
    // transactions; later transactions move it.
    if (stated.has(d)) balance = stated.get(d)!
    else balance += moved.get(d) ?? 0
    out.push({ date: d, cents: balance, estimated: false })
  }
  return out
}

function compute(detail: Detail, db: AppDb, today: string): Computed {
  const { list: categories, category, resolve } = buildCategories(detail, db)
  const setting = (key: string) => {
    const row = db
      .prepare("SELECT value_json FROM settings WHERE key=?")
      .get(key) as { value_json: string } | undefined
    try {
      return row ? (JSON.parse(row.value_json) as unknown) : undefined
    } catch {
      return undefined
    }
  }
  const reviewSince = setting("reviewSince")
  const review = {
    enabled: setting("reviewNewTransactions") !== false,
    since:
      typeof reviewSince === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reviewSince)
        ? reviewSince
        : null,
  }
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
  const manualAccounts = db
    .prepare("SELECT * FROM manual_accounts ORDER BY created_at, id")
    .all() as ManualAccountRow[]
  const manualRows = db
    .prepare("SELECT * FROM manual_txns ORDER BY date DESC, id")
    .all() as ManualTxnRow[]
  const balanceHistory = new Map(detail.balanceHistory)
  const manualSnapshot = manualAccounts.map((m): Account => {
    const statements = (
      db
        .prepare(
          "SELECT date, cents FROM manual_balances WHERE account_id=? ORDER BY date"
        )
        .all(m.id) as { date: string; cents: number }[]
    ).map((r) => ({ date: r.date, cents: r.cents }))
    const history = manualHistory(
      m,
      statements,
      manualRows
        .filter((t) => t.account_id === m.id)
        .map((t) => ({ date: t.date, amountCents: t.amount_cents }))
    )
    balanceHistory.set(m.id, history)
    const shape = SNAPSHOT_TYPE[m.type] ?? SNAPSHOT_TYPE.other
    return {
      id: m.id,
      sourceId: "manual",
      label: m.name,
      officialName: null,
      type: shape.type,
      subtype: shape.subtype,
      mask: null,
      currency: m.currency,
      currentCents: history.at(-1)?.cents ?? null,
      availableCents: null,
      limitCents: null,
      availability: m.closed_at ? "historical" : "available",
      scope: "own",
    }
  })
  const manualById = new Map(manualAccounts.map((m) => [m.id, m]))
  const accounts: AccountView[] = [...detail.accounts, ...manualSnapshot].map(
    (a) => {
      const o = accountOverrides.get(a.id)
      const liability = isLiability(a)
      const source = sourceById.get(a.sourceId)
      const manual = manualById.get(a.id)
      return {
        ...a,
        manual: Boolean(manual),
        manualType: manual?.type ?? null,
        closedAt: manual?.closed_at ?? null,
        name: o?.display_name || a.label,
        institution: manual ? "Manual" : (source?.institution ?? "Source"),
        sourceStatus: source?.status ?? "healthy",
        hidden: Boolean(o?.hidden),
        excludeNetWorth: Boolean(o?.exclude_net_worth),
        liability,
        balanceCents:
          a.currentCents == null
            ? null
            : liability
              ? -a.currentCents
              : a.currentCents,
      }
    }
  )
  const rules = loadRules(db)
  const ordered = orderRules(rules)
  const overrides = new Map(
    (
      db.prepare("SELECT * FROM txn_overrides").all() as {
        txn_id: string
        category: string | null
        merchant: string | null
        date: string | null
        note: string | null
        hidden: number | null
        reviewed: number | null
      }[]
    ).map((r) => [r.txn_id, r])
  )
  const splits = new Map<string, Split[]>()
  for (const r of db
    .prepare("SELECT * FROM txn_splits ORDER BY txn_id, idx")
    .all() as {
    txn_id: string
    idx: number
    amount_cents: number
    category: string
    note: string | null
  }[]) {
    let s = splits.get(r.txn_id)
    if (!s) splits.set(r.txn_id, (s = []))
    s.push({
      idx: r.idx,
      amountCents: r.amount_cents,
      category: r.category,
      note: r.note,
    })
  }
  const txnTags = new Map<string, string[]>()
  for (const r of db.prepare("SELECT * FROM txn_tags").all() as {
    txn_id: string
    tag_id: string
  }[]) {
    let s = txnTags.get(r.txn_id)
    if (!s) txnTags.set(r.txn_id, (s = []))
    s.push(r.tag_id)
  }
  const tags = db
    .prepare("SELECT id, name, hue FROM tags ORDER BY name")
    .all() as Computed["tags"]
  const tagIds = new Set(tags.map((t) => t.id))
  const manualTxns = manualRows.flatMap((r): Txn[] => {
    const account = manualById.get(r.account_id)
    if (!account) return []
    return [
      {
        id: r.id,
        accountId: r.account_id,
        date: r.date,
        authorizedDate: null,
        amountCents: r.amount_cents,
        currency: account.currency,
        merchant: r.merchant,
        description: null,
        category: r.category,
        detailedCategory: null,
        flowKind: "activity",
        pending: false,
        transferPairId: null,
        website: null,
        paymentChannel: null,
        manual: true,
      },
    ]
  })
  const source = manualTxns.length
    ? [...detail.transactions, ...manualTxns].sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1
      )
    : detail.transactions
  const txns: EffTxn[] = source.map((t) => {
    const r = applyRules(ordered, t, matchText(t))
    const o = overrides.get(t.id)
    const rawCategory = o?.category ?? r.category ?? t.category
    const merchantEff = o?.merchant ?? r.merchant ?? t.merchant
    const own = splits.get(t.id)
    const shared = !own && r.split ? splitByShare(t.amountCents, r.split) : null
    const date = o?.date ?? t.date
    const hidden = o?.hidden != null ? Boolean(o.hidden) : (r.hidden ?? false)
    const reviewed =
      o?.reviewed != null ? Boolean(o.reviewed) : (r.reviewed ?? false)
    const allTags = [...r.tags]
    for (const tag of txnTags.get(t.id) ?? [])
      if (!allTags.includes(tag)) allTags.push(tag)
    return {
      ...t,
      date,
      snapshot: { category: t.category, merchant: t.merchant, date: t.date },
      categoryEff: resolve(shared?.single ?? rawCategory),
      ownedEff: category(shared?.single ?? rawCategory).owned,
      merchantEff,
      merchantKey: normalizeText(merchantEff ?? t.description ?? ""),
      hidden,
      reviewed,
      needsReview:
        review.enabled &&
        !reviewed &&
        !hidden &&
        !t.pending &&
        // A matched transfer between your own accounts needs no review.
        !t.transferPairId &&
        (!review.since || date >= review.since),
      markedRecurring: r.recurring ?? false,
      note: o?.note ?? null,
      tags: allTags.filter((id) => tagIds.has(id)),
      splits: own
        ? own.map((x) => ({
            ...x,
            category: resolve(x.category),
            owned: category(x.category).owned,
          }))
        : shared?.parts.length
          ? shared.parts.map((x, idx) => ({
              idx,
              amountCents: x.amountCents,
              category: resolve(x.category),
              owned: category(x.category).owned,
              note: null,
            }))
          : null,
      ruleSplit: !own && Boolean(shared?.parts.length),
      ruleIds: r.ruleIds,
      override: {
        category: o?.category != null,
        merchant: o?.merchant != null,
        hidden: o?.hidden != null,
        reviewed: o?.reviewed != null,
        date: o?.date != null,
      },
    }
  })
  // A corrected date can move a transaction; keep newest first.
  if (overrides.size || manualTxns.length)
    txns.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1
    )
  const allocations: Allocation[] = []
  for (const t of txns) {
    if (t.hidden) continue
    const parts = t.splits?.length
      ? t.splits.map((s) => ({
          category: s.category,
          owned: s.owned,
          amountCents: s.amountCents,
        }))
      : [
          {
            category: t.categoryEff,
            owned: t.ownedEff,
            amountCents: t.amountCents,
          },
        ]
    for (const p of parts) {
      const c = category(p.category)
      allocations.push({
        txn: t,
        category: c.code,
        owned: p.owned ?? c.owned,
        group: c.group,
        amountCents: p.amountCents,
      })
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
    balanceHistory,
    review,
  }
}

/** Recomputes when the snapshot reloads or the app database is written. */
export function createModel(
  store: DetailStore,
  db: AppDb,
  today: () => string
) {
  let version = 0
  let cached: { key: string; value: Computed } | undefined
  return {
    get(): Computed {
      const detail = store.get()
      const key = `${detail.loadedAt}:${version}:${today()}`
      if (cached?.key !== key)
        cached = { key, value: compute(detail, db, today()) }
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
