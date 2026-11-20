import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageTitle,
} from "@zsrobinson/shell"
import { DonutChart, TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { z } from "zod"
import {
  Loading,
  RangeSelect,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { ReportNav } from "@/components/report-nav"
import { usePageTitle } from "@/lib/crumb"
import {
  epochMonthYear,
  money,
  moneyTick,
  monthEpoch,
  percent,
  shortDate,
} from "@/lib/format"
import { categoryReportQuery } from "@/lib/queries"
import type { Range } from "@/lib/types"

export const Route = createFileRoute("/reports/")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: {
    crumbs: [
      { label: "Reports", to: "/reports" },
      { label: "Categories", to: "/reports" },
    ],
  },
  component: CategoryReport,
})

function CategoryReport() {
  usePageTitle("Spending by category")
  const { range = "6m" } = Route.useSearch()
  const navigate = useNavigate({ from: "/reports/" })
  const q = useQuery(categoryReportQuery(range))
  const d = q.data
  // Parents include the categories you created inside them.
  const rows = (d?.rows ?? []).map((r) => {
    const kids = r.parent
      ? []
      : (d?.rows ?? []).filter((x) => x.parent === r.code)
    return {
      ...r,
      cents: r.cents + kids.reduce((s, k) => s + k.cents, 0),
      previousCents:
        r.previousCents + kids.reduce((s, k) => s + k.previousCents, 0),
      count: r.count + kids.reduce((s, k) => s + k.count, 0),
    }
  })
  const top = rows.filter((r) => !r.parent).sort((a, b) => b.cents - a.cents)
  const ordered = top.flatMap((r) => [
    r,
    ...rows.filter((x) => x.parent === r.code),
  ])
  return (
    <Page>
      <PageHeader>
        <PageTitle>Reports</PageTitle>
        <PageActions>
          <RangeSelect
            value={range}
            onChange={(r: Range) =>
              void navigate({ search: { range: r }, replace: true })
            }
          />
        </PageActions>
      </PageHeader>
      <ReportNav range={range} />
      {q.isError ? (
        <QueryError
          title="The report failed to load"
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
              label="Spent"
              detail={`${shortDate(d.from, d.to)} – ${shortDate(d.to)}`}
            >
              {money(d.totalCents, { whole: true })}
            </Stat>
            <Stat label="Categories">{top.length}</Stat>
            <Stat label="Largest">{top[0]?.label ?? "—"}</Stat>
          </StatRow>
          <PageGrid layout="wide">
            <SectionCard title="Share of spending">
              <DonutChart
                label="Share of spending by category"
                totalLabel="spent"
                format={(v) => money(v, { whole: true })}
                data={top.map((r) => ({
                  key: r.code,
                  label: r.label,
                  value: r.cents,
                }))}
                onSelect={(code) =>
                  void navigate({
                    to: "/reports/categories/$code",
                    params: { code },
                  })
                }
              />
            </SectionCard>
            <SectionCard title="Top categories by month">
              <TrendChart
                kind="bar"
                stacked
                label="Monthly spending in the three largest categories"
                data={d.months.map((month, i) => ({
                  time: monthEpoch(month),
                  ...Object.fromEntries(
                    top
                      .slice(0, 3)
                      .map((r) => [r.code, (r.monthly[i] ?? 0) / 100])
                  ),
                }))}
                config={Object.fromEntries(
                  top
                    .slice(0, 3)
                    .map((r, i) => [
                      r.code,
                      { label: r.label, color: `var(--chart-${i + 1})` },
                    ])
                )}
                format={(v) => money(Math.round(v * 100), { whole: true })}
                formatTime={epochMonthYear}
                formatTick={moneyTick}
                className="h-56"
              />
            </SectionCard>
          </PageGrid>
          <Card className="gap-0 overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Category</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Share
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Transactions
                  </TableHead>
                  <TableHead className="pr-5 text-right">
                    Previous period
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((r) => {
                  const change = r.previousCents
                    ? (r.cents - r.previousCents) / r.previousCents
                    : null
                  return (
                    <TableRow key={r.code}>
                      <TableCell
                        className={
                          r.parent ? "pl-9 text-muted-foreground" : "pl-5"
                        }
                      >
                        <Link
                          to="/reports/categories/$code"
                          params={{ code: r.code }}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {r.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(r.cents, { whole: true })}
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                        {d.totalCents ? percent(r.cents / d.totalCents) : "—"}
                      </TableCell>
                      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                        {r.count}
                      </TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">
                        {change == null ? (
                          <span className="text-muted-foreground">New</span>
                        ) : (
                          <span
                            className={
                              change > 0.05
                                ? "text-negative"
                                : change < -0.05
                                  ? "text-positive"
                                  : "text-muted-foreground"
                            }
                          >
                            {change > 0 ? "+" : ""}
                            {percent(change)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </Page>
  )
}
