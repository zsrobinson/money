import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageGrid,
  PageHeader,
  PageMeta,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { DonutChart, TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { z } from "zod"
import {
  Amount,
  CardLink,
  Change,
  EmptyState,
  Loading,
  BudgetBar,
  MerchantMark,
  RangeSelect,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { useIsMobile } from "@zsrobinson/shell/hooks/use-mobile"
import { useCategories } from "@/components/category-style"
import { GoalsCard } from "@/components/goals"
import { TxnRows } from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import {
  accountKind,
  CADENCE,
  epoch,
  epochFullDate,
  money,
  moneyTick,
  monthName,
  percent,
  relativeDay,
} from "@/lib/format"
import { investmentsQuery, metaQuery, summaryQuery } from "@/lib/queries"
import type { Account, BudgetRow, Range } from "@/lib/types"

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: { crumbs: [{ label: "Dashboard", to: "/" }] },
  component: Dashboard,
})

const whole = (dollars: number) =>
  money(Math.round(dollars * 100), { whole: true })

function Dashboard() {
  usePageTitle("Dashboard")
  const { range } = Route.useSearch()
  const navigate = useNavigate({ from: "/" })
  const meta = useQuery(metaQuery)
  const summary = useQuery(summaryQuery(range))
  const investments = useQuery(investmentsQuery("3m"))
  const setRange = (r: Range) =>
    void navigate({ search: { range: r }, replace: true })
  const s = summary.data
  const cats = useCategories()
  const mobile = useIsMobile()
  const today = meta.data?.today
  const elapsed = today
    ? Number(today.slice(8, 10)) /
      new Date(
        Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)
      ).getUTCDate()
    : 0
  const netPoints = (s?.netWorth.series ?? []).map((p) => ({
    time: epoch(p.date),
    net: p.net / 100,
  }))
  const invPoints = (investments.data?.series ?? []).map((p) => ({
    time: epoch(p.date),
    value: p.cents / 100,
  }))
  return (
    <Page>
      <PageHeader>
        <PageTitle>Dashboard</PageTitle>
      </PageHeader>
      {summary.isError ? (
        <QueryError
          title="Dashboard failed to load"
          error={summary.error}
          onRetry={() => summary.refetch()}
        />
      ) : null}
      {!s ? (
        <Loading rows={8} />
      ) : (
        <>
          <PageGrid layout="wide" className="items-stretch">
            <SectionCard
              title="Net worth"
              action={<RangeSelect value={s.range} onChange={setRange} />}
            >
              <StatRow className="mb-4">
                <Stat
                  label="Net worth"
                  detail={
                    <Change
                      cents={s.netWorth.changeCents}
                      suffix="in this range"
                    />
                  }
                >
                  <Amount cents={s.netWorth.cents} tone="plain" whole />
                </Stat>
                <Stat label="Assets">
                  <Amount cents={s.netWorth.assetsCents} tone="plain" whole />
                </Stat>
                <Stat label="Liabilities">
                  <Amount
                    cents={s.netWorth.liabilitiesCents}
                    tone="plain"
                    whole
                  />
                </Stat>
              </StatRow>
              <TrendChart
                label="Net worth over time"
                baseline="data"
                data={netPoints}
                config={{
                  net: { label: "Net worth", color: "var(--chart-1)" },
                }}
                format={whole}
                formatTick={moneyTick}
                formatTime={epochFullDate}
                utc
                className="h-52"
              />
            </SectionCard>
            <SectionCard
              title={monthName(s.month.month)}
              action={<CardLink to="/cash-flow">Cash flow</CardLink>}
            >
              <StatRow className="mb-4">
                <Stat
                  label="Spending"
                  detail={paceText(
                    s.month.spendingCents,
                    s.month.lastMonthSameDayCents
                  )}
                >
                  <Amount cents={s.month.spendingCents} tone="plain" whole />
                </Stat>
                <Stat label="Income">
                  <Amount cents={s.month.incomeCents} tone="plain" whole />
                </Stat>
              </StatRow>
              <TrendChart
                curve="linear"
                label="Spending this month against last month, by day"
                data={s.month.pace.map((p) => ({
                  time: p.day,
                  thisMonth: p.thisMonth == null ? null : p.thisMonth / 100,
                  lastMonth: p.lastMonth == null ? null : p.lastMonth / 100,
                }))}
                config={{
                  thisMonth: { label: "This month", color: "var(--chart-1)" },
                  lastMonth: {
                    label: "Last month",
                    color: "var(--chart-neutral)",
                  },
                }}
                dashed={["lastMonth"]}
                format={whole}
                formatTick={moneyTick}
                formatTime={(d) => `Day ${d}`}
                timeTicks={[1, 8, 15, 22, 29]}
                formatTimeTick={(d) => String(d)}
                className="h-52"
              />
            </SectionCard>
          </PageGrid>
          <PageGrid className="items-stretch lg:grid-cols-3">
            <SectionCard
              title="Budget"
              fill
              action={<CardLink to="/budgets">Budgets</CardLink>}
            >
              {s.budget.rows.length ? (
                <div className="flex flex-col gap-3">
                  <div className="mb-1 flex items-end justify-between gap-3">
                    <Stat
                      label="Spent in budgets"
                      detail={
                        s.budget.unbudgetedCents
                          ? `of ${money(s.budget.budgetedCents, { whole: true })} · + ${money(s.budget.unbudgetedCents, { whole: true })} outside`
                          : `of ${money(s.budget.budgetedCents, { whole: true })}`
                      }
                    >
                      {money(s.budget.spentCents, { whole: true })}
                    </Stat>
                    <span
                      className={`text-sm ${
                        s.budget.over
                          ? "text-negative"
                          : "text-muted-foreground"
                      }`}
                    >
                      {s.budget.over ? `${s.budget.over} over` : "On budget"}
                    </span>
                  </div>
                  {s.budget.rows.map((r) => (
                    <div key={r.code} className="flex flex-col gap-2">
                      <BudgetMeter row={r} elapsed={elapsed} />
                      {r.children.map((c) => (
                        <BudgetMeter
                          key={c.code}
                          row={c}
                          child
                          elapsed={elapsed}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No budgets yet"
                  action={
                    <Button
                      size="sm"
                      render={<Link to="/budgets" />}
                      nativeButton={false}
                    >
                      Set budgets
                    </Button>
                  }
                />
              )}
            </SectionCard>
            <SectionCard
              title="Spending by category"
              fill
              action={<CardLink to="/reports">Reports</CardLink>}
            >
              <DonutChart
                label={`Spending by category in ${monthName(s.month.month)}`}
                totalLabel="spent"
                format={(v) => money(v, { whole: true })}
                data={s.month.top.map((c) => ({
                  key: c.code,
                  label: c.label,
                  value: c.cents,
                  color: cats.color(c.code),
                }))}
                onSelect={(code) =>
                  void navigate({
                    to: "/reports/categories/$code",
                    params: { code },
                  })
                }
              />
            </SectionCard>
            <SectionCard
              title="Upcoming"
              flush
              fill
              action={<CardLink to="/recurring">Recurring</CardLink>}
            >
              {s.upcoming.length ? (
                <ul className="flex flex-col divide-y divide-border/70">
                  {s.upcoming.map((r) => (
                    <li key={r.key}>
                      <Link
                        to="/reports/merchants/$key"
                        params={{ key: r.key }}
                        className="flex min-h-12 items-center gap-3 px-5 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted"
                      >
                        <MerchantMark name={r.merchant} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="line-clamp-2 text-sm font-medium">
                            {r.merchant}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {relativeDay(
                              r.nextDate,
                              meta.data?.today ?? r.nextDate
                            )}{" "}
                            · {CADENCE[r.cadence] ?? r.cadence}
                          </span>
                        </span>
                        <Amount
                          cents={r.amountCents}
                          className="text-sm whitespace-nowrap"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted-foreground">
                  Nothing due in the next month.
                </p>
              )}
            </SectionCard>
          </PageGrid>
          <PageGrid layout="wide">
            <PageStack>
              {s.review.length ? (
                <SectionCard
                  title={`Needs review · ${s.unreviewed}`}
                  flush
                  action={
                    <CardLink
                      to="/transactions"
                      search={{ status: "unreviewed" }}
                    >
                      Review all
                    </CardLink>
                  }
                >
                  <TxnRows
                    items={s.review}
                    showAccount={false}
                    grouped={false}
                    editable
                    linkSearch={{
                      list: { status: "unreviewed" },
                    }}
                  />
                </SectionCard>
              ) : null}
              <SectionCard
                title="Recent transactions"
                flush
                action={
                  <CardLink to="/transactions">All transactions</CardLink>
                }
              >
                <TxnRows
                  items={mobile ? s.recent.slice(0, 5) : s.recent}
                  showAccount={false}
                />
              </SectionCard>
            </PageStack>
            <PageStack>
              <GoalsCard goals={s.goals} />
              {investments.data?.holdings.length ? (
                <SectionCard
                  title="Investments"
                  action={<CardLink to="/investments">Holdings</CardLink>}
                >
                  <StatRow className="mb-3">
                    <Stat label="Value">
                      <Amount
                        cents={investments.data.totalCents}
                        tone="plain"
                        whole
                      />
                    </Stat>
                    <Stat label="Gain on cost">
                      <Amount
                        cents={investments.data.gainCents}
                        tone="signed"
                        whole
                      />
                    </Stat>
                    {investments.data.performance ? (
                      <Stat label="Market, 3 months">
                        <Amount
                          cents={investments.data.performance.marketCents}
                          tone="signed"
                          whole
                        />
                      </Stat>
                    ) : null}
                  </StatRow>
                  <TrendChart
                    label="Investment value, last 3 months"
                    baseline="data"
                    data={invPoints}
                    config={{
                      value: { label: "Value", color: "var(--chart-1)" },
                    }}
                    format={whole}
                    formatTick={moneyTick}
                    formatTime={epochFullDate}
                    utc
                    className="h-32"
                  />
                </SectionCard>
              ) : null}
              <SectionCard
                title="Accounts"
                flush
                action={<CardLink to="/accounts">Accounts</CardLink>}
                footer={
                  meta.data ? (
                    <Freshness
                      generatedAt={meta.data.generatedAt}
                      stale={
                        meta.data.sources.filter((x) => x.status !== "healthy")
                          .length
                      }
                    />
                  ) : undefined
                }
              >
                <AccountGroups accounts={s.accounts} compact={mobile} />
              </SectionCard>
            </PageStack>
          </PageGrid>
        </>
      )}
    </Page>
  )
}

function paceText(spent: number, lastSameDay: number) {
  if (!lastSameDay) return "Nothing to compare yet"
  const diff = spent - lastSameDay
  const share = Math.abs(diff) / lastSameDay
  if (share < 0.03) return "Same pace as last month"
  return `${percent(share)} ${diff > 0 ? "more" : "less"} than last month by now`
}

function BudgetMeter({
  row: r,
  child = false,
  elapsed,
}: {
  row: BudgetRow
  child?: boolean
  elapsed: number
}) {
  const limit = (r.totalBudgetCents ?? 0) + r.rolloverCents
  return (
    <Link
      to="/reports/categories/$code"
      params={{ code: r.code }}
      className={`flex flex-col gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring ${child ? "pl-4" : ""}`}
    >
      <span className="flex justify-between gap-3 text-sm">
        <span className={`truncate ${child ? "text-muted-foreground" : ""}`}>
          {r.label}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {money(r.spentCents, { whole: true })}
          {r.totalBudgetCents != null
            ? ` / ${money(limit, { whole: true })}`
            : ""}
        </span>
      </span>
      {r.totalBudgetCents != null ? (
        <BudgetBar
          label={`${r.label} budget used`}
          spent={r.spentCents}
          budget={limit}
          elapsed={elapsed}
        />
      ) : null}
    </Link>
  )
}

/** Accounts by kind; `compact` shows only each kind's total, for a phone. */
function AccountGroups({
  accounts,
  compact = false,
}: {
  accounts: Account[]
  compact?: boolean
}) {
  const kinds = ["Cash", "Credit cards", "Investments", "Loans", "Other"]
  if (compact)
    return (
      <ul className="flex flex-col divide-y divide-border/70">
        {kinds.map((kind) => {
          const list = accounts.filter((a) => accountKind(a) === kind)
          if (!list.length) return null
          return (
            <li
              key={kind}
              className="flex min-h-10 items-center justify-between px-5 py-2 text-sm"
            >
              <span>
                {kind}{" "}
                <span className="text-muted-foreground">· {list.length}</span>
              </span>
              <Amount
                cents={list.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0)}
                tone="plain"
                whole
                className="font-medium"
              />
            </li>
          )
        })}
      </ul>
    )
  return (
    <div className="flex flex-col">
      {kinds.map((kind) => {
        const list = accounts.filter((a) => accountKind(a) === kind)
        if (!list.length) return null
        const total = list.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0)
        return (
          <div
            key={kind}
            className="border-t border-border/70 first:border-t-0"
          >
            <div className="flex items-center justify-between px-5 pt-2.5 pb-0.5 text-xs text-muted-foreground">
              <span>{kind}</span>
              <span className="tabular-nums">
                {money(total, { whole: true })}
              </span>
            </div>
            <ul>
              {list.map((a) => (
                <li key={a.id}>
                  <Link
                    to="/accounts/$id"
                    params={{ id: a.id }}
                    className="flex min-h-10 items-center justify-between gap-3 px-5 py-1.5 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{a.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {a.institution}
                      </span>
                    </span>
                    <Amount
                      cents={a.balanceCents}
                      tone="plain"
                      className="font-medium"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function Freshness({
  generatedAt,
  stale,
}: {
  generatedAt: string | null
  stale: number
}) {
  return (
    <PageMeta className="mr-auto text-xs">
      <span>
        {generatedAt
          ? `Updated ${new Date(generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
          : "Not synced yet"}
      </span>
      {stale ? (
        <Link
          to="/settings"
          hash="connections"
          className="text-negative underline-offset-4 hover:underline"
        >
          {stale === 1
            ? "1 connection needs attention"
            : `${stale} connections need attention`}
        </Link>
      ) : null}
    </PageMeta>
  )
}
