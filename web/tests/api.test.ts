import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { createApi } from "../server/api.ts"
import { openAppDb } from "../server/app-db.ts"
import { detailStore } from "../server/detail.ts"
import { createModel } from "../server/model.ts"
import { FIXTURE_TODAY, generate } from "../fixtures/generate.ts"

const dir = mkdtempSync(join(tmpdir(), "money-api-"))
const paths = generate(dir)
const model = createModel(
  detailStore(paths.detailPath),
  openAppDb(paths.appPath),
  () => FIXTURE_TODAY
)
const api = createApi(model)

async function call<T = any>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: T }> {
  const res = await api.request(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as T }
}
const txns = () => model.get().txns

test("app database is versioned and migrations are idempotent", () => {
  const db = openAppDb(paths.appPath)
  assert.equal(
    (
      db.prepare("SELECT version FROM schema_version").get() as {
        version: number
      }
    ).version,
    3
  )
  db.close()
  // A version 2 database (no date column) upgrades in place and keeps rows.
  const old = join(dir, "v2.sqlite")
  const v2 = new DatabaseSync(old)
  v2.exec(`CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES(2);
    CREATE TABLE txn_overrides(txn_id TEXT PRIMARY KEY, category TEXT, merchant TEXT, note TEXT,
      hidden INTEGER, reviewed INTEGER, updated_at TEXT NOT NULL);
    INSERT INTO txn_overrides VALUES('txn_a','food',NULL,NULL,NULL,1,'2026-01-01T00:00:00Z');`)
  v2.close()
  const upgraded = openAppDb(old)
  assert.equal(
    (
      upgraded.prepare("SELECT version FROM schema_version").get() as {
        version: number
      }
    ).version,
    3
  )
  assert.deepEqual(
    {
      ...(upgraded
        .prepare("SELECT category, reviewed, date FROM txn_overrides")
        .get() as object),
    },
    { category: "food", reviewed: 1, date: null }
  )
  upgraded.close()
  openAppDb(old).close()
})

test("splits must sum to the amount with the same sign, and drive totals", async () => {
  const t = txns().find(
    (x) =>
      x.amountCents < -5000 &&
      !x.splits &&
      !x.pending &&
      x.categoryEff === "shopping"
  )!
  const url = `/transactions/${t.id}/splits`
  assert.equal(
    (
      await call("PUT", url, {
        splits: [{ amountCents: t.amountCents, category: "shopping" }],
      })
    ).status,
    422
  )
  assert.equal(
    (
      await call("PUT", url, {
        splits: [
          { amountCents: t.amountCents + 1, category: "shopping" },
          { amountCents: -1, category: "nope" },
        ],
      })
    ).status,
    422
  )
  assert.equal(
    (
      await call("PUT", url, {
        splits: [
          { amountCents: t.amountCents - 100, category: "shopping" },
          { amountCents: 100, category: "health" },
        ],
      })
    ).status,
    422
  )
  const ok = await call("PUT", url, {
    splits: [
      { amountCents: t.amountCents + 2000, category: "shopping" },
      { amountCents: -2000, category: "health", note: "Pharmacy items" },
    ],
  })
  assert.equal(ok.status, 200)
  const allocated = model.get().allocations.filter((a) => a.txn.id === t.id)
  assert.deepEqual(
    allocated.map((a) => [a.category, a.amountCents]),
    [
      ["shopping", t.amountCents + 2000],
      ["health", -2000],
    ]
  )
  assert.equal((await call("PUT", url, { splits: [] })).status, 200)
  assert.equal(model.get().txn.get(t.id)!.splits, null)
})

