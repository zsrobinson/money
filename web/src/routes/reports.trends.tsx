import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Page, PageActions, PageHeader, PageTitle } from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
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
import { Amount, Loading, RangeSelect, SectionCard } from "@/components/money"
import { ReportNav } from "@/components/report-nav"
import { usePageTitle } from "@/lib/crumb"
import {
  epochMonthYear,
  money,
  moneyTick,
  monthEpoch,
  monthShortYear,
  percent,
} from "@/lib/format"
import { trendsQuery } from "@/lib/queries"
import type { Range } from "@/lib/types"

export const Route = createFileRoute("/reports/trends")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: { crumbs: [{ label: "Reports", to: "/reports" }] },
  component: Trends,
})

const whole = (d: number) => money(Math.round(d * 100), { whole: true })

function Trends() {
  usePageTitle("Trends")
  const { range = "6m" } = Route.useSearch()
  const navigate = useNavigate({ from: "/reports/trends" })
  const q = useQuery(trendsQuery(range))
  const d = q.data
  const n = (row: Record<string, number | string>, key: string) =>
    Number(row[key] ?? 0)
  const rows = d?.rows ?? []
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
          title="Trends failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={8} />
      ) : (
        <>
          <SectionCard title="Spending by category">
            <TrendChart
              kind="bar"
              stacked
              label="Monthly spending stacked by the four largest categories"
              data={rows.map((r) => ({
                time: monthEpoch(String(r.month)),
                ...Object.fromEntries([
                  ...d.categories.map((c) => [c.code, n(r, c.code) / 100]),
                  ["other", n(r, "other") / 100],
                ]),
              }))}
              config={{
                ...Object.fromEntries(
                  d.categories.map((c, i) => [
                    c.code,
                    { label: c.label, color: `var(--chart-${i + 1})` },
                  ])
                ),
                other: {
                  label: "Everything else",
                  color: "var(--chart-neutral)",
                },
              }}
              format={whole}
              formatTick={moneyTick}
              formatTime={epochMonthYear}
              className="h-72"
            />
          </SectionCard>
          <SectionCard title="Income against spending">
            <TrendChart
              curve="linear"
              label="Monthly income and spending"
              data={rows.map((r) => ({
                time: monthEpoch(String(r.month)),
                income: n(r, "incomeCents") / 100,
                spending: n(r, "spendingCents") / 100,
              }))}
              config={{
                income: { label: "Income", color: "var(--chart-positive)" },
                spending: { label: "Spending", color: "var(--chart-negative)" },
              }}
              format={whole}
              formatTick={moneyTick}
              formatTime={epochMonthYear}
              className="h-56"
            />
          </SectionCard>
          <Card className="gap-0 overflow-x-auto py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Month</TableHead>
                  {d.categories.map((c) => (
                    <TableHead
                      key={c.code}
                      className="hidden text-right lg:table-cell"
                    >
                      {c.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Income</TableHead>
                  <TableHead className="text-right">Spending</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    Saved
                  </TableHead>
                  <TableHead className="pr-5 text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.toReversed().map((r) => (
                  <TableRow key={String(r.month)}>
                    <TableCell className="pl-5 whitespace-nowrap">
                      {monthShortYear(String(r.month))}
                    </TableCell>
                    {d.categories.map((c) => (
                      <TableCell
                        key={c.code}
                        className="hidden text-right text-muted-foreground tabular-nums lg:table-cell"
                      >
                        {money(n(r, c.code), { whole: true })}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">
                      {money(n(r, "incomeCents"), { whole: true })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(n(r, "spendingCents"), { whole: true })}
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Amount cents={n(r, "netCents")} tone="signed" whole />
                    </TableCell>
                    <TableCell className="pr-5 text-right text-muted-foreground tabular-nums">
                      {n(r, "incomeCents") ? percent(n(r, "savingsRate")) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </Page>
  )
}
