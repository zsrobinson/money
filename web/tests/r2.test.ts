import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApi } from "../server/api.ts"
import { openAppDb } from "../server/app-db.ts"
import { detailStore } from "../server/detail.ts"
import { createModel, manualHistory } from "../server/model.ts"
import { splitByShare } from "../server/rules.ts"
import { comparison, period } from "../server/periods.ts"
import { FIXTURE_TODAY, generate } from "../fixtures/generate.ts"

const dir = mkdtempSync(join(tmpdir(), "money-r2-"))
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
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T }
}

test("review counts only transactions on or after the review start, and honours the switch", async () => {
  const m = model.get()
  const since = m.review.since!
  assert.equal(since, "2026-10-01")
  const waiting = m.txns.filter((t) => t.needsReview)
  assert.ok(waiting.length > 0)
  assert.ok(waiting.every((t) => t.date >= since && !t.reviewed && !t.hidden))
  // Older unreviewed transactions exist but do not count.
  assert.ok(m.txns.some((t) => !t.reviewed && !t.pending && t.date < since))
  assert.equal((await call("GET", "/meta")).json.unreviewed, waiting.length)
  const list = (await call("GET", "/transactions?status=unreviewed&limit=200"))
    .json
  assert.equal(list.total, waiting.length)
  // Off: nothing needs review anywhere.
  await call("PATCH", "/settings", { reviewNewTransactions: false })
  assert.equal((await call("GET", "/meta")).json.unreviewed, 0)
  assert.equal((await call("GET", "/summary")).json.unreviewed, 0)
  // Back on: the queue starts today.
  await call("PATCH", "/settings", { reviewNewTransactions: true })
  assert.equal(model.get().review.since, FIXTURE_TODAY)
  // "Mark everything before today reviewed", then restore the fixture's start.
  const r = await call("POST", "/review/start", { since })
  assert.equal(r.json.reviewSince, since)
  assert.equal((await call("GET", "/meta")).json.unreviewed, waiting.length)
})

test("previous and next follow the filtered list, even after reviewing", async () => {
  const list = (await call("GET", "/transactions?status=unreviewed&limit=200"))
    .json.items as { id: string }[]
  assert.ok(list.length >= 3)
  const [a, b, c] = list
  const n = (
    await call("GET", `/transactions/${b.id}/neighbors?status=unreviewed`)
  ).json
  assert.deepEqual([n.previous, n.next], [a.id, c.id])
  // Reviewed: it leaves the queue, and next is still the one after it.
  await call("PATCH", `/transactions/${b.id}`, { reviewed: true })
  const after = (
    await call("GET", `/transactions/${b.id}/neighbors?status=unreviewed`)
  ).json
  assert.equal(after.index, -1)
  assert.equal(after.next, c.id)
  await call("PATCH", `/transactions/${b.id}`, { reviewed: null })
})

test("bulk edits apply to every match of a filter, beyond one page", async () => {
  const tag = (await call("POST", "/tags", { name: "Bulk test" })).json.id
  const filter = { category: "food", limit: "50" }
  const total = (await call("GET", "/transactions?category=food&limit=1")).json
    .total
  assert.ok(total > 50, "more than one page matches")
  const r = await call("POST", "/transactions/bulk", { filter, addTag: tag })
  assert.equal(r.json.updated, total)
  assert.equal(
    (await call("GET", `/transactions?tag=${tag}&limit=1`)).json.total,
    total
  )
  const removed = await call("POST", "/transactions/bulk", {
    filter,
    removeTag: tag,
  })
  assert.equal(removed.json.keptByRules, 0)
  assert.equal(
    (await call("GET", `/transactions?tag=${tag}&limit=1`)).json.total,
    0
  )
  // Hide and unhide, mark not reviewed, set merchant, by ids.
  const ids = (
    await call("GET", "/transactions?q=metro&limit=3")
  ).json.items.map((t: { id: string }) => t.id)
  await call("POST", "/transactions/bulk", { ids, patch: { hidden: true } })
  assert.ok(ids.every((id: string) => model.get().txn.get(id)!.hidden))
  await call("POST", "/transactions/bulk", {
    ids,
    patch: { hidden: null, merchant: "Metro (renamed)", reviewed: false },
  })
  const t = model.get().txn.get(ids[0])!
  assert.equal(t.hidden, false)
  assert.equal(t.merchantEff, "Metro (renamed)")
  assert.equal(t.reviewed, false)
  await call("POST", "/transactions/bulk", {
    ids,
    patch: { merchant: null, reviewed: null },
  })
  assert.equal(
    (await call("POST", "/transactions/bulk", { filter, patch: {} })).status,
    422
  )
  await call("DELETE", `/tags/${tag}`)
})

