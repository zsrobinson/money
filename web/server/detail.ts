import { statSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

export type Source = {
  id: string
  kind: string
  institution: string
  status: "healthy" | "stale" | "error" | "disabled" | string
  lastSuccessAt: string | null
  dataKinds: string[]
}
export type Account = {
  id: string
  sourceId: string
  label: string
  officialName: string | null
  type: string
  subtype: string | null
  mask: string | null
  currency: string
  currentCents: number | null
  availableCents: number | null
  limitCents: number | null
  availability: "available" | "historical" | string
  scope: "own" | "separate" | string
}
export type Txn = {
  id: string
  accountId: string
  date: string
  authorizedDate: string | null
  amountCents: number
  currency: string
  merchant: string | null
  description: string | null
  category: string
  detailedCategory: string | null
  flowKind: "activity" | "bank_transfer" | "peer_payment" | string
  pending: boolean
  transferPairId: string | null
  website: string | null
  paymentChannel: string | null
}
export type Holding = {
  accountId: string
  securityId: string
  ticker: string | null
  name: string
  type: string
  currency: string
  quantity: number
  price: number | null
  valueCents: number
  costBasisCents: number | null
}
export type OwnedCategory = {
  code: string
  label: string
  group: "income" | "expense" | "transfer"
  parent: string | null
  sort: number
}

/** One immutable, fully loaded snapshot. Python replaces the file atomically. */
export type Detail = {
  schemaVersion: number
  generatedAt: string | null
  sources: Source[]
  accounts: Account[]
  transactions: Txn[]
  balanceHistory: Map<
    string,
    { date: string; cents: number; estimated: boolean }[]
  >
  holdings: Holding[]
  holdingHistory: {
    accountId: string
    securityId: string
    date: string
    quantity: number
    valueCents: number
  }[]
  categories: OwnedCategory[]
  recurringHints: RecurringHint[]
  loadedAt: number
}
export type RecurringHint = {
  sourceId: string
  merchant: string
  currency: string
  frequency: string | null
  lastChargedMonth: string | null
  active: boolean
}

const has = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (c) => c.name === column
  )