test("custom categories need a built-in parent and roll up to it", async () => {
  assert.equal(
    (
      await call("POST", "/categories", {
        label: "Nested",
        parent: "cat_coffee",
      })
    ).status,
    422
  )
  const created = await call<{ code: string }>("POST", "/categories", {
    label: "Bakeries",
    parent: "food",
  })
  assert.equal(created.status, 201)
  const code = created.json.code
  const info = model.get().category(code)
  assert.equal(info.owned, "food")
  assert.equal(info.group, "expense")
  assert.equal(
    (await call("PATCH", `/categories/${code}`, { label: "Bakery" })).status,
    200
  )
  assert.equal(model.get().category(code).label, "Bakery")
  // Editing a built-in changes only its label.
  assert.equal(
    (await call("PATCH", "/categories/travel", { label: "Trips" })).status,
    200
  )
  assert.equal(model.get().category("travel").label, "Trips")
  const t = txns().find((x) => x.categoryEff === "food" && !x.splits)!
  await call("PATCH", `/transactions/${t.id}`, { category: code })
  assert.equal((await call("DELETE", `/categories/${code}`)).status, 409)
  await call("PATCH", `/transactions/${t.id}`, { category: null })
  assert.equal((await call("DELETE", `/categories/${code}`)).status, 200)
  assert.equal((await call("DELETE", "/categories/food")).status, 422)
})

test("rules: first match wins per field, no chaining, overrides win", async () => {
  const target = txns().find((x) => x.merchant === "Example Fuel Stop")!
  const a = await call<{ id: string }>("POST", "/rules", {
    match: { merchant_contains: "fuel stop" },
    action: { category: "travel" },
  })
  const b = await call<{ id: string }>("POST", "/rules", {
    match: { merchant_contains: "FUEL" },
    action: { category: "shopping", merchant: "Fuel" },
  })
  assert.equal(a.status, 201)
  let t = model.get().txn.get(target.id)!
  assert.equal(t.categoryEff, "travel")
  assert.equal(t.merchantEff, "Fuel")
  // A later rule matching the first rule's output category does not chain.
  const c = await call<{ id: string }>("POST", "/rules", {
    match: { category: "travel" },
    action: { merchant: "Chained" },
  })
  assert.notEqual(model.get().txn.get(target.id)!.merchantEff, "Chained")
  const preview = await call("POST", "/rules/preview", {
    match: { merchant_contains: "fuel" },
  })
  assert.ok(preview.json.total > 0)
  assert.equal(
    (await call("POST", "/rules/order", { ids: [b.json.id] })).status,
    409
  )
  const ids = model.get().rules.map((r) => r.id)
  const reordered = [b.json.id, ...ids.filter((x) => x !== b.json.id)]
  assert.equal(
    (await call("POST", "/rules/order", { ids: reordered })).status,
    200
  )
  assert.equal(model.get().txn.get(target.id)!.categoryEff, "shopping")
  // A per-transaction override wins over every rule; null clears it.
  await call("PATCH", `/transactions/${target.id}`, {
    category: "health",
    reviewed: true,
  })
  t = model.get().txn.get(target.id)!
  assert.equal(t.categoryEff, "health")
  assert.equal(t.reviewed, true)
  await call("PATCH", `/transactions/${target.id}`, { category: null })
  assert.equal(model.get().txn.get(target.id)!.categoryEff, "shopping")
  assert.equal(
    (await call("POST", "/rules", { match: {}, action: { category: "food" } }))
      .status,
    422
  )
  assert.equal(
    (
      await call("POST", "/rules", {
        match: { merchant_contains: "x" },
        action: {},
      })
    ).status,
    422
  )
  for (const r of [a, b, c])
    assert.equal((await call("DELETE", `/rules/${r.json.id}`)).status, 200)
  assert.equal(model.get().txn.get(target.id)!.categoryEff, "transport")
})

test("hidden transactions leave totals but stay listable", async () => {
  const before = (await call("GET", "/cashflow?months=3")).json.months.at(
    -1
  ).spendingCents
  const t = txns().find(
    (x) =>
      x.date.startsWith(FIXTURE_TODAY.slice(0, 7)) &&
      x.categoryEff === "shopping" &&
      !x.pending &&
      !x.splits
  )!
  await call("PATCH", `/transactions/${t.id}`, { hidden: true })
  const after = (await call("GET", "/cashflow?months=3")).json.months.at(
    -1
  ).spendingCents
  assert.equal(before - after, -t.amountCents)
  const listed = await call(
    "GET",
    `/transactions?status=hidden&q=${encodeURIComponent(t.merchantEff ?? "")}`
  )
  assert.ok(listed.json.items.some((x: { id: string }) => x.id === t.id))
  await call("PATCH", `/transactions/${t.id}`, { hidden: null })
})

