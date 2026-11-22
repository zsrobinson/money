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
import { SankeyChartCard } from "@zsrobinson/shell/blocks/sankey-chart"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { useIsMobile } from "@zsrobinson/shell/hooks/use-mobile"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { z } from "zod"
import { categoryColor } from "@/components/category-style"
import { Choice } from "@/components/pickers"
import {
  Amount,
  Loading,
  SectionCard,
  Segmented,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  epochMonthYear,
  moneyTick,
  money,
  monthEpoch,
  monthName,
  monthShortYear,
  percent,
} from "@/lib/format"
import { cashflowQuery } from "@/lib/queries"
import type { CashFlow, CashFlowPeriod, CashFlowRow } from "@/lib/types"

export const Route = createFileRoute("/cash-flow")({
  validateSearch: z.object({
    months: z.number().int().optional(),
    period: z.enum(["month", "quarter", "year"]).optional().catch(undefined),
    /** YYYY-MM, YYYY-Qn or YYYY. */
    key: z.string().optional(),
    /** Old links chose a month this way. */
    month: z.string().optional(),
    by: z.enum(["category", "group", "merchant"]).optional().catch(undefined),
  }),
  staticData: { crumbs: [{ label: "Cash flow", to: "/cash-flow" }] },
  component: CashFlowPage,
})

const whole = (d: number) => money(Math.round(d * 100), { whole: true })
const cents = (c: number) => money(c, { whole: true })

export function periodLabel(p: Pick<CashFlowPeriod, "kind" | "key">) {
  if (p.kind === "month") return monthName(p.key)
  if (p.kind === "quarter") return `${p.key.slice(5)} ${p.key.slice(0, 4)}`
  return p.key
}

