import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageMeta,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { DonutChart, TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { ArrowRightIcon } from "lucide-react"
import { z } from "zod"
import {
  Amount,
  Change,
  EmptyState,
  Loading,
  Meter,
  MerchantMark,
  RangeSelect,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { TxnRows } from "@/components/transactions"
import {
  accountKind,
  CADENCE,
  epoch,
  epochFullDate,
  money,
  monthName,
  percent,
  relativeDay,
} from "@/lib/format"
import { usePageTitle } from "@/lib/crumb"
import { investmentsQuery, metaQuery, summaryQuery } from "@/lib/queries"
import type { Range } from "@/lib/types"

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
  const setRange = (r: Range) =>
    void navigate({ search: { range: r }, replace: true })
  const s = summary.data
  const investments = useQuery(investmentsQuery("3m"))
  return (
    <Page>
      <PageHeader>
        <PageTitle>Dashboard</PageTitle>
        <PageActions>
          {s?.unreviewed ? (
            <Button
              variant="outline"
              size="sm"
              render={
                <Link to="/transactions" search={{ status: "unreviewed" }} />
              }
              nativeButton={false}
            >
              Review {s.unreviewed} transactions
            </Button>
          ) : null}
        </PageActions>
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
          <PageGrid layout="wide">
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
                data={s.netWorth.series.map((p) => ({
                  time: epoch(p.date),
                  net: p.net / 100,
                }))}
                config={{
                  net: { label: "Net worth", color: "var(--chart-1)" },
                }}
                format={whole}
                formatTime={epochFullDate}
                className="h-52"
              />
            </SectionCard>
            <SectionCard
              title={monthName(s.month.month)}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link to="/cash-flow" />}
                  nativeButton={false}
                >
                  Cash flow
                </Button>
              }
            >
              <StatRow className="mb-4">
                <Stat
                  label="Spent"
                  detail={paceText(
                    s.month.spendingCents,
                    s.month.lastMonthSameDayCents
                  )}
                >
                  <Amount cents={s.month.spendingCents} tone="plain" whole />
                </Stat>
                <Stat label="Earned">
                  <Amount cents={s.month.incomeCents} tone="plain" whole />
                </Stat>
              </StatRow>
              <TrendChart
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
                format={whole}
                formatTime={(d) => `Day ${d}`}
                className="h-52"
              />
            </SectionCard>
          </PageGrid>
          <PageGrid layout="two">
            <SectionCard
              title="Budget"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link to="/budgets" />}
                  nativeButton={false}
                >
                  All budgets
                </Button>
              }
            >
              {s.budget.rows.length ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">
                      {money(s.budget.spentCents, { whole: true })} of{" "}
                      {money(s.budget.budgetedCents, { whole: true })}
                    </span>
                    <span
                      className={
                        s.budget.over
                          ? "text-negative"
                          : "text-muted-foreground"
                      }
                    >
                      {s.budget.over ? `${s.budget.over} over` : "On budget"}
                    </span>
                  </div>
                  {s.budget.rows.map((r) => (
                    <Link
                      key={r.code}
                      to="/reports/categories/$code"
                      params={{ code: r.code }}
                      className="flex flex-col gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex justify-between gap-3 text-sm">
                        <span className="truncate">{r.label}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {money(r.spentCents, { whole: true })} /{" "}
                          {money(r.budgetCents, { whole: true })}
                        </span>
                      </span>
                      <Meter
                        label={`${r.label} budget used`}
                        value={r.spentCents / (r.budgetCents || 1)}
                        tone={
                          r.spentCents > (r.budgetCents ?? 0)
                            ? "over"
                            : "default"
                        }
                      />
                    </Link>
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
            <SectionCard title="Spending by category">
              <DonutChart
                label={`Spending by category in ${monthName(s.month.month)}`}
                totalLabel="spent"
                format={(v) => money(v, { whole: true })}
                data={s.month.top.map((c) => ({
                  key: c.code,
                  label: c.label,
                  value: c.cents,
                }))}
                onSelect={(code) =>
                  void navigate({
                    to: "/reports/categories/$code",
                    params: { code },
                  })
                }
              />
            </SectionCard>
          </PageGrid>
          <PageGrid layout="wide">
            <PageStack>
              <SectionCard
                title="Recent transactions"
                flush
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<Link to="/transactions" />}
                    nativeButton={false}
                  >
                    View all
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                }
              >
                <TxnRows items={s.recent} showAccount={false} />
              </SectionCard>
              {investments.data?.holdings.length ? (
                <SectionCard
                  title="Investments"
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      render={<Link to="/investments" />}
                      nativeButton={false}
                    >
                      Holdings
                    </Button>
                  }
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
                    {investments.data.series.length > 1 ? (
                      <Stat label="Last 3 months">
                        <Amount
                          cents={
                            investments.data.series.at(-1)!.cents -
                            investments.data.series[0].cents
                          }
                          tone="signed"
                          whole
                        />
                      </Stat>
                    ) : null}
                  </StatRow>
                  <TrendChart
                    label="Investment value, last 3 months"
                    baseline="data"
                    data={investments.data.series.map((p) => ({
                      time: epoch(p.date),
                      value: p.cents / 100,
                    }))}
                    config={{
                      value: { label: "Value", color: "var(--chart-1)" },
                    }}
                    format={whole}
                    formatTime={epochFullDate}
                    className="h-36"
                  />
                </SectionCard>
              ) : null}
            </PageStack>
            <PageStack>
              <SectionCard
                title="Upcoming"
                flush
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<Link to="/recurring" />}
                    nativeButton={false}
                  >
                    Recurring
                  </Button>
                }
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
                            <span className="truncate text-sm font-medium">
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
                          <Amount cents={r.amountCents} className="text-sm" />
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
              <SectionCard
                title="Accounts"
                flush
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<Link to="/accounts" />}
                    nativeButton={false}
                  >
                    All accounts
                  </Button>
                }
              >
                <AccountGroups accounts={s.accounts} />
              </SectionCard>
              {meta.data ? (
                <Freshness
                  generatedAt={meta.data.generatedAt}
                  stale={
                    meta.data.sources.filter((x) => x.status !== "healthy")
                      .length
                  }
                />
              ) : null}
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

function AccountGroups({
  accounts,
}: {
  accounts: {
    id: string
    name: string
    type: string
    subtype: string | null
    balanceCents: number | null
    institution: string
  }[]
}) {
  const kinds = ["Cash", "Credit cards", "Investments", "Loans", "Other"]
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
            <div className="flex items-center justify-between px-5 pt-3 pb-1 text-xs text-muted-foreground">
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
    <PageMeta className="px-1 text-xs">
      <span>
        {generatedAt
          ? `Updated ${new Date(generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
          : "Not synced yet"}
      </span>
      {stale ? (
        <Link
          to="/settings"
          className="text-negative underline-offset-4 hover:underline"
        >
          {stale === 1
            ? "1 source needs attention"
            : `${stale} sources need attention`}
        </Link>
      ) : null}
    </PageMeta>
  )
}