test("manual accounts carry stated balances plus later transactions into net worth", async () => {
  // Statement, then transactions move it; a later statement resets it.
  const h = manualHistory(
    { type: "cash" },
    [
      { date: "2026-01-01", cents: 10000 },
      { date: "2026-01-10", cents: 5000 },
    ],
    [
      { date: "2026-01-01", amountCents: -999 },
      { date: "2026-01-05", amountCents: -1500 },
      { date: "2026-01-12", amountCents: -500 },
    ]
  )
  assert.deepEqual(
    h.map((x) => [x.date, x.cents]),
    [
      ["2026-01-01", 10000],
      ["2026-01-05", 8500],
      ["2026-01-10", 5000],
      ["2026-01-12", 4500],
    ]
  )
  // A liability's amount owed grows with spending.
  assert.equal(
    manualHistory(
      { type: "credit" },
      [{ date: "2026-01-01", cents: 1000 }],
      [{ date: "2026-01-02", amountCents: -250 }]
    ).at(-1)!.cents,
    1250
  )
  const before = (await call("GET", "/summary?range=1m")).json.netWorth.cents
  const created = await call("POST", "/accounts", {
    name: "Coin jar",
    type: "cash",
    balanceCents: 12000,
    date: "2026-11-01",
  })
  assert.equal(created.status, 201)
  const id = created.json.id
  assert.ok(id.startsWith("macct_"))
  const t = await call("POST", "/transactions", {
    accountId: id,
    date: "2026-11-10",
    amountCents: -2000,
    merchant: "Laundromat",
    category: "other",
  })
  assert.equal(t.status, 201)
  const acct = (await call("GET", `/accounts/${id}`)).json
  assert.equal(acct.account.balanceCents, 10000)
  assert.equal(acct.account.manual, true)
  assert.equal(acct.balances[0].cents, 12000)
  assert.equal(
    (await call("GET", "/summary?range=1m")).json.netWorth.cents,
    before + 10000
  )
  // The manual transaction is everywhere a synced one is, and editable.
  const txn = (await call("GET", `/transactions/${t.json.id}`)).json
  assert.equal(txn.manual, true)
  assert.equal(txn.needsReview, false)
  await call("PATCH", `/transactions/${t.json.id}`, { amountCents: -3000 })
  assert.equal(
    (await call("GET", `/accounts/${id}`)).json.account.balanceCents,
    9000
  )
  // Linked accounts sync their own; only manual transactions change amount.
  const linked = model.get().accounts.find((a) => !a.manual)!
  assert.equal(
    (
      await call("POST", "/transactions", {
        accountId: linked.id,
        date: "2026-11-10",
        amountCents: -1,
        category: "other",
      })
    ).status,
    422
  )
  const synced = model.get().txns.find((x) => !x.manual)!
  assert.equal(
    (await call("PATCH", `/transactions/${synced.id}`, { amountCents: -1 }))
      .status,
    422
  )
  await call("PUT", `/accounts/${id}/balances/2026-11-15`, { cents: 500 })
  assert.equal(
    (await call("GET", `/accounts/${id}`)).json.account.balanceCents,
    500
  )
  assert.equal((await call("DELETE", `/accounts/${id}`)).status, 200)
  assert.equal(model.get().txn.get(t.json.id), undefined)
  assert.equal(
    (await call("GET", "/summary?range=1m")).json.netWorth.cents,
    before
  )
})

test("net worth by kind of account adds up to net worth", async () => {
  const nw = (await call("GET", "/networth?range=3m")).json
  const summary = (await call("GET", "/summary?range=3m")).json.netWorth
  assert.ok(nw.groups.includes("property"))
  assert.equal(nw.series.at(-1).net, summary.cents)
  const last = nw.series.at(-1)
  assert.equal(
    nw.groups.reduce((s: number, g: string) => s + last[g], 0),
    last.net
  )
  assert.ok(last.credit < 0 && last.loans < 0)
})