test("bulk edits validate tags and categories", async () => {
  const ids = txns()
    .slice(0, 3)
    .map((t) => t.id)
  assert.equal(
    (
      await call("POST", "/transactions/bulk", {
        ids,
        patch: { category: "nope" },
      })
    ).status,
    422
  )
  assert.equal(
    (
      await call("POST", "/transactions/bulk", {
        ids,
        patch: {},
        addTag: "tag_none",
      })
    ).status,
    422
  )
  assert.equal(
    (
      await call("POST", "/transactions/bulk", {
        ids,
        patch: { reviewed: true },
        addTag: "tag_tax",
      })
    ).status,
    200
  )
  for (const id of ids)
    assert.ok(model.get().txn.get(id)!.tags.includes("tag_tax"))
})

test("budgets: month amount beats default, null clears, copy previous", async () => {
  const month = FIXTURE_TODAY.slice(0, 7)
  const row = async (code: string, m = month) =>
    (await call("GET", `/budgets?month=${m}`)).json.rows.find(
      (r: { code: string }) => r.code === code
    )
  assert.equal((await row("food")).budgetCents, 70000)
  await call("PUT", `/budgets/${month}/food`, { amountCents: 50000 })
  assert.equal((await row("food")).budgetCents, 50000)
  assert.equal((await row("food")).source, "month")
  await call("PUT", `/budgets/${month}/food`, { amountCents: null })
  assert.equal((await row("food")).source, "default")
  await call("PUT", `/budgets/${month}/travel`, {
    amountCents: 12000,
    asDefault: true,
  })
  assert.equal((await row("travel", "2027-02")).budgetCents, 12000)
  assert.equal(
    (await call("PUT", `/budgets/2026-13/food`, { amountCents: 1 })).status,
    422
  )
  assert.equal(
    (await call("PUT", `/budgets/${month}/income`, { amountCents: 1 })).status,
    404
  )
  await call("PUT", `/budgets/${month}/health`, { amountCents: 9100 })
  const copied = await call("POST", `/budgets/2026-12/copy-previous`)
  assert.ok(copied.json.copied >= 1)
  assert.equal((await row("health", "2026-12")).budgetCents, 9100)
})

test("goals validate account kinds and track progress", async () => {
  const m = model.get()
  const savings = m.accounts.find((a) => a.subtype === "savings")!
  const loan = m.accounts.find((a) => a.type === "loan")!
  assert.equal(
    (
      await call("POST", "/goals", {
        name: "Bad",
        kind: "save",
        targetCents: 1000,
        accountIds: [loan.id],
      })
    ).status,
    422
  )
  assert.equal(
    (
      await call("POST", "/goals", {
        name: "Bad",
        kind: "payoff",
        targetCents: 1000,
        accountIds: [savings.id],
      })
    ).status,
    422
  )
  const g = await call<{ id: string }>("POST", "/goals", {
    name: "Trip",
    kind: "save",
    targetCents: 100000,
    accountIds: [savings.id],
  })
  assert.equal(g.status, 201)
  const got = await call("GET", `/goals/${g.json.id}`)
  assert.equal(got.json.progress, 1)
  assert.equal(
    (
      await call("PUT", `/goals/${g.json.id}`, {
        name: "Trip",
        kind: "save",
        targetCents: 99999999,
        targetDate: "2030-01-01",
        accountIds: [savings.id],
      })
    ).status,
    200
  )
  assert.ok((await call("GET", `/goals/${g.json.id}`)).json.progress < 1)
  assert.equal((await call("DELETE", `/goals/${g.json.id}`)).status, 200)
  assert.equal((await call("GET", `/goals/${g.json.id}`)).status, 404)
})

