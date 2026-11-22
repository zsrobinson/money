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
  moneyTick,
  money,
  monthEpoch,
  monthName,
  monthShortYear,
  percent,
} from "@/lib/format"
import { cashflowQuery } from "@/lib/queries"
import type { CashFlowPeriod, CashFlowRow, MonthFlow } from "@/lib/types"

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
  const kind = s.period ?? "month"
  // Quarters show two years; years show three.
  const months =
    kind === "quarter" ? 24 : kind === "year" ? 36 : (s.months ?? 12)
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
  const rows = d ? periodRows(d.months, kind) : []
  const full = rows.filter((r) => !r.partial)
  const avg = (key: "incomeCents" | "spendingCents") =>
    full.length
      ? Math.round(full.reduce((sum, f) => sum + f[key], 0) / full.length)
      : 0
  const unit = kind === "month" ? "month" : kind
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
              <Stat label="Saved">
                <Amount cents={d.netCents} tone="signed" whole />
              </Stat>
              <Stat label="Savings rate">
                {d.incomeCents > 0 ? percent(d.netCents / d.incomeCents) : "—"}
              </Stat>
            </StatRow>
          </Card>
          <SectionCard
            title={`Income and spending by ${unit}`}
            action={
              kind !== "month" ? undefined : (
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
              )
            }
            footer={
              <div className="flex w-full flex-wrap justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>
                  Avg income / {unit}{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {cents(avg("incomeCents"))}
                  </span>
                </span>
                <span>
                  Avg spending / {unit}{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {cents(avg("spendingCents"))}
                  </span>
                </span>
                <span>Full {unit}s only</span>
              </div>
            }
          >
            <TrendChart
              kind="bar"
              stacked
              label={`Income and spending by ${unit}`}
              data={rows.map((r) => ({
                time: r.time,
                income: r.incomeCents / 100,
                spending: -r.spendingCents / 100,
              }))}
              config={{
                income: { label: "Income", color: "var(--chart-positive)" },
                spending: { label: "Spending", color: "var(--chart-negative)" },
              }}
              format={whole}
              formatTick={moneyTick}
              formatTime={(t) => {
                const r = rows.find((x) => x.time === t)
                return r
                  ? `${r.label}${r.current ? " so far" : r.partial ? " (partial)" : ""}`
                  : ""
              }}
              formatTimeTick={(t) =>
                rows.find((x) => x.time === t)?.label ?? ""
              }
              markers={rows
                .filter((r) => r.current)
                .map((r) => ({ time: r.time, label: "So far" }))}
              // Click a period's bars to see it below.
              selected={rows.find((r) => r.key === p.key)?.time}
              onSelect={(t) => {
                const r = rows.find((x) => x.time === t)
                if (r) set({ key: r.key })
              }}
              className="h-64"
            />
          </SectionCard>
          <SankeyChartCard
            title={`Where income went`}
            label={`Income sources flowing to spending and savings, ${periodLabel(p)}`}
            // A phone keeps two columns, income to where it went, so the
            // chart fits without scrolling sideways.
            nodes={d.sankey.nodes
              .filter((n) => !mobile || !n.id.startsWith("in:"))
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
              (l) => !mobile || !l.source.startsWith("in:")
            )}
            formatValue={(v) => cents(v)}
            compact={mobile}
            footer={
              <span className="text-muted-foreground">
                {d.sankey.savedCents >= 0 ? (
                  <>
                    Saved{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {cents(d.sankey.savedCents)}
                    </span>
                    {d.incomeCents > 0
                      ? ` · ${percent(d.netCents / d.incomeCents)} of income`
                      : ""}
                  </>
                ) : (
                  <>
                    Spent{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {cents(-d.sankey.savedCents)}
                    </span>{" "}
                    more than came in
                  </>
                )}
              </span>
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-medium">
              By {by === "merchant" ? "merchant" : "category"}
            </h2>
            <Segmented
              label="Break down by"
              value={by}
              onChange={(v) => set({ by: v === "category" ? undefined : v })}
              options={[
                { value: "category", label: "Category" },
                { value: "merchant", label: "Merchant" },
              ]}
            />
          </div>
          <PageGrid layout="two">
            <Breakdown
              title="Spending"
              by={d.by}
              rows={d.spending}
              total={d.spendingCents}
            />
            <Breakdown
              title={d.incomeBy === "merchant" ? "Income by source" : "Income"}
              by={d.incomeBy}
              rows={d.income}
              total={d.incomeCents}
            />
          </PageGrid>
          <PeriodTable
            rows={rows}
            unit={unit}
            selected={p.key}
            onPick={(key) => set({ key })}
          />
        </PageStack>
      )}
    </Page>
  )
}

