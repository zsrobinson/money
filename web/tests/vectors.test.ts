// The app and the Python publisher must evaluate edits identically. These
// shared vectors (tests/overrides-v4-vectors.json at the repository root)
// run through both implementations.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { openAppDb } from "../server/app-db.ts"
import type { Detail, DetailStore, Txn } from "../server/detail.ts"
import { createModel } from "../server/model.ts"

type Vector = {
  name: string
  txn: {
    account_id: string
    date: string
    amount_cents: number
    category: string
    merchant: string | null
    description: string | null
    flow_kind: string
  }
  rules: {
    id: string
    position: number
    enabled: boolean | number
    match: unknown
    action: unknown
    applies_from?: string | null
  }[]
  override: Record<string, unknown> | null
  splits: { amount_cents: number; category: string }[]
  categories: Record<string, unknown>[]
  expected: {
    category: string
    owned: string
    hidden: boolean
    allocations: { category: string; owned: string; amount_cents: number }[]
  }
}

const { vectors } = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../tests/overrides-v4-vectors.json"),
    "utf8"
  )
) as { vectors: Vector[] }

const BUILT_IN: [string, string, "income" | "expense" | "transfer"][] = [
  ["food", "Food and drink", "expense"],
  ["transport", "Transport", "expense"],
  ["shopping", "Shopping", "expense"],
  ["travel", "Travel", "expense"],
  ["personal_care", "Personal care", "expense"],
  ["housing", "Housing and utilities", "expense"],
  ["health", "Health", "expense"],
  ["entertainment", "Entertainment", "expense"],
  ["income", "Income", "income"],
  ["fees", "Fees", "expense"],
  ["loan_payments", "Loan payments", "expense"],
  ["bank_transfer", "Bank transfers and card payments", "transfer"],
  ["internal_transfer", "Matched internal transfers", "transfer"],
  ["peer_payment", "Peer payments", "expense"],
  ["other", "Other or unclassified", "expense"],
]

function detailWith(txn: Txn): Detail {
  return {
    schemaVersion: 2,
    generatedAt: null,
    sources: [],
    accounts: [],
    transactions: [txn],
    balanceHistory: new Map(),
    holdings: [],
    holdingHistory: [],
    categories: BUILT_IN.map(([code, label, group], sort) => ({
      code,
      label,
      group,
      parent: null,
      sort,
    })),
    recurringHints: [],
    investmentTransactions: [],
    liabilities: [],
    loadedAt: 1,
  }
}

for (const v of vectors)
  test(`vector: ${v.name}`, () => {
    const txn: Txn = {
      id: "txn_vector",
      accountId: v.txn.account_id,
      date: v.txn.date,
      authorizedDate: null,
      amountCents: v.txn.amount_cents,
      currency: "USD",
      merchant: v.txn.merchant,
      description: v.txn.description,
      category: v.txn.category,
      detailedCategory: null,
      flowKind: v.txn.flow_kind,
      pending: false,
      transferPairId: null,
      website: null,
      paymentChannel: null,
    }
    const detail = detailWith(txn)
    const store = {
      get: () => detail,
      status: () => ({
        loaded: true,
        error: undefined,
        generatedAt: null,
        schemaVersion: 2,
      }),
    } as unknown as DetailStore
    const db = openAppDb(":memory:")
    for (const row of v.categories) {
      // Readers need only code, parent, group and merges; fill the rest.
      const c = { label: String(row.code), grp: "expense", ...row }
      const cols = Object.keys(c)
      db.prepare(
        `INSERT INTO categories(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`
      ).run(...(Object.values(c) as (string | number | null)[]))
    }
    for (const r of v.rules)
      db.prepare(
        "INSERT INTO rules(id,position,enabled,match_json,action_json,created_at,applies_from) VALUES(?,?,?,?,?,?,?)"
      ).run(
        r.id,
        r.position,
        Number(r.enabled),
        typeof r.match === "string" ? r.match : JSON.stringify(r.match),
        typeof r.action === "string" ? r.action : JSON.stringify(r.action),
        "2026-01-01T00:00:00Z",
        r.applies_from ?? null
      )
    if (v.override) {
      const o = { txn_id: "txn_vector", updated_at: "x", ...v.override }
      const cols = Object.keys(o)
      db.prepare(
        `INSERT INTO txn_overrides(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`
      ).run(...(Object.values(o) as (string | number | null)[]))
    }
    v.splits.forEach((s, i) =>
      db
        .prepare("INSERT INTO txn_splits VALUES(?,?,?,?,NULL)")
        .run("txn_vector", i, s.amount_cents, s.category)
    )
    const m = createModel(store, db, () => "2026-11-18").get()
    const t = m.txns[0]
    assert.equal(t.categoryEff, v.expected.category, "category")
    assert.equal(t.ownedEff, v.expected.owned, "owned")
    assert.equal(t.hidden, v.expected.hidden, "hidden")
    // Hidden transactions leave every total. A code the app does not know
    // shows as Other inside it; outside, both report the same owned code.
    const known = (code: string) => m.categories.some((c) => c.code === code)
    assert.deepEqual(
      m.allocations.map((a) => ({
        category: a.category,
        owned: a.owned,
        amount_cents: a.amountCents,
      })),
      (v.expected.hidden ? [] : v.expected.allocations).map((a) => ({
        ...a,
        category: known(a.category) ? a.category : "other",
      })),
      "allocations"
    )
    db.close()
  })