test("excluding an account changes net worth only", async () => {
  const card = model.get().accounts.find((a) => a.type === "credit")!
  const before = (await call("GET", "/summary")).json
  await call("PATCH", `/accounts/${card.id}`, {
    excludeNetWorth: true,
    displayName: "Main card",
  })
  const after = (await call("GET", "/summary")).json
  assert.equal(
    after.netWorth.cents - before.netWorth.cents,
    -card.balanceCents!
  )
  assert.equal(after.month.spendingCents, before.month.spendingCents)
  assert.equal(model.get().account.get(card.id)!.name, "Main card")
  await call("PATCH", `/accounts/${card.id}`, {
    excludeNetWorth: false,
    displayName: null,
  })
  assert.equal(model.get().account.get(card.id)!.name, card.label)
})

test("unknown ids and bad bodies return clear client errors", async () => {
  assert.equal((await call("GET", "/transactions/txn_missing")).status, 404)
  assert.equal(
    (await call("PATCH", "/transactions/txn_missing", { reviewed: true }))
      .status,
    404
  )
  assert.equal(
    (await call("PATCH", `/transactions/${txns()[0].id}`, { unknown: 1 }))
      .status,
    422
  )
  const res = await api.request("/settings", {
    method: "PATCH",
    body: "not json",
  })
  assert.equal(res.status, 400)
})