test("categories: custom groups, merge into another, delete with move", async () => {
  const kids = await call("POST", "/categories", {
    label: "Kids",
    group: "expense",
    icon: "baby",
    color: "blue",
  })
  assert.equal(kids.status, 201)
  const lessons = await call("POST", "/categories", {
    label: "Lessons",
    parent: kids.json.code,
  })
  assert.equal(lessons.status, 201)
  assert.equal(
    (await call("POST", "/categories", { label: "No group" })).status,
    422
  )
  // Nesting stops at one level.
  assert.equal(
    (
      await call("POST", "/categories", {
        label: "Deep",
        parent: lessons.json.code,
      })
    ).status,
    422
  )
  const t = model
    .get()
    .txns.find((x) => x.categoryEff === "health" && !x.splits && !x.pending)!
  await call("PATCH", `/transactions/${t.id}`, { category: lessons.json.code })
  const cat = model.get().category(lessons.json.code)
  assert.equal(cat.parent, kids.json.code)
  assert.equal(cat.owned, "other", "a custom group reports as Other outside")
  // In use: deleting needs somewhere to move it.
  assert.equal(
    (await call("DELETE", `/categories/${lessons.json.code}`)).status,
    409
  )
  assert.equal(
    (await call("DELETE", `/categories/${lessons.json.code}?moveTo=health`))
      .status,
    200
  )
  assert.equal(model.get().txn.get(t.id)!.categoryEff, "health")
  assert.equal(
    (await call("DELETE", `/categories/${kids.json.code}`)).status,
    200
  )
  // Merging a built-in category moves the bank's category too, and restores.
  const fees = model.get().txns.filter((x) => x.categoryEff === "fees").length
  assert.ok(fees > 0)
  await call("POST", "/categories/fees/merge", { into: "other" })
  assert.equal(
    model.get().txns.filter((x) => x.categoryEff === "fees").length,
    0
  )
  assert.equal(model.get().category("fees").hidden, true)
  await call("PATCH", "/categories/fees", { mergedInto: null })
  assert.equal(
    model.get().txns.filter((x) => x.categoryEff === "fees").length,
    fees
  )
  // Colours stay fixed per category.
  const list = (await call("GET", "/categories")).json
  assert.equal(
    list.find((c: { code: string }) => c.code === "food").color,
    "orange"
  )
})

test("peer payments count in spending by default; one click makes one a transfer", async () => {
  const m = model.get()
  assert.equal(m.category("peer_payment").group, "expense")
  const sent = m.txns.find(
    (t) =>
      t.categoryEff === "peer_payment" &&
      t.amountCents < 0 &&
      !t.pending &&
      t.date.slice(0, 7) === "2026-10"
  )!
  const month = (await call("GET", "/cashflow?key=2026-10")).json
  const before = month.spendingCents
  await call("PATCH", `/transactions/${sent.id}`, { category: "bank_transfer" })
  const after = (await call("GET", "/cashflow?key=2026-10")).json
  assert.equal(after.spendingCents, before + sent.amountCents)
  await call("PATCH", `/transactions/${sent.id}`, { category: null })
})

test("rules: new conditions, any-of groups, only-new scope and percentage splits", async () => {
  assert.deepEqual(
    splitByShare(-1001, [
      { category: "food", percent: 3333 },
      { category: "travel", percent: 6667 },
    ]).parts,
    [
      { category: "food", amountCents: -333 },
      { category: "travel", amountCents: -668 },
    ]
  )
  assert.deepEqual(
    splitByShare(-1, [
      { category: "food", percent: 5000 },
      { category: "travel", percent: 5000 },
    ]),
    { parts: [], single: "travel" }
  )
  const rule = await call("POST", "/rules", {
    match: {
      any: [
        { merchant_starts_with: "saffron" },
        { description_contains: "bluebird" },
      ],
      direction: "out",
    },
    action: {
      split: [
        { category: "food", percent: 5000 },
        { category: "entertainment", percent: 5000 },
      ],
      tags: [],
      mark_recurring: false,
    },
    appliesFrom: "2026-11-01",
  })
  assert.equal(rule.status, 201, JSON.stringify(rule.json))
  const m = model.get()
  const hit = m.txns.filter((t) => t.ruleIds.includes(rule.json.id))
  assert.ok(hit.length > 0)
  assert.ok(hit.every((t) => t.snapshot.date >= "2026-11-01"))
  const split = hit.find((t) => !t.override.category)!
  assert.equal(split.ruleSplit, true)
  assert.equal(
    split.splits!.reduce((s, x) => s + x.amountCents, 0),
    split.amountCents
  )
  // Scope to all history widens it.
  await call("PATCH", `/rules/${rule.json.id}`, { appliesFrom: null })
  assert.ok(
    model.get().txns.filter((t) => t.ruleIds.includes(rule.json.id)).length >
      hit.length
  )
  assert.equal(
    (
      await call("POST", "/rules", {
        match: { merchant_contains: "x" },
        action: {
          split: [
            { category: "food", percent: 5000 },
            { category: "travel", percent: 4000 },
          ],
        },
      })
    ).status,
    422
  )
  await call("DELETE", `/rules/${rule.json.id}`)
})

