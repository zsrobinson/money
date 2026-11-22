// Deterministic, entirely invented fixture data for development, tests and
// screenshots. No real institutions, people, merchants or amounts.
import { mkdirSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { openAppDb } from "../server/app-db.ts"

export const FIXTURE_TODAY = "2026-11-18"
const START = "2024-09-01"

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex")
const DAY = 86_400_000
const d2s = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const s2d = (s: string) => Date.parse(`${s}T00:00:00Z`)
const addDays = (s: string, n: number) => d2s(s2d(s) + n * DAY)

type Txn = {
  id: string
  account: string
  date: string
  cents: number
  merchant: string | null
  description: string
  category: string
  detailed: string
  flow: "activity" | "bank_transfer" | "peer_payment"
  pending: boolean
  pair: string | null
  channel: string
}

const CATEGORIES: [string, string, "income" | "expense" | "transfer"][] = [
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
  ["peer_payment", "Peer payments", "transfer"],
  ["other", "Other or unclassified", "expense"],
]

const ACCOUNTS = [
  {
    key: "checking",
    source: "bank",
    label: "Everyday checking",
    type: "depository",
    subtype: "checking",
    mask: "4821",
  },
  {
    key: "savings",
    source: "bank",
    label: "High-yield savings",
    type: "depository",
    subtype: "savings",
    mask: "9930",
  },
  {
    key: "card",
    source: "bank",
    label: "Rewards card",
    type: "credit",
    subtype: "credit card",
    mask: "1177",
    limit: 1200000,
  },
  {
    key: "travel",
    source: "union",
    label: "Travel card",
    type: "credit",
    subtype: "credit card",
    mask: "6402",
    limit: 800000,
  },
  {
    key: "loan",
    source: "union",
    label: "Car loan",
    type: "loan",
    subtype: "auto",
    mask: "3015",
  },
  {
    key: "brokerage",
    source: "broker",
    label: "Brokerage",
    type: "investment",
    subtype: "brokerage",
    mask: "7710",
  },
  {
    key: "retirement",
    source: "broker",
    label: "Retirement",
    type: "investment",
    subtype: "401k",
    mask: "2284",
  },
  {
    key: "wallet",
    source: "wallet",
    label: "Payment wallet",
    type: "other",
    subtype: "wallet",
    mask: null,
  },
  {
    key: "oldchecking",
    source: "union",
    label: "Old checking",
    type: "depository",
    subtype: "checking",
    mask: "0458",
    historical: true,
  },
] as const
const SOURCES = {
  bank: { name: "Harbor Example Bank", kinds: ["balances", "spending"] },
  union: {
    name: "Cedar Fictional Credit Union",
    kinds: ["balances", "spending"],
  },
  broker: { name: "Orbit Example Brokerage", kinds: ["balances", "holdings"] },
  wallet: { name: "Sample Payment Wallet", kinds: ["balances", "spending"] },
}
const acct = (key: string) =>
  `acct_${hash(`fixture-account-${key}`).slice(0, 40)}`
const src = (key: string) => `src_${hash(`fixture-source-${key}`).slice(0, 40)}`

export function generate(outDir: string) {
  const r = rng(20261118)
  const between = (lo: number, hi: number) => Math.round(lo + (hi - lo) * r())
  const chance = (p: number) => r() < p
  const txns: Txn[] = []
  let n = 0
  const add = (
    account: string,
    date: string,
    cents: number,
    merchant: string | null,
    category: string,
    detailed: string,
    opts: Partial<Pick<Txn, "flow" | "pair" | "description" | "channel">> = {}
  ) => {
    if (date > FIXTURE_TODAY) return
    const t: Txn = {
      id: `txn_${hash(`fixture-${n++}`)}`,
      account: acct(account),
      date,
      cents,
      merchant,
      description: opts.description ?? merchant ?? "",
      category,
      detailed,
      flow: opts.flow ?? "activity",
      pending:
        date >= addDays(FIXTURE_TODAY, -2) &&
        account !== "checking" &&
        cents < 0 &&
        chance(0.6),
      pair: opts.pair ?? null,
      channel: opts.channel ?? (chance(0.6) ? "in store" : "online"),
    }
    txns.push(t)
  }
  const transfer = (
    from: string,
    to: string,
    date: string,
    cents: number,
    label: string,
    category = "bank_transfer"
  ) => {
    const pair = `pair_${hash(`${from}${to}${date}${cents}`).slice(0, 24)}`
    add(from, date, -cents, label, category, "bank_transfer", {
      flow: "bank_transfer",
      pair,
    })
    add(to, date, cents, label, category, "bank_transfer", {
      flow: "bank_transfer",
      pair,
    })
  }

  const cardSpend = { card: 0, travel: 0 }
  for (let day = s2d(START); day <= s2d(FIXTURE_TODAY); day += DAY) {
    const date = d2s(day)
    const dt = new Date(day)
    const dom = dt.getUTCDate()
    const dow = dt.getUTCDay()
    const month = dt.getUTCMonth()
    const year = dt.getUTCFullYear()
    const card = chance(0.7) ? "card" : "travel"
    const spend = (
      cents: number,
      merchant: string,
      category: string,
      detailed: string,
      account: string = card
    ) => {
      add(account, date, -cents, merchant, category, detailed)
      if (account === "card" || account === "travel")
        cardSpend[account] += cents
    }
    // Income: biweekly payroll on Fridays, raise in 2026.
    if (dow === 5 && Math.floor((day - s2d("2024-09-06")) / DAY) % 14 === 0)
      add(
        "checking",
        date,
        year >= 2026 ? 298000 : 285000,
        "Northwind Example Studio payroll",
        "income",
        "wages",
        { channel: "other" }
      )
    if (dom === 28)
      add(
        "savings",
        date,
        between(3800, 5200) + (year - 2024) * 900,
        "Interest",
        "income",
        "interest",
        { channel: "other" }
      )
    if (dom === 12 && chance(0.25))
      add(
        "checking",
        date,
        between(30000, 65000),
        "Lantern Example Client",
        "income",
        "other_income",
        { channel: "other" }
      )
    // Housing and bills.
    if (dom === 1)
      add(
        "checking",
        date,
        year >= 2026 ? -172500 : -165000,
        "Maple Court Example Apartments",
        "housing",
        "rent",
        { channel: "other" }
      )
    if (dom === 9)
      spend(
        between(
          5800,
          month < 2 || month > 10
            ? 14200
            : month > 5 && month < 9
              ? 12600
              : 7400
        ),
        "City Example Power",
        "housing",
        "utilities",
        "card"
      )
    if (dom === 14)
      spend(6500, "Signal Example Internet", "housing", "utilities", "card")
    if (dom === 18)
      spend(4500, "Pocket Example Mobile", "housing", "utilities", "card")
    if (dom === 4)
      spend(
        1599,
        "Lumen Example Streaming",
        "entertainment",
        "general_entertainment",
        "card"
      )
    if (dom === 21)
      spend(
        1099,
        "Paper Kite Example Music",
        "entertainment",
        "general_entertainment",
        "card"
      )
    if (dom === 6 && month === 2)
      spend(
        9900,
        "Cloud Example Storage",
        "shopping",
        "general_shopping",
        "card"
      )
    if (dom === 3 && date < "2026-07-01")
      spend(4000, "Ironwood Example Gym", "health", "general_health", "card")
    if (dom === 15)
      add(
        "checking",
        date,
        -38500,
        "Cedar Fictional auto loan",
        "loan_payments",
        "general_loan_payments",
        { channel: "other" }
      )
    if (dom === 22)
      spend(
        3500,
        "Example Barber Co",
        "personal_care",
        "general_personal_care",
        "card"
      )
    // Everyday spending.
    if (dow === 0 || dow === 3 || (dow === 6 && chance(0.4)))
      spend(
        between(3800, 15800),
        chance(0.7) ? "Juniper Example Grocer" : "Corner Example Market",
        "food",
        "groceries"
      )
    if (chance(0.27))
      spend(
        between(1200, 6800),
        [
          "Copper Kettle Example Cafe",
          "Saffron Example Kitchen",
          "Blue Door Example Diner",
          "Noodle Example House",
        ][between(0, 3)],
        "food",
        "dining"
      )
    if (dow > 0 && dow < 6 && chance(0.45))
      spend(between(420, 720), "Bluebird Example Coffee", "food", "other_food")
    if (dom === 2)
      spend(9000, "Example Metro Transit", "transport", "transit", "card")
    if (chance(0.07))
      spend(between(3400, 5600), "Example Fuel Stop", "transport", "fuel")
    if (chance(0.04))
      spend(
        between(1400, 3600),
        "Example Rideshare",
        "transport",
        "other_transport"
      )
    if (chance(0.11))
      spend(
        between(1500, 18000),
        ["Fictional Outfitters", "Example Home Goods", "Online Example Market"][
          between(0, 2)
        ],
        "shopping",
        "general_shopping"
      )
    if (chance(0.035))
      spend(between(1200, 4200), "Example Pharmacy", "health", "general_health")
    if (chance(0.03))
      spend(
        between(1800, 6400),
        "Example Cinema",
        "entertainment",
        "general_entertainment"
      )
    if (chance(0.012)) {
      const refund = between(2000, 9000)
      add(
        card,
        date,
        refund,
        "Fictional Outfitters refund",
        "shopping",
        "general_shopping"
      )
      cardSpend[card] -= refund
    }
    // Two trips a year.
    if ((month === 3 || month === 8) && dom === 10) {
      spend(
        between(32000, 52000),
        "Example Air",
        "travel",
        "general_travel",
        "travel"
      )
      spend(
        between(38000, 61000),
        "Example Harbor Hotel",
        "travel",
        "general_travel",
        "travel"
      )
    }
    if (month === 0 && dom === 20)
      spend(9500, "Travel card annual fee", "fees", "general_fees", "travel")
    // Peer payments in the wallet.
    if (chance(0.06))
      add(
        "wallet",
        date,
        between(1500, 6000),
        null,
        "peer_payment",
        "peer_received",
        { flow: "peer_payment", description: "Peer payment received" }
      )
    if (chance(0.05))
      add(
        "wallet",
        date,
        -between(1200, 4500),
        null,
        "peer_payment",
        "peer_sent",
        { flow: "peer_payment", description: "Peer payment sent" }
      )
    // Transfers and card payments.
    if (dom === 16)
      transfer("checking", "savings", date, 60000, "Savings transfer")
    if (dom === 17)
      transfer("checking", "brokerage", date, 40000, "Brokerage contribution")
    if (dom === 20)
      for (const k of ["card", "travel"] as const)
        if (cardSpend[k] > 0) {
          transfer("checking", k, date, cardSpend[k], "Card payment")
          cardSpend[k] = 0
        }
    if (date < "2025-03-01" && dom === 5)
      add(
        "oldchecking",
        date,
        -between(2000, 6000),
        "Corner Example Market",
        "food",
        "groceries"
      )
  }
  // A few still-pending card purchases close to today.
  add("card", FIXTURE_TODAY, -2350, "Saffron Example Kitchen", "food", "dining")
  add(
    "card",
    FIXTURE_TODAY,
    -6418,
    "Online Example Market",
    "shopping",
    "general_shopping"
  )
  for (const t of txns.slice(-2)) t.pending = true

  // Balances: walk forward from opening balances.
  const opening: Record<string, number> = {
    checking: 420000,
    savings: 1200000,
    card: 0,
    travel: 0,
    loan: 1850000,
    wallet: 4000,
    oldchecking: 90000,
  }
  const byAccount = new Map<string, Map<string, number>>()
  for (const t of txns) {
    if (t.pending) continue
    const m = byAccount.get(t.account) ?? new Map()
    m.set(t.date, (m.get(t.date) ?? 0) + t.cents)
    byAccount.set(t.account, m)
  }
  const balance: {
    account: string
    date: string
    cents: number
    estimated: number
  }[] = []
  const current: Record<string, number> = {}
  for (const a of ACCOUNTS) {
    if (a.type === "investment") continue
    let cents = opening[a.key] ?? 0
    const deltas = byAccount.get(acct(a.key)) ?? new Map()
    const end = "historical" in a ? "2025-03-31" : FIXTURE_TODAY
    for (let day = s2d(START); day <= s2d(end); day += DAY) {
      const date = d2s(day)
      const delta = deltas.get(date) ?? 0
      // Credit and loan balances are amounts owed: spending raises them.
      if (a.type === "credit") cents -= delta
      else if (a.key === "loan")
        cents = date.endsWith("-15") ? Math.max(0, cents - 33200) : cents
      else cents += delta
      if (
        new Date(day).getUTCDay() === 1 ||
        date === end ||
        date.endsWith("-01")
      )
        balance.push({
          account: acct(a.key),
          date,
          cents,
          estimated: date < "2024-10-01" ? 1 : 0,
        })
    }
    current[a.key] = cents
  }

  // Holdings: weekly random walks with drift and monthly contributions.
  const SECURITIES = [
    {
      account: "brokerage",
      id: "sec_total",
      ticker: "EXTM",
      name: "Example Total Market Index",
      type: "etf",
      start: 2400000,
      units: 112,
      drift: 0.0019,
      vol: 0.018,
      cost: 0.82,
    },
    {
      account: "brokerage",
      id: "sec_intl",
      ticker: "EXIN",
      name: "Example International Index",
      type: "etf",
      start: 850000,
      units: 210,
      drift: 0.0011,
      vol: 0.02,
      cost: 0.93,
    },
    {
      account: "brokerage",
      id: "sec_bond",
      ticker: "EXBD",
      name: "Example Bond Fund",
      type: "fixed income",
      start: 600000,
      units: 82,
      drift: 0.0004,
      vol: 0.004,
      cost: 1.01,
    },
    {
      account: "brokerage",
      id: "sec_cash",
      ticker: null,
      name: "Cash sweep",
      type: "cash",
      start: 120000,
      units: 1200,
      drift: 0,
      vol: 0,
      cost: 1,
    },
    {
      account: "retirement",
      id: "sec_2060",
      ticker: "EXTD",
      name: "Example Target Date 2060 Fund",
      type: "mutual fund",
      start: 3100000,
      units: 1480,
      drift: 0.0017,
      vol: 0.015,
      cost: 0.86,
    },
    {
      account: "retirement",
      id: "sec_large",
      ticker: "EXLC",
      name: "Example Large Cap Index Fund",
      type: "mutual fund",
      start: 1450000,
      units: 260,
      drift: 0.002,
      vol: 0.017,
      cost: 0.79,
    },
  ]
  const holdingHistory: {
    account: string
    security: string
    date: string
    quantity: number
    cents: number
  }[] = []
  const holdings: {
    account: string
    security: string
    ticker: string | null
    name: string
    type: string
    quantity: number
    price: number
    cents: number
    cost: number
  }[] = []
  const investTotals = new Map<string, Map<string, number>>()
  for (const s of SECURITIES) {
    let value = s.start
    let quantity = s.units
    let cost = s.start * s.cost
    for (let day = s2d(START); day <= s2d(FIXTURE_TODAY); day += 7 * DAY) {
      const date = d2s(day)
      const shock =
        (r() - 0.5) * 2 * s.vol +
        s.drift +
        (date > "2025-03-01" && date < "2025-04-20" ? -0.012 : 0)
      const price = value / quantity
      value = Math.max(0, value * (1 + shock))
      const contribution =
        s.account === "retirement" ? 52000 : s.id === "sec_total" ? 40000 : 0
      if (new Date(day).getUTCDate() <= 7 && contribution) {
        value += contribution
        quantity += contribution / price
        cost += contribution
      }
      holdingHistory.push({
        account: acct(s.account),
        security: s.id,
        date,
        quantity,
        cents: Math.round(value),
      })
      const totals = investTotals.get(s.account) ?? new Map()
      totals.set(date, (totals.get(date) ?? 0) + Math.round(value))
      investTotals.set(s.account, totals)
    }
    holdings.push({
      account: acct(s.account),
      security: s.id,
      ticker: s.ticker,
      name: s.name,
      type: s.type,
      quantity: Math.round(quantity * 1000) / 1000,
      price: Math.round((value / quantity) * 100) / 10000,
      cents: Math.round(value),
      cost: Math.round(cost),
    })
  }
  for (const [key, totals] of investTotals) {
    for (const [date, cents] of totals)
      balance.push({ account: acct(key), date, cents, estimated: 0 })
    current[key] = [...totals.values()].at(-1) ?? 0
  }

  mkdirSync(outDir, { recursive: true })
  const detailPath = resolve(outDir, "detail.sqlite")
  rmSync(detailPath, { force: true })
  const db = new DatabaseSync(detailPath)
  db.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE sources(id TEXT PRIMARY KEY,kind TEXT,institution TEXT,status TEXT,last_success_at TEXT,data_kinds TEXT);
    CREATE TABLE accounts(id TEXT PRIMARY KEY,source_id TEXT,label TEXT,official_name TEXT,type TEXT,subtype TEXT,mask TEXT,currency TEXT,current_cents INTEGER,available_cents INTEGER,limit_cents INTEGER,availability TEXT,scope TEXT);
    CREATE TABLE transactions(id TEXT PRIMARY KEY,account_id TEXT,date TEXT,amount_cents INTEGER,currency TEXT,merchant TEXT,description TEXT,category TEXT,detailed_category TEXT,flow_kind TEXT,pending INTEGER,transfer_pair_id TEXT,authorized_date TEXT,logo_url TEXT,website TEXT,pfc_primary TEXT,pfc_detailed TEXT,pfc_confidence TEXT,payment_channel TEXT);
    CREATE TABLE balance_history(account_id TEXT,date TEXT,current_cents INTEGER,estimated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,date));
    CREATE TABLE holdings(account_id TEXT,security_id TEXT,ticker TEXT,name TEXT,type TEXT,currency TEXT,quantity REAL,price REAL,value_cents INTEGER,cost_basis_cents INTEGER);
    CREATE TABLE holding_history(account_id TEXT,security_id TEXT,date TEXT,quantity REAL,value_cents INTEGER,PRIMARY KEY(account_id,security_id,date));
    CREATE TABLE categories(code TEXT PRIMARY KEY,label TEXT,"group" TEXT,parent TEXT,sort INTEGER);
    CREATE TABLE recurring_hints(source_id TEXT,merchant TEXT,currency TEXT,frequency TEXT,last_charged_month TEXT,active INTEGER);
  `)
  db.exec("BEGIN")
  db.prepare("INSERT INTO meta VALUES(?,?)").run("schema_version", "1")
  db.prepare("INSERT INTO meta VALUES(?,?)").run(
    "generated_at",
    `${FIXTURE_TODAY}T12:00:00+00:00`
  )
  for (const [key, s] of Object.entries(SOURCES))
    db.prepare("INSERT INTO sources VALUES(?,?,?,?,?,?)").run(
      src(key),
      "connection",
      s.name,
      key === "union" ? "stale" : "healthy",
      key === "union"
        ? "2026-11-15T09:00:00+00:00"
        : `${FIXTURE_TODAY}T11:40:00+00:00`,
      JSON.stringify(s.kinds)
    )
  for (const a of ACCOUNTS) {
    const historical = "historical" in a
    db.prepare("INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      acct(a.key),
      src(a.source),
      a.label,
      `Example ${a.label}`,
      a.type,
      a.subtype,
      a.mask,
      "USD",
      historical ? null : current[a.key],
      historical
        ? null
        : a.type === "depository"
          ? current[a.key]
          : a.type === "credit"
            ? ("limit" in a ? a.limit : 0) - current[a.key]
            : null,
      "limit" in a ? a.limit : null,
      historical ? "historical" : "available",
      "own"
    )
  }
  const insertTxn = db.prepare(
    "INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  )
  for (const t of txns)
    insertTxn.run(
      t.id,
      t.account,
      t.date,
      t.cents,
      "USD",
      t.merchant,
      t.description,
      t.category,
      t.detailed,
      t.flow,
      Number(t.pending),
      t.pair,
      t.date,
      null,
      null,
      null,
      null,
      "HIGH",
      t.channel
    )
  const insertBalance = db.prepare(
    "INSERT OR REPLACE INTO balance_history VALUES(?,?,?,?)"
  )
  for (const b of balance)
    insertBalance.run(b.account, b.date, b.cents, b.estimated)
  for (const h of holdings)
    db.prepare("INSERT INTO holdings VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      h.account,
      h.security,
      h.ticker,
      h.name,
      h.type,
      "USD",
      h.quantity,
      h.price,
      h.cents,
      h.cost
    )
  const insertHolding = db.prepare(
    "INSERT INTO holding_history VALUES(?,?,?,?,?)"
  )
  for (const h of holdingHistory)
    insertHolding.run(h.account, h.security, h.date, h.quantity, h.cents)
  CATEGORIES.forEach(([code, label, group], i) =>
    db
      .prepare("INSERT INTO categories VALUES(?,?,?,?,?)")
      .run(code, label, group, null, i)
  )
  db.prepare("INSERT INTO recurring_hints VALUES(?,?,?,?,?,?)").run(
    src("bank"),
    "Lumen Example Streaming",
    "USD",
    "MONTHLY",
    "2026-11",
    1
  )
  db.prepare("INSERT INTO recurring_hints VALUES(?,?,?,?,?,?)").run(
    src("bank"),
    "Cloud Example Storage",
    "USD",
    "ANNUALLY",
    "2026-03",
    1
  )
  db.exec("COMMIT")
  db.close()

  // App database: the edits a person would have made.
  const appPath = resolve(outDir, "app.sqlite")
  rmSync(appPath, { force: true })
  const app = openAppDb(appPath)
  const at = `${FIXTURE_TODAY}T09:00:00.000Z`
  app.exec("BEGIN")
  const cat = (code: string, label: string, parent: string, grp = "expense") =>
    app
      .prepare(
        "INSERT INTO categories(code,label,grp,parent,hidden,sort) VALUES(?,?,?,?,0,NULL)"
      )
      .run(code, label, grp, parent)
  cat("cat_coffee", "Coffee shops", "food")
  cat("cat_subscriptions", "Subscriptions", "entertainment")
  app
    .prepare(
      "INSERT INTO categories(code,label,grp,parent,hidden,sort) VALUES('bank_transfer','Transfers and card payments','transfer',NULL,0,NULL)"
    )
    .run()
  const tag = (id: string, name: string, hue: string) =>
    app.prepare("INSERT INTO tags VALUES(?,?,?)").run(id, name, hue)
  tag("tag_tax", "Tax deductible", "gr")
  tag("tag_shared", "Shared", "bl")
  tag("tag_reimburse", "Reimbursable", "or")
  const rule = (
    id: string,
    position: number,
    match: object,
    action: object,
    enabled = 1
  ) =>
    app
      .prepare(
        "INSERT INTO rules(id,position,enabled,match_json,action_json,created_at) VALUES(?,?,?,?,?,?)"
      )
      .run(
        id,
        position,
        enabled,
        JSON.stringify(match),
        JSON.stringify(action),
        at
      )
  rule(
    "rule_coffee",
    0,
    { merchant_contains: "bluebird" },
    { category: "cat_coffee" }
  )
  rule(
    "rule_subs",
    1,
    { merchant_contains: "streaming" },
    { category: "cat_subscriptions", mark_reviewed: true }
  )
  rule(
    "rule_music",
    2,
    { merchant_equals: "Paper Kite Example Music" },
    { category: "cat_subscriptions", mark_reviewed: true }
  )
  rule(
    "rule_transit",
    3,
    { merchant_contains: "metro transit" },
    { mark_reviewed: true }
  )
  rule(
    "rule_client",
    4,
    { merchant_contains: "lantern", direction: "in" },
    { merchant: "Lantern client work", tags: ["tag_tax"] }
  )
  rule(
    "rule_big_shop",
    5,
    { category: "shopping", amount_min_cents: 15000, direction: "out" },
    { tags: ["tag_shared"] },
    0
  )
  // Older activity has been reviewed; the last ten days wait in the queue.
  const review = app.prepare(
    "INSERT INTO txn_overrides(txn_id,reviewed,updated_at) VALUES(?,1,?)"
  )
  for (const t of txns)
    if (t.date < addDays(FIXTURE_TODAY, -10)) review.run(t.id, at)
  const shop = txns.findLast(
    (t) =>
      t.merchant === "Online Example Market" && !t.pending && t.cents < -8000
  )
  if (shop) {
    const part = Math.round(shop.cents * 0.35)
    app
      .prepare("INSERT INTO txn_splits VALUES(?,?,?,?,?)")
      .run(shop.id, 0, shop.cents - part, "shopping", null)
    app
      .prepare("INSERT INTO txn_splits VALUES(?,?,?,?,?)")
      .run(shop.id, 1, part, "health", "First aid kit")
    app
      .prepare("INSERT OR IGNORE INTO txn_tags VALUES(?,?)")
      .run(shop.id, "tag_shared")
  }
  const dinner = txns.findLast(
    (t) => t.merchant === "Saffron Example Kitchen" && !t.pending
  )
  if (dinner) {
    app
      .prepare("UPDATE txn_overrides SET note=? WHERE txn_id=?")
      .run("Birthday dinner, split with a friend", dinner.id)
    app
      .prepare("INSERT OR IGNORE INTO txn_tags VALUES(?,?)")
      .run(dinner.id, "tag_reimburse")
  }
  const rideshare = txns.findLast((t) => t.merchant === "Example Rideshare")
  if (rideshare)
    app
      .prepare(
        "INSERT INTO txn_overrides(txn_id,category,reviewed,updated_at) VALUES(?,?,1,?) ON CONFLICT(txn_id) DO UPDATE SET category=excluded.category"
      )
      .run(rideshare.id, "travel", at)
  const budget = (code: string, cents: number) =>
    app
      .prepare("INSERT INTO budget_plans VALUES(?,'0001-01',?)")
      .run(code, cents)
  budget("food", 70000)
  budget("cat_coffee", 6000)
  budget("housing", 200000)
  budget("transport", 22000)
  budget("shopping", 30000)
  budget("entertainment", 9000)
  budget("cat_subscriptions", 3000)
  budget("personal_care", 5000)
  budget("health", 8000)
  app
    .prepare("INSERT INTO budgets VALUES(?,?,?)")
    .run(FIXTURE_TODAY.slice(0, 7), "shopping", 40000)
  const goal = (
    id: string,
    name: string,
    kind: string,
    target: number,
    date: string | null,
    accounts: string[]
  ) => {
    app
      .prepare(
        "INSERT INTO goals(id,name,kind,target_cents,target_date,account_ids_json,created_at) VALUES(?,?,?,?,?,?,?)"
      )
      .run(id, name, kind, target, date, JSON.stringify(accounts.map(acct)), at)
    for (const a of accounts)
      app
        .prepare("INSERT INTO goal_allocations VALUES(?,?,'all',NULL)")
        .run(id, acct(a))
  }
  goal("goal_emergency", "Emergency fund", "save", 4000000, "2027-06-30", [
    "savings",
  ])
  goal("goal_car", "Pay off the car", "payoff", 1850000, "2028-03-31", ["loan"])
  goal("goal_home", "Home down payment", "save", 9000000, "2030-12-31", [
    "savings",
    "brokerage",
  ])
  app
    .prepare("INSERT INTO recurring_overrides VALUES(?,?,?,?)")
    .run("ironwood example gym", "cancelled", null, null)
  app
    .prepare("INSERT INTO account_overrides VALUES(?,?,?,?)")
    .run(acct("oldchecking"), null, 1, 1)
  app.exec("COMMIT")
  app.close()
  return { detailPath, appPath, transactions: txns.length }
}

if (import.meta.main ?? process.argv[1]?.endsWith("generate.ts")) {
  const out = resolve(import.meta.dirname, "out")
  console.log(JSON.stringify(generate(out)))
}