test("CSV export returns every matching row with formula-safe cells", async () => {
  const t = txns().find((x) => x.merchant === "Example Fuel Stop" && !x.splits)!
  await call("PATCH", `/transactions/${t.id}`, { note: '=HYPERLINK("x")' })
  const res = await api.request("/transactions.csv?q=fuel%20stop&status=all")
  assert.equal(res.status, 200)
  assert.match(res.headers.get("Content-Type") ?? "", /text\/csv/)
  const text = await res.text()
  const lines = text.trim().split("\r\n")
  const expected = txns().filter((x) =>
    x.merchantKey.includes("fuel stop")
  ).length
  assert.equal(lines.length - 1, expected)
  assert.match(text, /"'=HYPERLINK\(""x""\)"/)
  assert.doesNotMatch(text, /,"=HYPERLINK/)
  await call("PATCH", `/transactions/${t.id}`, { note: null })
})

test("flow filter narrows to transfers or peer payments", async () => {
  const transfers = await call(
    "GET",
    "/transactions?flow=bank_transfer&limit=200"
  )
  assert.ok(transfers.json.total > 0)
  assert.ok(
    transfers.json.items.every(
      (x: { flowKind: string }) => x.flowKind === "bank_transfer"
    )
  )
  const peers = await call("GET", "/transactions?flow=peer_payment&limit=5")
  assert.ok(
    peers.json.items.every(
      (x: { flowKind: string }) => x.flowKind === "peer_payment"
    )
  )
})

test("rollover carries unspent budget forward and history compares budget to actual", async () => {
  const month = FIXTURE_TODAY.slice(0, 7)
  const since = "2026-08"
  assert.equal(
    (
      await call("PUT", "/budgets/rollover/entertainment", {
        enabled: true,
        since,
      })
    ).status,
    200
  )
  const rows = (await call("GET", `/budgets?month=${month}`)).json.rows
  const row = rows.find((r: { code: string }) => r.code === "entertainment")
  const history = (
    await call("GET", "/budgets/history?months=6&category=entertainment")
  ).json.months as { month: string; budgetCents: number; spentCents: number }[]
  const carry = history
    .filter((h) => h.month >= since && h.month < month)
    .reduce((s, h) => s + h.budgetCents - h.spentCents, 0)
  assert.equal(row.rollover, true)
  assert.equal(row.rolloverCents, carry)
  assert.equal(history.length, 6)
  // Entertainment's budget includes Subscriptions inside it: 9000 + 3000.
  assert.ok(history.every((h) => h.budgetCents === 12000))
  await call("PUT", "/budgets/rollover/entertainment", { enabled: false })
  const after = (await call("GET", `/budgets?month=${month}`)).json.rows.find(
    (r: { code: string }) => r.code === "entertainment"
  )
  assert.equal(after.rolloverCents, 0)
  const total = (await call("GET", "/budgets/history?months=3")).json.months
  assert.ok(total.every((h: { budgetCents: number }) => h.budgetCents > 0))
})

test("a parent includes its children everywhere; grand totals count each dollar once", async () => {
  const m = model.get()
  const month = FIXTURE_TODAY.slice(0, 7)
  const own = (codes: string[], from: string, to: string) =>
    m.allocations
      .filter(
        (a) =>
          codes.includes(a.category) &&
          !a.txn.pending &&
          a.txn.date >= from &&
          a.txn.date <= to
      )
      .reduce((s, a) => s - a.amountCents, 0)
  const monthFrom = `${month}-01`
  const food = own(["food", "cat_coffee"], monthFrom, FIXTURE_TODAY)
  const coffee = own(["cat_coffee"], monthFrom, FIXTURE_TODAY)
  assert.ok(coffee > 0, "the fixture has coffee spending this month")
  assert.ok(food > coffee)

  // Cash flow: parent row includes the child; top-level rows add up to the month.
  const cash = (await call("GET", `/cashflow?month=${month}`)).json
  const cashRow = (code: string) =>
    cash.spending.find((r: { code: string }) => r.code === code)
  assert.equal(cashRow("food").cents, food)
  assert.equal(cashRow("cat_coffee").cents, coffee)
  const monthSpend = cash.months.at(-1).spendingCents
  assert.equal(
    cash.spending
      .filter((r: { parent: string | null }) => !r.parent)
      .reduce((s: number, r: { cents: number }) => s + r.cents, 0),
    monthSpend
  )

  // Dashboard donut: the same Food figure, and slices sum to spending.
  const summary = (await call("GET", "/summary")).json
  const top = summary.month.top as { code: string; cents: number }[]
  assert.equal(top.find((r) => r.code === "food")!.cents, food)
  assert.equal(
    top.reduce((s, r) => s + r.cents, 0),
    summary.month.spendingCents
  )
  assert.equal(summary.month.spendingCents, monthSpend)

  // Budgets: same Food spending; parent budget is own plus children; totals once.
  const budgets = (await call("GET", `/budgets?month=${month}`)).json
  const row = (code: string) =>
    budgets.rows.find((r: { code: string }) => r.code === code)
  assert.equal(row("food").spentCents, food)
  assert.equal(row("cat_coffee").spentCents, coffee)
  assert.equal(
    row("food").totalBudgetCents,
    row("food").budgetCents + row("cat_coffee").budgetCents
  )
  const ownBudgets = budgets.rows.reduce(
    (s: number, r: { budgetCents: number | null }) => s + (r.budgetCents ?? 0),
    0
  )
  assert.equal(budgets.totals.budgetedCents, ownBudgets)
  assert.equal(
    budgets.totals.spentCents + budgets.totals.unbudgetedCents,
    monthSpend
  )
  // The dashboard card shows the same totals as the Budgets page.
  assert.equal(summary.budget.budgetedCents, budgets.totals.budgetedCents)
  assert.equal(summary.budget.spentCents, budgets.totals.spentCents)
  const foodCard = summary.budget.rows.find(
    (r: { code: string }) => r.code === "food"
  )
  if (foodCard)
    assert.deepEqual(
      foodCard.children.map((r: { code: string }) => r.code),
      ["cat_coffee"]
    )

  // Category detail: this month matches the other pages.
  const detail = (await call("GET", "/reports/categories/food")).json
  assert.equal(detail.monthly.at(-1).cents, food)
})

test("reports cover the same full months on every tab and agree on totals", async () => {
  const m = model.get()
  const current = FIXTURE_TODAY.slice(0, 7)
  for (const range of ["1m", "3m", "6m", "1y"]) {
    const cats = (await call("GET", `/reports/categories?range=${range}`)).json
    const merchants = (await call("GET", `/reports/merchants?range=${range}`))
      .json
    const trends = (await call("GET", `/reports/trends?range=${range}`)).json
    const n = { "1m": 1, "3m": 3, "6m": 6, "1y": 12 }[range]
    assert.equal(cats.months.length, n)
    assert.deepEqual(trends.months, cats.months)
    assert.ok(!cats.months.includes(current), "the month in progress is out")
    assert.equal(cats.from, `${cats.months[0]}-01`)
    assert.equal(merchants.from, cats.from)
    assert.equal(merchants.to, cats.to)
    // Same spending total by category and by month.
    const trendSpend = trends.rows.reduce(
      (s: number, r: { spendingCents: number }) => s + r.spendingCents,
      0
    )
    assert.equal(cats.totalCents, trendSpend)
    // Stacked categories plus everything else equal each month's spending.
    for (const r of trends.rows) {
      const parts = trends.categories.reduce(
        (s: number, c: { code: string }) => s + Number(r[c.code] ?? 0),
        r.other
      )
      assert.equal(parts, r.spendingCents)
    }
    // A parent row includes its child, and its months add up to its total.
    const food = cats.rows.find((r: { code: string }) => r.code === "food")
    const coffee = cats.rows.find(
      (r: { code: string }) => r.code === "cat_coffee"
    )
    const ownFood = m.allocations
      .filter(
        (a) =>
          a.category === "food" &&
          !a.txn.pending &&
          a.txn.date >= cats.from &&
          a.txn.date <= cats.to
      )
      .reduce((s, a) => s - a.amountCents, 0)
    assert.equal(food.cents, ownFood + (coffee?.cents ?? 0))
    assert.equal(
      food.monthly.reduce((s: number, x: number) => s + x, 0),
      food.cents
    )
  }
})

test("money in and out leaves out transfers and hidden transactions", async () => {
  const m = model.get()
  const page = (await call("GET", "/transactions?status=all&limit=1")).json
  let inflow = 0
  let outflow = 0
  for (const a of m.allocations) {
    if (a.group === "transfer") continue
    if (a.amountCents > 0) inflow += a.amountCents
    else outflow += a.amountCents
  }
  assert.ok(m.allocations.some((a) => a.group === "transfer"))
  assert.equal(page.inflowCents, inflow)
  assert.equal(page.outflowCents, outflow)
  // A day of nothing but a matched transfer has no day total.
  const pair = m.txns.find(
    (t) =>
      t.transferPairId &&
      m.txns.every(
        (x) =>
          x.date !== t.date ||
          x.hidden ||
          m.category(x.categoryEff).group === "transfer"
      )
  )
  if (pair) {
    const day = (
      await call("GET", `/transactions?from=${pair.date}&to=${pair.date}`)
    ).json
    assert.equal(day.dayTotals[pair.date], undefined)
  }
  // The dashboard leaves both halves of a matched transfer off recent activity.
  const recent = (await call("GET", "/summary")).json.recent
  assert.ok(
    recent.every((t: { transferPairId: string | null }) => !t.transferPairId)
  )
})

test("a rule's matches open as the same set of transactions", async () => {
  const match = { merchant_contains: "coffee" }
  const preview = (await call("POST", "/rules/preview", { match })).json
  const list = (
    await call(
      "GET",
      `/transactions?status=all&limit=1&match=${encodeURIComponent(JSON.stringify(match))}`
    )
  ).json
  assert.ok(preview.total > 0)
  assert.equal(list.total, preview.total)
  // A malformed match is ignored rather than failing the page.
  assert.equal((await call("GET", "/transactions?match=%7Bnope")).status, 200)
})

test("an account's money in and out carries its payments", async () => {
  const card = model.get().accounts.find((a) => a.type === "credit")!
  const d = (await call("GET", `/accounts/${card.id}`)).json
  assert.ok(
    d.flows.some((f: { transferInCents: number }) => f.transferInCents > 0)
  )
})

test("closed accounts stop counting after their last balance", async () => {
  const m = model.get()
  const old = m.accounts.find((a) => a.availability !== "available")!
  await call("PATCH", `/accounts/${old.id}`, { excludeNetWorth: false })
  const summary = (await call("GET", "/summary?range=all")).json
  const counted = m.accounts
    .filter((a) => a.availability === "available" && !a.excludeNetWorth)
    .reduce((s, a) => s + (a.balanceCents ?? 0), 0)
  assert.equal(summary.netWorth.cents, counted)
  const early = summary.netWorth.series.find(
    (p: { date: string }) => p.date < "2025-03-01"
  )
  assert.ok(early)
  await call("PATCH", `/accounts/${old.id}`, { excludeNetWorth: true })
})

test("a corrected date moves the transaction between months; clearing restores it", async () => {
  const t = txns().find(
    (x) =>
      x.date.startsWith("2026-10") &&
      x.categoryEff === "shopping" &&
      !x.splits &&
      !x.hidden
  )!
  const before = (await call("GET", "/cashflow?months=3")).json.months as {
    month: string
    spendingCents: number
  }[]
  assert.equal(
    (await call("PATCH", `/transactions/${t.id}`, { date: "2026-13-01" }))
      .status,
    422
  )
  await call("PATCH", `/transactions/${t.id}`, { date: "2026-11-02" })
  const moved = model.get().txn.get(t.id)!
  assert.equal(moved.date, "2026-11-02")
  assert.equal(moved.snapshot.date, t.snapshot.date)
  const after = (await call("GET", "/cashflow?months=3")).json.months as {
    month: string
    spendingCents: number
  }[]
  const delta = (month: string) =>
    after.find((f) => f.month === month)!.spendingCents -
    before.find((f) => f.month === month)!.spendingCents
  assert.equal(delta("2026-11"), -t.amountCents)
  assert.equal(delta("2026-10"), t.amountCents)
  const detail = (await call("GET", `/transactions/${t.id}`)).json
  assert.equal(detail.original.date, t.snapshot.date)
  assert.equal(detail.overridden.date, true)
  await call("PATCH", `/transactions/${t.id}`, { date: t.snapshot.date })
  assert.equal(model.get().txn.get(t.id)!.override.date, false)
})

test("sync requests are recorded per source and unknown sources 404", async () => {
  const src = model.get().detail.sources[0]
  const r = await call("POST", `/sources/${src.id}/sync`)
  assert.equal(r.status, 202)
  const meta = (await call("GET", "/meta")).json
  assert.equal(
    meta.sources.find((x: { id: string }) => x.id === src.id).syncRequestedAt,
    r.json.requestedAt
  )
  assert.equal((await call("POST", "/sources/src_missing/sync")).status, 404)
})

test("transaction pages carry day totals across pages", async () => {
  const page = (await call("GET", "/transactions?limit=5")).json
  const day = page.items[0].date
  const m = model.get()
  const all = m.allocations.filter(
    (a) => a.txn.date === day && a.group !== "transfer"
  )
  assert.equal(
    page.dayTotals[day],
    all.reduce((s, a) => s + a.amountCents, 0)
  )
})

test("date edits accept only real calendar dates", async () => {
  const t = txns().find((x) => !x.splits && !x.hidden)!
  for (const bad of [
    "2026-02-31",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "0000-01-01",
    "2026-1-01",
    "2026-01-01T00:00",
  ])
    assert.equal(
      (await call("PATCH", `/transactions/${t.id}`, { date: bad })).status,
      422,
      bad
    )
  for (const good of ["2024-02-29", "0001-01-01", "9999-12-31"]) {
    assert.equal(
      (await call("PATCH", `/transactions/${t.id}`, { date: good })).status,
      200,
      good
    )
    assert.equal(model.get().txn.get(t.id)!.date, good)
  }
  await call("PATCH", `/transactions/${t.id}`, { date: null })
  assert.equal(model.get().txn.get(t.id)!.override.date, false)
})