test("recurring: calendar with paid and due, expected amounts, marking by hand", async () => {
  const r = (await call("GET", "/recurring")).json
  assert.ok(r.calendar.length > 0)
  assert.ok(
    r.calendar.every((o: { date: string }) => o.date.startsWith("2026-11"))
  )
  assert.ok(r.calendar.some((o: { state: string }) => o.state === "paid"))
  assert.ok(r.calendar.some((o: { state: string }) => o.state === "due"))
  assert.equal(r.bills.length, 2)
  const item = r.items.find((i: { status: string }) => i.status === "active")
  await call("PATCH", `/recurring/${encodeURIComponent(item.key)}`, {
    expectedCents: -12345,
  })
  const detail = (
    await call("GET", `/recurring/${encodeURIComponent(item.key)}`)
  ).json
  assert.equal(detail.amountCents, -12345)
  assert.equal(detail.edited, true)
  assert.ok(detail.transactions.length > 0)
  assert.ok(detail.upcoming.length > 0)
  await call("DELETE", `/recurring/${encodeURIComponent(item.key)}`)
  assert.equal(
    (await call("GET", `/recurring/${encodeURIComponent(item.key)}`)).json
      .edited,
    false
  )
  // A merchant seen once becomes recurring when marked by hand.
  const once = model
    .get()
    .txns.find(
      (t) =>
        t.merchantKey &&
        model.get().txns.filter((x) => x.merchantKey === t.merchantKey)
          .length === 1 &&
        model.get().category(t.categoryEff).group === "expense"
    )!
  await call("PATCH", `/recurring/${encodeURIComponent(once.merchantKey)}`, {
    status: "active",
    cadence: "yearly",
  })
  const items = (await call("GET", "/recurring")).json.items
  const mine = items.find((i: { key: string }) => i.key === once.merchantKey)
  assert.equal(mine.cadence, "yearly")
  assert.equal(mine.manual, true)
  // Its page works with a single charge.
  const one = (
    await call("GET", `/recurring/${encodeURIComponent(once.merchantKey)}`)
  ).json
  assert.equal(one.count, 1)
  assert.equal(one.transactions.length, 1)
  assert.ok(one.upcoming.length > 0)
  await call("DELETE", `/recurring/${encodeURIComponent(once.merchantKey)}`)
})

test("sync now is recorded for every source, at most once in five minutes", async () => {
  const first = await call("POST", "/sync")
  assert.equal(first.status, 202)
  const meta = (await call("GET", "/meta")).json
  assert.ok(
    meta.sources
      .filter((s: { status: string }) => s.status !== "disabled")
      .every(
        (s: { syncRequestedAt: string }) =>
          s.syncRequestedAt === first.json.requestedAt
      )
  )
  assert.equal((await call("POST", "/sync")).status, 429)
  // Settings cannot write sync requests directly.
  assert.equal(
    (await call("PATCH", "/settings", { syncRequests: {} })).status,
    422
  )
})

test("cash flow: periods, breakdowns and a balanced Sankey", async () => {
  assert.deepEqual(period("quarter", "2026-Q3", FIXTURE_TODAY), {
    kind: "quarter",
    key: "2026-Q3",
    from: "2026-07-01",
    to: "2026-09-30",
    previous: "2026-Q2",
    next: "2026-Q4",
  })
  assert.equal(period("month", "2026-11", FIXTURE_TODAY).next, null)
  assert.deepEqual(comparison("2026-07-01", "2026-09-30", "previous"), {
    from: "2026-04-01",
    to: "2026-06-30",
  })
  assert.deepEqual(comparison("2024-02-29", "2024-03-10", "year"), {
    from: "2023-02-28",
    to: "2023-03-10",
  })
  for (const by of ["category", "group", "merchant"]) {
    const q = (
      await call("GET", `/cashflow?period=quarter&key=2026-Q3&by=${by}`)
    ).json
    const tops = q.spending.filter((r: { parent: string | null }) => !r.parent)
    assert.equal(
      tops.reduce((s: number, r: { cents: number }) => s + r.cents, 0),
      q.spendingCents
    )
    const flows = q.months.filter((f: { month: string }) =>
      ["2026-07", "2026-08", "2026-09"].includes(f.month)
    )
    assert.equal(
      flows.reduce(
        (s: number, f: { spendingCents: number }) => s + f.spendingCents,
        0
      ),
      q.spendingCents
    )
    // Every node's flows in equal its flows out.
    const s = q.sankey
    const into = (id: string) =>
      s.links
        .filter((l: { target: string }) => l.target === id)
        .reduce((a: number, l: { value: number }) => a + l.value, 0)
    const out = (id: string) =>
      s.links
        .filter((l: { source: string }) => l.source === id)
        .reduce((a: number, l: { value: number }) => a + l.value, 0)
    assert.equal(into("hub"), out("hub"))
    // Saved in the chart is the period's income less spending.
    const saved = s.links.find((l: { target: string }) => l.target === "saved")
    if (q.netCents > 0) assert.equal(saved.value, q.netCents)
  }
})