function parseKinds(value: unknown): string[] {
  if (typeof value !== "string" || !value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    /* comma separated */
  }
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export function loadDetail(path: string): Detail {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec("BEGIN")
    const meta = Object.fromEntries(
      (
        db.prepare("SELECT key, value FROM meta").all() as {
          key: string
          value: string
        }[]
      ).map((r) => [r.key, r.value])
    )
    const optional = (table: string, column: string, alias = column) =>
      has(db, table, column) ? `${column} AS ${alias}` : `NULL AS ${alias}`
    const sources = (
      db.prepare("SELECT * FROM sources").all() as Record<string, unknown>[]
    ).map((r): Source => ({
      id: String(r.id),
      kind: String(r.kind ?? "connection"),
      institution: String(r.institution ?? "Source"),
      status: String(r.status ?? "healthy"),
      lastSuccessAt: (r.last_success_at as string) ?? null,
      dataKinds: parseKinds(r.data_kinds),
    }))
    const accounts = (
      db
        .prepare(
          `SELECT id, source_id, label, ${optional("accounts", "official_name")}, type, subtype, mask, currency,
            current_cents, available_cents, limit_cents, availability, scope FROM accounts`
        )
        .all() as Record<string, unknown>[]
    ).map((r): Account => ({
      id: String(r.id),
      sourceId: String(r.source_id),
      label: String(r.label ?? r.subtype ?? r.type),
      officialName: (r.official_name as string) ?? null,
      type: String(r.type),
      subtype: (r.subtype as string) ?? null,
      mask: (r.mask as string) || null,
      currency: String(r.currency ?? "USD"),
      currentCents: (r.current_cents as number) ?? null,
      availableCents: (r.available_cents as number) ?? null,
      limitCents: (r.limit_cents as number) ?? null,
      availability: String(r.availability ?? "available"),
      scope: String(r.scope ?? "own"),
    }))
    const transactions = (
      db
        .prepare(
          `SELECT id, account_id, date, amount_cents, currency, merchant, description, category,
            detailed_category, flow_kind, pending, transfer_pair_id,
            ${optional("transactions", "authorized_date")}, ${optional("transactions", "website")},
            ${optional("transactions", "payment_channel")}
           FROM transactions ORDER BY date DESC, id`
        )
        .all() as Record<string, unknown>[]
    ).map((r): Txn => ({
      id: String(r.id),
      accountId: String(r.account_id),
      date: String(r.date),
      authorizedDate: (r.authorized_date as string) ?? null,
      amountCents: Number(r.amount_cents),
      currency: String(r.currency ?? "USD"),
      merchant: (r.merchant as string) || null,
      description: (r.description as string) || null,
      category: String(r.category ?? "other"),
      detailedCategory: (r.detailed_category as string) ?? null,
      flowKind: String(r.flow_kind ?? "activity"),
      pending: Boolean(r.pending),
      transferPairId: (r.transfer_pair_id as string) ?? null,
      website: (r.website as string) ?? null,
      paymentChannel: (r.payment_channel as string) ?? null,
    }))
    const balanceHistory = new Map<
      string,
      { date: string; cents: number; estimated: boolean }[]
    >()
    for (const r of db
      .prepare(
        `SELECT account_id, date, current_cents, ${optional("balance_history", "estimated")}
         FROM balance_history WHERE current_cents IS NOT NULL ORDER BY account_id, date`
      )
      .all() as Record<string, unknown>[]) {
      const id = String(r.account_id)
      let list = balanceHistory.get(id)
      if (!list) balanceHistory.set(id, (list = []))
      list.push({
        date: String(r.date),
        cents: Number(r.current_cents),
        estimated: Boolean(r.estimated),
      })
    }
    const holdings = (
      db
        .prepare(
          `SELECT account_id, security_id, ticker, name, type, currency, quantity,
            ${optional("holdings", "price")}, value_cents, cost_basis_cents FROM holdings`
        )
        .all() as Record<string, unknown>[]
    ).map((r): Holding => ({
      accountId: String(r.account_id),
      securityId: String(r.security_id),
      ticker: (r.ticker as string) || null,
      name: String(r.name ?? r.ticker ?? "Security"),
      type: String(r.type ?? "other"),
      currency: String(r.currency ?? "USD"),
      quantity: Number(r.quantity ?? 0),
      price: (r.price as number) ?? null,
      valueCents: Number(r.value_cents ?? 0),
      costBasisCents: (r.cost_basis_cents as number) ?? null,
    }))
    const holdingHistory = (
      db
        .prepare(
          "SELECT account_id, security_id, date, quantity, value_cents FROM holding_history ORDER BY date"
        )
        .all() as Record<string, unknown>[]
    ).map((r) => ({
      accountId: String(r.account_id),
      securityId: String(r.security_id),
      date: String(r.date),
      quantity: Number(r.quantity ?? 0),
      valueCents: Number(r.value_cents ?? 0),
    }))
    const categories = (
      db
        .prepare(
          'SELECT code, label, "group" AS grp, parent, sort FROM categories ORDER BY sort, code'
        )
        .all() as Record<string, unknown>[]
    ).map((r): OwnedCategory => ({
      code: String(r.code),
      label: String(r.label),
      group: (String(r.grp) as OwnedCategory["group"]) ?? "expense",
      parent: (r.parent as string) ?? null,
      sort: Number(r.sort ?? 0),
    }))
    const hasHints = Boolean(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='recurring_hints'"
        )
        .get()
    )
    const recurringHints = hasHints
      ? (
          db.prepare("SELECT * FROM recurring_hints").all() as Record<
            string,
            unknown
          >[]
        ).map((r): RecurringHint => ({
          sourceId: String(r.source_id ?? ""),
          merchant: String(r.merchant ?? ""),
          currency: String(r.currency ?? "USD"),
          frequency: (r.frequency as string) ?? null,
          lastChargedMonth: (r.last_charged_month as string) ?? null,
          active: Boolean(r.active ?? 1),
        }))
      : []
    db.exec("COMMIT")
    return {
      recurringHints,
      schemaVersion: Number(meta.schema_version ?? 0),
      generatedAt: meta.generated_at ?? null,
      sources,
      accounts,
      transactions,
      balanceHistory,
      holdings,
      holdingHistory,
      categories,
      loadedAt: Date.now(),
    }
  } finally {
    db.close()
  }
}

/**
 * Reloads when the published file changes (atomic rename gives a new inode).
 * A failed reload keeps serving the last good snapshot and reports it.
 */
export function detailStore(path: string) {
  let current: Detail | undefined
  let key = ""
  let lastError: string | undefined
  return {
    get(): Detail {
      let next: string
      try {
        const s = statSync(path)
        next = `${s.ino}:${s.mtimeMs}:${s.size}`
      } catch {
        lastError = "missing"
        if (current) return current
        throw new DetailUnavailable()
      }
      if (next !== key || !current) {
        try {
          current = loadDetail(path)
          key = next
          lastError = undefined
        } catch {
          lastError = "unreadable"
          if (!current) throw new DetailUnavailable()
        }
      }
      return current
    },
    status() {
      return {
        loaded: Boolean(current),
        error: lastError,
        generatedAt: current?.generatedAt ?? null,
        schemaVersion: current?.schemaVersion ?? 0,
      }
    },
  }
}
export type DetailStore = ReturnType<typeof detailStore>

export class DetailUnavailable extends Error {
  constructor() {
    super("Financial data is not available yet")
  }
}
