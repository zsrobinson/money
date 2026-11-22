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
import { categoryColor, useCategories } from "@/components/category-style"
import { usePageTitle } from "@/lib/crumb"
import {
  epochMonthYear,
  money,
  moneyTick,
  monthEpoch,
  pluralize,
  percent,
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
  const cats = useCategories()
  const { code } = Route.useParams()
  const q = useQuery(categoryDetailQuery(code))
  const budgets = useQuery(budgetsQuery())
  usePageTitle(q.data?.category.label, true)
  const d = q.data
  const income = d?.category.group === "income"
  const budget = budgets.data?.expenses.find((r) => r.code === code)
  const thisMonth = d?.monthly.at(-1)?.cents ?? 0
  const parent = budgets.data?.expenses.find(
    (r) => r.code === d?.category.parent
  )
  const maxMerchant = Math.max(1, ...(d?.merchants.map((m) => m.cents) ?? [1]))
  const chart = d ? (
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
        budget?.totalBudgetCents != null
          ? [
              {
                value: budget.totalBudgetCents / 100,
                label: "Budget",
                side: "axis",
              },
            ]
          : []
      }
      className="h-56"
    />
  ) : null
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle>{d?.category.label ?? "Category"}</PageTitle>
          {d?.category.parent ? (
            <PageMeta>
              <Link
                to="/reports/categories/$code"
                params={{ code: d.category.parent }}
                className="underline-offset-4 hover:underline"
              >
                In {parent?.label ?? "its parent"}
              </Link>
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
              info={
                d.children.length
                  ? "Includes the categories inside it."
                  : undefined
              }
            >
              {money(thisMonth, { whole: true })}
            </Stat>
            <Stat label="Monthly average" info="Over the last 11 full months.">
              {money(d.averageCents, { whole: true })}
            </Stat>
            <Stat label="Last 12 months">
              {money(d.totalCents, { whole: true })}
            </Stat>
            {budget?.totalBudgetCents != null ? (
              <Stat
                label="Budget this month"
                detail={`${money(budget.spentCents, { whole: true })} spent`}
              >
                {money(budget.totalBudgetCents + budget.rolloverCents, {
                  whole: true,
                })}
              </Stat>
            ) : null}
          </StatRow>
          {d.children.length ? (
            <PageGrid layout="wide" className="items-stretch">
              <SectionCard title="By month">{chart}</SectionCard>
              <SectionCard title="Includes" fill>
                {/* The last 12 months split between the categories inside it and the rest, as bars. */}
                <Includes
                  rows={[
                    ...d.children.map((c) => ({
                      code: c.code,
                      label: c.label,
                      cents: c.cents,
                      color: cats.get(c.code)?.color ?? null,
                    })),
                    {
                      code: null,
                      label: "Everything else",
                      cents:
                        d.totalCents -
                        d.children.reduce((sum, c) => sum + c.cents, 0),
                      color: null,
                    },
                  ]}
                  total={d.totalCents}
                />
              </SectionCard>
            </PageGrid>
          ) : (
            <SectionCard title="By month">{chart}</SectionCard>
          )}
          <SectionCard title="Merchants" flush>
            {d.merchants.length ? (
              <ul className="@container grid divide-y divide-border/70">
                {d.merchants.map((m) => (
                  <li key={m.key}>
                    <Link
                      to="/reports/merchants/$key"
                      params={{ key: m.key }}
                      disabled={m.key === "unknown"}
                      className="grid min-h-12 items-center gap-x-4 gap-y-1.5 px-5 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted @2xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_6rem_6rem]"
                    >
                      <span className="flex justify-between gap-3 text-sm @2xl:contents">
                        <span className="truncate font-medium">{m.name}</span>
                        <span className="shrink-0 tabular-nums @2xl:order-last @2xl:text-right">
                          {money(m.cents, { whole: true })}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 @2xl:contents">
                        <Meter
                          label={`${m.name} share`}
                          value={m.cents / maxMerchant}
                        />
                        <span className="w-24 shrink-0 text-right text-xs text-muted-foreground @2xl:w-auto">
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
        </>
      )}
    </Page>
  )
}

/** Each category inside this one, and the rest, with its share of the total. */
function Includes({
  rows,
  total,
}: {
  rows: {
    code: string | null
    label: string
    cents: number
    color: string | null
  }[]
  total: number
}) {
  const sorted = rows
    .filter((r) => r.cents !== 0)
    .sort((a, b) => b.cents - a.cents)
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((r) => {
        const body = (
          <>
            <span className="flex justify-between gap-3 text-sm">
              <span className="truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums">
                {money(r.cents, { whole: true })}
                <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">
                  {total > 0 ? percent(r.cents / total) : ""}
                </span>
              </span>
            </span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${total > 0 ? Math.max(0, r.cents / total) * 100 : 0}%`,
                  backgroundColor: categoryColor(r.color),
                }}
              />
            </div>
          </>
        )
        return (
          <li key={r.code ?? "rest"}>
            {r.code ? (
              <Link
                to="/reports/categories/$code"
                params={{ code: r.code }}
                className="flex flex-col gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {body}
              </Link>
            ) : (
              <div className="flex flex-col gap-1.5">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
