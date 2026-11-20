import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
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
import {
  Amount,
  Loading,
  Meter,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  epochMonthYear,
  money,
  monthEpoch,
  monthName,
  monthShortYear,
  percent,
} from "@/lib/format"
import { cashflowQuery } from "@/lib/queries"

export const Route = createFileRoute("/cash-flow")({
  validateSearch: z.object({
    months: z.number().int().optional(),
    month: z.string().optional(),
  }),
  staticData: { crumbs: [{ label: "Cash flow", to: "/cash-flow" }] },
  component: CashFlow,
})

const whole = (d: number) => money(Math.round(d * 100), { whole: true })

function CashFlow() {
  usePageTitle("Cash flow")
  const s = Route.useSearch()
  const navigate = useNavigate({ from: "/cash-flow" })
  const months = s.months ?? 12
  const q = useQuery(cashflowQuery(months, s.month))
  const d = q.data
  const full = d ? d.months.slice(0, -1) : []
  const avg = (key: "incomeCents" | "spendingCents" | "netCents") =>
    full.length
      ? Math.round(full.reduce((sum, f) => sum + f[key], 0) / full.length)
      : 0
  const income = full.reduce((sum, f) => sum + f.incomeCents, 0)
  const saved = full.reduce((sum, f) => sum + f.netCents, 0)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Cash flow</PageTitle>
        <PageActions>
          <NativeSelect
            aria-label="Months shown"
            value={String(months)}
            onChange={(e) =>
              void navigate({
                search: (p) => ({ ...p, months: Number(e.target.value) }),
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
      {q.isError ? (
        <QueryError
          title="Cash flow failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={8} />
      ) : (
        <PageStack>
          <StatRow>
            <Stat label="Average income" detail="per full month">
              <Amount cents={avg("incomeCents")} tone="plain" whole />
            </Stat>
            <Stat label="Average spending" detail="per full month">
              <Amount cents={avg("spendingCents")} tone="plain" whole />
            </Stat>
            <Stat label="Average saved" detail="per full month">
              <Amount cents={avg("netCents")} tone="signed" whole />
            </Stat>
            <Stat label="Savings rate" detail="of income kept">
              {income > 0 ? percent(saved / income) : "—"}
            </Stat>
          </StatRow>
          <SectionCard title="Income and spending">
            <TrendChart
              kind="bar"
              stacked
              label="Income and spending by month"
              data={d.months.map((f) => ({
                time: monthEpoch(f.month),
                income: f.incomeCents / 100,
                spending: -f.spendingCents / 100,
              }))}
              config={{
                income: { label: "Income", color: "var(--chart-positive)" },
                spending: { label: "Spending", color: "var(--chart-negative)" },
              }}
              format={whole}
              formatTime={epochMonthYear}
              className="h-64"
            />
          </SectionCard>
          <PageGrid layout="wide">
            <Card className="gap-0 overflow-x-auto py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Month</TableHead>
                    <TableHead className="text-right">Income</TableHead>
                    <TableHead className="text-right">Spending</TableHead>
                    <TableHead className="pr-5 text-right">Saved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.months.toReversed().map((f) => (
                    <TableRow
                      key={f.month}
                      data-state={
                        f.month === d.selected ? "selected" : undefined
                      }
                      className="cursor-pointer"
                      onClick={() =>
                        void navigate({
                          search: (p) => ({ ...p, month: f.month }),
                          replace: true,
                          resetScroll: false,
                        })
                      }
                    >
                      <TableCell className="pl-5">
                        {/* The row handles the click; the button gives keyboard access. */}
                        <button
                          type="button"
                          aria-pressed={f.month === d.selected}
                          className="text-left outline-none focus-visible:underline"
                        >
                          {monthShortYear(f.month)}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount cents={f.incomeCents} tone="plain" whole />
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount cents={f.spendingCents} tone="plain" whole />
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Amount cents={f.netCents} tone="signed" whole />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <PageStack>
              <Breakdown
                title={`Spending in ${monthName(d.selected)}`}
                rows={d.spending}
              />
              <Breakdown
                title={`Income in ${monthName(d.selected)}`}
                rows={d.income}
              />
            </PageStack>
          </PageGrid>
        </PageStack>
      )}
    </Page>
  )
}

function Breakdown({
  title,
  rows,
}: {
  title: string
  rows: { code: string; label: string; cents: number; count: number }[]
}) {
  const total = rows.reduce((s, r) => s + Math.max(0, r.cents), 0)
  return (
    <SectionCard
      title={title}
      action={
        <span className="text-sm font-medium tabular-nums">
          {money(total, { whole: true })}
        </span>
      }
    >
      {rows.length ? (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.code}>
              <Link
                to="/reports/categories/$code"
                params={{ code: r.code }}
                className="flex flex-col gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex justify-between gap-3 text-sm">
                  <span className="truncate">{r.label}</span>
                  <span className="tabular-nums">
                    {money(r.cents, { whole: true })}
                  </span>
                </span>
                <Meter
                  label={`${r.label} share`}
                  value={total ? r.cents / total : 0}
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing this month.</p>
      )}
    </SectionCard>
  )
}
