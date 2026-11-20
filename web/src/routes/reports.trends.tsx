import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Page, PageActions, PageHeader, PageTitle } from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  NativeSelect,
  NativeSelectOption,
} from "@zsrobinson/shell/ui/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { z } from "zod"
import { Amount, Loading, SectionCard } from "@/components/money"
import { ReportNav } from "@/components/report-nav"
import { usePageTitle } from "@/lib/crumb"
import {
  epochMonthYear,
  money,
  monthEpoch,
  monthShortYear,
  percent,
} from "@/lib/format"
import { trendsQuery } from "@/lib/queries"

export const Route = createFileRoute("/reports/trends")({
  validateSearch: z.object({ months: z.number().int().optional() }),
  staticData: {
    crumbs: [
      { label: "Reports", to: "/reports" },
      { label: "Trends", to: "/reports/trends" },
    ],
  },
  component: Trends,
})

const whole = (d: number) => money(Math.round(d * 100), { whole: true })

function Trends() {
  usePageTitle("Trends")
  const { months = 12 } = Route.useSearch()
  const navigate = useNavigate({ from: "/reports/trends" })
  const q = useQuery(trendsQuery(months))
  const d = q.data
  const n = (row: Record<string, number | string>, key: string) =>
    Number(row[key] ?? 0)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Reports</PageTitle>
        <PageActions>
          <NativeSelect
            aria-label="Months shown"
            value={String(months)}
            onChange={(e) =>
              void navigate({
                search: { months: Number(e.target.value) },
                replace: true,
              })
            }
          >
            <NativeSelectOption value="6">Last 6 months</NativeSelectOption>
            <NativeSelectOption value="12">Last 12 months</NativeSelectOption>
            <NativeSelectOption value="24">Last 24 months</NativeSelectOption>
          </NativeSelect>
        </PageActions>
      </PageHeader>
      <ReportNav />
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
              data={d.rows.map((r) => ({
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
              formatTime={epochMonthYear}
              className="h-72"
            />
          </SectionCard>
          <SectionCard title="Income against spending">
            <TrendChart
              label="Monthly income and spending"
              data={d.rows.map((r) => ({
                time: monthEpoch(String(r.month)),
                income: n(r, "incomeCents") / 100,
                spending: n(r, "spendingCents") / 100,
              }))}
              config={{
                income: { label: "Income", color: "var(--chart-positive)" },
                spending: { label: "Spending", color: "var(--chart-negative)" },
              }}
              format={whole}
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
                  <TableHead className="text-right">Spending</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                  <TableHead className="pr-5 text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.rows.toReversed().map((r) => (
                  <TableRow key={String(r.month)}>
                    <TableCell className="pl-5">
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
                      {money(n(r, "spendingCents"), { whole: true })}
                    </TableCell>
                    <TableCell className="text-right">
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