test("report builder: measures, groupings, filters and comparisons", async () => {
  const base = "/reports/build?from=2026-05-01&to=2026-10-31"
  const groups = (await call("GET", `${base}&by=group&measure=spending`)).json
  const cats = (
    await call("GET", `${base}&by=category&measure=spending&limit=20`)
  ).json
  const merchants = (await call("GET", `${base}&by=merchant&measure=spending`))
    .json
  assert.equal(groups.totalCents, cats.totalCents)
  assert.equal(groups.totalCents, merchants.totalCents)
  assert.equal(groups.buckets.length, 6)
  // A filter narrows to one account; tags may overlap so have no grand total.
  const account = model.get().accounts.find((a) => a.subtype === "checking")!
  const one = (
    await call("GET", `${base}&by=none&measure=spending&account=${account.id}`)
  ).json
  assert.ok(one.totalCents < groups.totalCents)
  const tags = (await call("GET", `${base}&by=tag&measure=spending`)).json
  assert.equal(tags.totalCents, null)
  // Net is income less spending.
  const income = (await call("GET", `${base}&by=none&measure=income`)).json
  const net = (await call("GET", `${base}&by=none&measure=net`)).json
  assert.equal(net.totalCents, income.totalCents - groups.totalCents)
  // Comparisons.
  const year = (
    await call("GET", `${base}&by=group&measure=spending&compare=year`)
  ).json
  assert.deepEqual(
    [year.compare.from, year.compare.to],
    ["2025-05-01", "2025-10-31"]
  )
  const weeks = (
    await call("GET", `${base}&by=none&measure=spending&interval=week`)
  ).json
  assert.equal(
    weeks.series[0].values.reduce((s: number, v: number) => s + v, 0),
    groups.totalCents
  )
})

test("search finds merchants and transactions for the command palette", async () => {
  const r = (await call("GET", "/search?q=bluebird")).json
  assert.ok(r.merchants.length > 0)
  assert.ok(r.transactions.length > 0)
  assert.ok(r.transactions.length <= 8)
})

test("investments report contributions apart from market change", async () => {
  const r = (await call("GET", "/investments?range=1y")).json
  assert.ok(r.performance)
  const p = r.performance
  assert.equal(p.endCents - p.startCents, p.contributionsCents + p.marketCents)
  assert.ok(p.contributionsCents > 0)
  assert.ok(r.positions.length > 0)
  const h = (
    await call("GET", `/investments/holdings/${r.positions[0].securityId}`)
  ).json
  assert.equal(h.valueCents, r.positions[0].valueCents)
})

test("settings keep each valid value when another is bad", async () => {
  const db = model.db
  db.prepare(
    "INSERT OR REPLACE INTO settings VALUES('weekStartsOn', '\"someday\"')"
  ).run()
  model.invalidate()
  const s = (await call("GET", "/settings")).json
  assert.equal(s.weekStartsOn, "monday")
  assert.equal(s.reviewSince, "2026-10-01")
  db.prepare("DELETE FROM settings WHERE key='weekStartsOn'").run()
  model.invalidate()
})

test("top-level categories hold distinct colours; children are tints of their parent", async () => {
  const list = (await call("GET", "/categories")).json as {
    code: string
    parent: string | null
    color: string
  }[]
  const tops = list.filter((c) => !c.parent)
  assert.equal(new Set(tops.map((c) => c.color)).size, tops.length)
  for (const c of list.filter((c) => c.parent))
    assert.equal(
      c.color,
      `${list.find((p) => p.code === c.parent)!.color}/tint`
    )
})
