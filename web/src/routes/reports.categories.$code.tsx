import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { ArrowRightIcon } from "lucide-react"
import { Loading, Meter, SectionCard, Stat, StatRow } from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  epochMonthYear,
  money,
  moneyTick,
  monthEpoch,
  pluralize,
} from "@/lib/format"
import { budgetsQuery, categoryDetailQuery } from "@/lib/queries"

export const Route = createFileRoute("/reports/categories/$code")({
  staticData: {
    crumbs: [
      { label: "Reports", to: "/reports" },
      { label: "Categories", to: "/reports" },
    ],
  },
  component: CategoryDetail,
})

function CategoryDetail() {
  const { code } = Route.useParams()
  const q = useQuery(categoryDetailQuery(code))
  const budgets = useQuery(budgetsQuery())
  usePageTitle(q.data?.category.label, true)
  const d = q.data
  const income = d?.category.group === "income"
  const budget = budgets.data?.rows.find((r) => r.code === code)
  const thisMonth = d?.monthly.at(-1)?.cents ?? 0
  // Your categories with their own budget are tracked there, not here.
  const ownBudget = (d?.children ?? [])
    .filter(
      (c) =>
        budgets.data?.rows.find((r) => r.code === c.code)?.budgetCents != null
    )
    .map((c) => c.label)
  const maxMerchant = Math.max(1, ...(d?.merchants.map((m) => m.cents) ?? [1]))
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle>{d?.category.label ?? "Category"}</PageTitle>
          {d ? (
            <PageMeta>
              <span>
                {income
                  ? "Income"
                  : d.category.group === "transfer"
                    ? "Transfers"
                    : "Spending"}
              </span>
              {d.category.custom ? <span>Your category</span> : null}
            </PageMeta>
          ) : null}
        </div>
        <PageActions>
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/transactions" search={{ category: code }} />}
            nativeButton={false}
          >
            Transactions
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </PageActions>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="This category failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={8} />
      ) : (
        <>
          <StatRow>
            <Stat
              label="This month"
              detail={
                d.children.length ? "with your categories inside" : undefined
              }
            >
              {money(thisMonth, { whole: true })}
            </Stat>
            <Stat label="Monthly average" detail="last 11 full months">
              {money(d.averageCents, { whole: true })}
            </Stat>
            <Stat label="Last 12 months">
              {money(d.totalCents, { whole: true })}
            </Stat>
            {budget?.budgetCents != null ? (
              <Stat
                label="Budget this month"
                detail={`${money(budget.spentCents, { whole: true })} spent${ownBudget.length ? `, not counting ${ownBudget.join(", ")}` : ""}`}
              >
                {money(budget.budgetCents, { whole: true })}
              </Stat>
            ) : null}
          </StatRow>
          <SectionCard title="By month">
            <TrendChart
              kind="bar"
              label={`${d.category.label} by month`}
              data={d.monthly.map((m) => ({
                time: monthEpoch(m.month),
                amount: m.cents / 100,
              }))}
              config={{
                amount: {
                  label: income ? "Received" : "Spent",
                  color: "var(--chart-1)",
                },
              }}
              format={(v) => money(Math.round(v * 100), { whole: true })}
              formatTime={epochMonthYear}
              formatTick={moneyTick}
              references={
                budget?.budgetCents != null
                  ? [{ value: budget.budgetCents / 100, label: "Budget" }]
                  : []
              }
              className="h-56"
            />
          </SectionCard>
          <PageGrid layout="wide">
            <SectionCard title="Merchants" flush>
              {d.merchants.length ? (
                <ul className="flex flex-col divide-y divide-border/70">
                  {d.merchants.map((m) => (
                    <li key={m.key}>
                      <Link
                        to="/reports/merchants/$key"
                        params={{ key: m.key }}
                        disabled={m.key === "unknown"}
                        className="flex min-h-12 flex-col justify-center gap-1.5 px-5 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted"
                      >
                        <span className="flex justify-between gap-3 text-sm">
                          <span className="truncate font-medium">{m.name}</span>
                          <span className="shrink-0 tabular-nums">
                            {money(m.cents, { whole: true })}
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Meter
                            label={`${m.name} share`}
                            value={m.cents / maxMerchant}
                          />
                          <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                            {pluralize(m.count, "visit")}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted-foreground">
                  No merchants in the last 12 months.
                </p>
              )}
            </SectionCard>
            {d.children.length ? (
              <SectionCard title="Includes" flush>
                <ul className="flex flex-col divide-y divide-border/70">
                  {d.children.map((c) => (
                    <li key={c.code}>
                      <Link
                        to="/reports/categories/$code"
                        params={{ code: c.code }}
                        className="flex min-h-11 items-center justify-between gap-3 px-5 py-2 text-sm outline-none hover:bg-muted/60 focus-visible:bg-muted"
                      >
                        <span className="truncate">{c.label}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {money(c.cents, { whole: true })} in 12 months
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            ) : null}
          </PageGrid>
        </>
      )}
    </Page>
  )
}