type PeriodRow = {
  key: string
  time: number
  label: string
  incomeCents: number
  spendingCents: number
  netCents: number
  /** Still in progress, or cut off by the start of the history. */
  partial: boolean
  /** Still in progress (the other partial kind starts before the history). */
  current: boolean
}

/** Months, or the quarters or years they make up, oldest first. */
function periodRows(months: MonthFlow[], kind: string): PeriodRow[] {
  const keyOf = (m: string) =>
    kind === "quarter"
      ? `${m.slice(0, 4)}-Q${Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1}`
      : kind === "year"
        ? m.slice(0, 4)
        : m
  const out = new Map<string, PeriodRow>()
  months.forEach((f, i) => {
    const key = keyOf(f.month)
    const r = out.get(key) ?? {
      key,
      time: monthEpoch(f.month),
      label:
        kind === "quarter"
          ? `${key.slice(5)} ’${key.slice(2, 4)}`
          : kind === "year"
            ? key
            : monthShortYear(f.month),
      incomeCents: 0,
      spendingCents: 0,
      netCents: 0,
      partial: false,
      current: false,
    }
    r.incomeCents += f.incomeCents
    r.spendingCents += f.spendingCents
    r.netCents += f.netCents
    // The last month is in progress, and so is the period holding it.
    if (i === months.length - 1) r.partial = r.current = true
    out.set(key, r)
  })
  // A period cut off at the start of the history is not a full one either.
  const first = [...out.values()][0]
  if (first && kind !== "month" && keyOf(months[0].month) === first.key) {
    const startsAt =
      kind === "year" ? `${first.key}-01` : months[0].month.slice(0, 7)
    if (kind === "year" && months[0].month !== startsAt) first.partial = true
    if (
      kind === "quarter" &&
      (Number(months[0].month.slice(5, 7)) - 1) % 3 !== 0
    )
      first.partial = true
  }
  return [...out.values()]
}

function PeriodTable({
  rows,
  unit,
  selected,
  onPick,
}: {
  rows: PeriodRow[]
  unit: string
  selected: string
  onPick: (key: string) => void
}) {
  return (
    <Card className="gap-0 overflow-x-auto py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">
              {unit.charAt(0).toUpperCase() + unit.slice(1)}
            </TableHead>
            <TableHead className="text-right">Income</TableHead>
            <TableHead className="text-right">Spending</TableHead>
            <TableHead className="pr-5 text-right">Saved</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.toReversed().map((r) => {
            const chosen = r.key === selected
            return (
              <TableRow
                key={r.key}
                data-state={chosen ? "selected" : undefined}
                className="cursor-pointer data-[state=selected]:font-medium data-[state=selected]:[&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]"
                onClick={() => onPick(r.key)}
              >
                <TableCell className="pl-5">
                  <button
                    type="button"
                    aria-pressed={chosen}
                    className="text-left underline-offset-4 outline-none hover:underline focus-visible:underline"
                  >
                    {r.label}
                    {r.partial ? (
                      <span className="text-muted-foreground">
                        {r.current ? " so far" : " (partial)"}
                      </span>
                    ) : null}
                  </button>
                </TableCell>
                <TableCell className="text-right">
                  <Amount cents={r.incomeCents} tone="plain" whole />
                </TableCell>
                <TableCell className="text-right">
                  <Amount cents={r.spendingCents} tone="plain" whole />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <Amount cents={r.netCents} tone="signed" whole />
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
  by,
  rows,
  total,
}: {
  title: string
  by: string
  rows: CashFlowRow[]
  total: number
}) {
  const tops = rows.filter((r) => !r.parent)
  const ordered = tops.flatMap((r) => [
    r,
    ...rows.filter((x) => x.parent === r.key),
  ])
  const shown = by === "merchant" ? ordered.slice(0, 12) : ordered
  const scale = Math.max(1, ...tops.map((r) => r.cents))
  return (
    <SectionCard
      title={title}
      action={
        <span className="text-sm font-medium tabular-nums">{cents(total)}</span>
      }
      footer={
        by === "merchant" && ordered.length > shown.length ? (
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
                  by === "merchant"
                    ? "/reports/merchants/$key"
                    : "/reports/categories/$code"
                }
                params={by === "merchant" ? { key: r.key } : { code: r.key }}
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
                        by === "merchant"
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