function CashFlowPage() {
  usePageTitle("Cash flow")
  const s = Route.useSearch()
  const navigate = useNavigate({ from: "/cash-flow" })
  const months = s.months ?? 12
  const kind = s.period ?? "month"
  const by = s.by ?? "category"
  const q = useQuery(
    cashflowQuery({
      months,
      period: kind,
      key: s.key ?? s.month,
      by,
    })
  )
  const d = q.data
  const set = (patch: Partial<typeof s>) =>
    void navigate({
      search: (p) => ({ ...p, month: undefined, ...patch }),
      replace: true,
      resetScroll: false,
    })
  const full = d ? d.months.slice(0, -1) : []
  const avg = (key: "incomeCents" | "spendingCents") =>
    full.length
      ? Math.round(full.reduce((sum, f) => sum + f[key], 0) / full.length)
      : 0
  const current = d?.months.at(-1)?.month ?? ""
  const p = d?.period
  const mobile = useIsMobile()
  return (
    <Page>
      <PageHeader>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Previous period"
            disabled={!p?.previous}
            onClick={() => p?.previous && set({ key: p.previous })}
          >
            <ChevronLeftIcon />
          </Button>
          <PageTitle className="min-w-36 text-center sm:min-w-44">
            {p ? periodLabel(p) : "Cash flow"}
          </PageTitle>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Next period"
            disabled={!p?.next}
            onClick={() => p?.next && set({ key: p.next })}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <PageActions>
          <Segmented
            label="Period"
            value={kind}
            onChange={(v) =>
              set({ period: v === "month" ? undefined : v, key: undefined })
            }
            options={[
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
          />
        </PageActions>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="Cash flow failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d || !p ? (
        <Loading rows={8} />
      ) : (
        <PageStack>
          <Card className="px-5 py-4">
            <StatRow>
              <Stat label="Income">
                <Amount cents={d.incomeCents} tone="plain" whole />
              </Stat>
              <Stat label="Spending">
                <Amount cents={d.spendingCents} tone="plain" whole />
              </Stat>
              <Stat label={d.netCents >= 0 ? "Saved" : "Overspent"}>
                <Amount cents={Math.abs(d.netCents)} tone="plain" whole />
              </Stat>
              <Stat label="Savings rate">
                {d.incomeCents > 0 ? percent(d.netCents / d.incomeCents) : "—"}
              </Stat>
            </StatRow>
          </Card>
          <SectionCard
            title="Income and spending by month"
            action={
              <Choice
                aria-label="Months shown"
                size="sm"
                align="end"
                className="w-36"
                value={String(months)}
                onChange={(v) => set({ months: Number(v) })}
                options={[
                  { value: "6", label: "6 months" },
                  { value: "12", label: "12 months" },
                  { value: "24", label: "24 months" },
                ]}
              />
            }
            footer={
              <div className="flex w-full flex-wrap justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>
                  Avg income / month{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {cents(avg("incomeCents"))}
                  </span>
                </span>
                <span>
                  Avg spending / month{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {cents(avg("spendingCents"))}
                  </span>
                </span>
                <span>Full months only</span>
              </div>
            }
          >
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
              formatTick={moneyTick}
              formatTime={(t) =>
                t === monthEpoch(current)
                  ? `${epochMonthYear(t)} so far`
                  : epochMonthYear(t)
              }
              formatTimeTick={epochMonthYear}
              markers={[{ time: monthEpoch(current), label: "So far" }]}
              // Click a month's bars to see it below.
              selected={p.kind === "month" ? monthEpoch(p.key) : undefined}
              onSelect={(t) =>
                set({
                  period: undefined,
                  key: new Date(t).toISOString().slice(0, 7),
                })
              }
              className="h-64"
            />
          </SectionCard>
          <SankeyChartCard
            title={`Where income went`}
            label={`Income sources flowing to spending and savings, ${periodLabel(p)}`}
            // A phone keeps two columns, income to where it went, so the
            // chart fits without scrolling sideways.
            nodes={d.sankey.nodes
              .filter((n) => !mobile || !/^(in|back):/.test(n.id))
              .map((n) => ({
                id: n.id,
                label: n.label,
                color:
                  n.color === "positive"
                    ? "var(--chart-positive)"
                    : n.color
                      ? categoryColor(n.color)
                      : undefined,
              }))}
            links={d.sankey.links.filter(
              (l) => !mobile || !/^(in|back):/.test(l.source)
            )}
            formatValue={(v) => cents(v)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-medium">
              By {by === "group" ? "group" : by}
            </h2>
            <Segmented
              label="Break down by"
              value={by}
              onChange={(v) => set({ by: v === "category" ? undefined : v })}
              options={[
                { value: "category", label: "Category" },
                { value: "group", label: "Group" },
                { value: "merchant", label: "Merchant" },
              ]}
            />
          </div>
          <PageGrid layout="two">
            <Breakdown
              title="Spending"
              d={d}
              rows={d.spending}
              total={d.spendingCents}
            />
            <Breakdown
              title="Income"
              d={d}
              rows={d.income}
              total={d.incomeCents}
            />
          </PageGrid>
          <MonthTable
            d={d}
            onPick={(month) => set({ period: undefined, key: month })}
          />
        </PageStack>
      )}
    </Page>
  )
}

function MonthTable({
  d,
  onPick,
}: {
  d: CashFlow
  onPick: (month: string) => void
}) {
  return (
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
          {d.months.toReversed().map((f) => {
            const chosen = d.period.kind === "month" && f.month === d.period.key
            return (
              <TableRow
                key={f.month}
                data-state={chosen ? "selected" : undefined}
                className="cursor-pointer data-[state=selected]:font-medium data-[state=selected]:[&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]"
                onClick={() => onPick(f.month)}
              >
                <TableCell className="pl-5">
                  <button
                    type="button"
                    aria-pressed={chosen}
                    className="text-left underline-offset-4 outline-none hover:underline focus-visible:underline"
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
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

/** Shares of the period: parents include the categories inside them, which sit indented below. */
function Breakdown({
  title,
  d,
  rows,
  total,
}: {
  title: string
  d: CashFlow
  rows: CashFlowRow[]
  total: number
}) {
  const tops = rows.filter((r) => !r.parent)
  const ordered = tops.flatMap((r) => [
    r,
    ...rows.filter((x) => x.parent === r.key),
  ])
  const shown = d.by === "merchant" ? ordered.slice(0, 12) : ordered
  const scale = Math.max(1, ...tops.map((r) => r.cents))
  return (
    <SectionCard
      title={title}
      action={
        <span className="text-sm font-medium tabular-nums">{cents(total)}</span>
      }
      footer={
        d.by === "merchant" && ordered.length > shown.length ? (
          <span className="mr-auto text-sm text-muted-foreground">
            And {ordered.length - shown.length} more
          </span>
        ) : undefined
      }
    >
      {shown.length ? (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => (
            <li key={r.key} className={r.parent ? "pl-4" : undefined}>
              <Link
                to={
                  d.by === "merchant"
                    ? "/reports/merchants/$key"
                    : "/reports/categories/$code"
                }
                params={d.by === "merchant" ? { key: r.key } : { code: r.key }}
                className="flex flex-col gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex justify-between gap-3 text-sm">
                  <span
                    className={`truncate ${r.parent ? "text-muted-foreground" : ""}`}
                  >
                    {r.label}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {cents(r.cents)}
                    <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">
                      {total > 0 && r.cents > 0 ? percent(r.cents / total) : ""}
                    </span>
                  </span>
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(Math.max(0, r.cents) / scale) * 100}%`,
                      backgroundColor:
                        d.by === "merchant"
                          ? "var(--chart-1)"
                          : categoryColor(r.color),
                      opacity: r.parent ? 0.7 : 1,
                    }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing in this period.</p>
      )}
    </SectionCard>
  )
}
