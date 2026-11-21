import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zsrobinson/shell/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
} from "lucide-react"
import { z } from "zod"
import { useIsMobile } from "@zsrobinson/shell/hooks/use-mobile"
import {
  InfoTip,
  Loading,
  Meter,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  addMonths,
  epochMonthYear,
  moneyTick,
  money,
  monthEpoch,
  monthName,
  percent,
} from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { budgetsQuery } from "@/lib/queries"
import { getJson } from "@/lib/api"
import type { BudgetRow } from "@/lib/types"

export const Route = createFileRoute("/budgets")({
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  }),
  staticData: { crumbs: [{ label: "Budgets", to: "/budgets" }] },
  component: Budgets,
})

const whole = (d: number) => money(Math.round(d * 100), { whole: true })

function Budgets() {
  usePageTitle("Budgets")
  const s = Route.useSearch()
  const navigate = useNavigate({ from: "/budgets" })
  const q = useQuery(budgetsQuery(s.month))
  const history = useQuery({
    queryKey: ["money", "budgets", "history"],
    queryFn: ({ signal }) =>
      getJson<{
        months: { month: string; budgetCents: number; spentCents: number }[]
      }>("/api/budgets/history?months=12", signal),
  })
  const d = q.data
  const mobile = useIsMobile()
  const month = d?.month ?? s.month
  const copy = useSend<void, { copied: number }>(
    "POST",
    `/api/budgets/${month}/copy-previous`,
    {
      success: (r) =>
        r.copied
          ? `Copied ${r.copied} amounts from last month`
          : "Last month had no amounts of its own",
    }
  )
  const go = (by: number) =>
    d &&
    void navigate({ search: { month: addMonths(d.month, by) }, replace: true })
  // Top-level categories, each followed by the categories inside it.
  const rows = d?.rows ?? []
  const tree = (top: BudgetRow[]) =>
    top.flatMap((r) => [r, ...rows.filter((x) => x.parent === r.code)])
  const tops = rows.filter((r) => !r.parent)
  const budgeted = tree(tops.filter((r) => r.totalBudgetCents != null))
  const other = tree(
    tops
      .filter((r) => r.totalBudgetCents == null)
      .sort((a, b) => b.spentCents - a.spentCents)
  )
  const totals = d?.totals ?? {
    budgetedCents: 0,
    spentCents: 0,
    unbudgetedCents: 0,
  }
  const left = totals.budgetedCents - totals.spentCents
  return (
    <Page>
      <PageHeader>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => go(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <PageTitle className="min-w-44 text-center">
            {d ? monthName(d.month) : "Budgets"}
          </PageTitle>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Next month"
            onClick={() => go(1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <PageActions>
          {d && d.month !== d.current ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigate({ search: {}, replace: true })}
            >
              This month
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={copy.isPending}
            onClick={() => copy.mutate()}
          >
            <CopyIcon data-icon="inline-start" />
            Copy last month
          </Button>
        </PageActions>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="Budgets failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={10} />
      ) : (
        <PageStack>
          <StatRow>
            <Stat label="Budgeted">
              {money(totals.budgetedCents, { whole: true })}
            </Stat>
            <Stat
              label="Spent"
              detail={
                d.elapsed > 0 && d.elapsed < 1
                  ? `${percent(d.elapsed)} of the month gone`
                  : undefined
              }
            >
              {money(totals.spentCents, { whole: true })}
            </Stat>
            <Stat label={left >= 0 ? "Left" : "Over"}>
              <span className={left < 0 ? "text-negative" : ""}>
                {money(Math.abs(left), { whole: true })}
              </span>
            </Stat>
            <Stat
              label="Income"
              detail={
                totals.unbudgetedCents
                  ? `${money(totals.unbudgetedCents, { whole: true })} spent outside budgets`
                  : undefined
              }
            >
              {money(d.incomeCents, { whole: true })}
            </Stat>
          </StatRow>
          <Card className="gap-0 py-0">
            <div className="flex items-center gap-1 border-b px-5 py-3">
              <span className="font-heading text-base font-medium">
                Budgets
              </span>
              <InfoTip label="About budgets">
                A category’s budget and spending include the categories inside
                it. Amounts change this month only; use a row’s menu to set a
                default for every month.
              </InfoTip>
            </div>
            <BudgetHeader />
            {budgeted.length ? (
              <ul className="flex flex-col divide-y divide-border/70">
                {budgeted.map((r) => (
                  <BudgetLine
                    key={`${d.month}-${r.code}-${r.budgetCents}`}
                    row={r}
                    month={d.month}
                    elapsed={d.elapsed}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                No budgets yet. Add an amount to any category below.
              </p>
            )}
          </Card>
          {other.length ? (
            <Card className="gap-0 py-0">
              <div className="border-b px-5 py-3 font-heading text-base font-medium">
                Not budgeted
              </div>
              <BudgetHeader />
              <ul className="flex flex-col divide-y divide-border/70">
                {other.map((r) => (
                  <BudgetLine
                    key={`${d.month}-${r.code}-${r.budgetCents}`}
                    row={r}
                    month={d.month}
                    elapsed={d.elapsed}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
          {history.data ? (
            <SectionCard title="Budget against spending">
              <TrendChart
                kind="bar"
                label="Total budget and spending in budgeted categories by month"
                data={history.data.months.slice(mobile ? -6 : 0).map((m) => ({
                  time: monthEpoch(m.month),
                  budget: m.budgetCents / 100,
                  spent: m.spentCents / 100,
                }))}
                config={{
                  budget: { label: "Budget", color: "var(--chart-neutral)" },
                  spent: { label: "Spent", color: "var(--chart-1)" },
                }}
                format={whole}
                formatTick={moneyTick}
                formatTime={epochMonthYear}
                className="h-56"
              />
            </SectionCard>
          ) : null}
        </PageStack>
      )}
    </Page>
  )
}

// Category, progress, spent, budget, menu; a phone moves progress below.
const GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_6.5rem_2rem] items-center gap-x-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_7rem_7.5rem_2rem]"

function BudgetHeader() {
  return (
    <div
      className={`${GRID} border-b px-5 py-1.5 text-xs text-muted-foreground`}
    >
      <span>Category</span>
      <span className="hidden sm:block">Progress</span>
      <span className="text-right">Spent</span>
      <span className="text-right">Budget</span>
      <span />
    </div>
  )
}

function BudgetLine({
  row: r,
  month,
  elapsed,
}: {
  row: BudgetRow
  month: string
  elapsed: number
}) {
  const [value, setValue] = useState(
    r.budgetCents == null
      ? ""
      : Math.round(r.budgetCents / 100).toLocaleString()
  )
  const put = useSend<{ amountCents: number | null; asDefault?: boolean }>(
    "PUT",
    `/api/budgets/${month}/${r.code}`,
    {
      success: (_, v) =>
        v.asDefault ? `${r.label} default saved` : `${r.label} budget saved`,
    }
  )
  const rollover = useSend<{ enabled: boolean }>(
    "PUT",
    `/api/budgets/rollover/${r.code}`,
    {
      body: (v) => ({ enabled: v.enabled, since: month }),
      success: (_, v) =>
        v.enabled ? "Leftover now rolls over" : "Rollover turned off",
    }
  )
  const budgeted = r.totalBudgetCents != null
  const available = (r.totalBudgetCents ?? 0) + r.rolloverCents
  const ratio =
    available > 0 ? r.spentCents / available : r.spentCents > 0 ? 1 : 0
  const over = budgeted && r.spentCents > available
  // A parent's own amount plus its children's, said when they differ.
  const ofTotal =
    budgeted && r.totalBudgetCents !== r.budgetCents
      ? money(available, { whole: true })
      : null
  const ahead =
    budgeted && !over && elapsed > 0 && elapsed < 1 && ratio > elapsed + 0.1
  const commit = () => {
    const cents =
      value.trim() === ""
        ? null
        : Math.round(Number(value.replace(/[^0-9.]/g, "")) * 100)
    if (cents === r.budgetCents || (cents != null && Number.isNaN(cents)))
      return
    put.mutate({ amountCents: cents })
  }
  return (
    <li className={`${GRID} gap-y-1.5 px-5 py-2.5`}>
      <Link
        to="/reports/categories/$code"
        params={{ code: r.code }}
        className={`line-clamp-2 min-w-0 text-sm break-words underline-offset-4 hover:underline ${r.parent ? "pl-4 text-muted-foreground" : "font-medium"}`}
      >
        {r.label}
      </Link>
      <div
        className={`col-span-4 row-start-2 flex flex-col gap-1 sm:col-span-1 sm:row-start-auto ${r.parent ? "pl-4 sm:pl-0" : ""}`}
      >
        {budgeted ? (
          <Meter
            label={`${r.label} budget used`}
            value={ratio}
            tone={over ? "over" : "default"}
          />
        ) : null}
        <span className="text-xs text-muted-foreground">
          {!budgeted ? (
            `${money(r.averageCents, { whole: true })} average`
          ) : over ? (
            <span className="text-negative">
              {money(r.spentCents - available, { whole: true })} over
              {ofTotal ? ` ${ofTotal}` : ""}
            </span>
          ) : (
            `${money(available - r.spentCents, { whole: true })} left${ofTotal ? ` of ${ofTotal}` : ""}${ahead ? " · ahead of pace" : ""}`
          )}
          {r.rolloverCents
            ? ` · ${money(r.rolloverCents, { sign: true, whole: true })} rolled over`
            : ""}
        </span>
      </div>
      <span className="text-right text-sm tabular-nums">
        {money(r.spentCents, { whole: true })}
      </span>
      <InputGroup className="h-8">
        <InputGroupAddon>$</InputGroupAddon>
        <InputGroupInput
          aria-label={`${r.label} budget for ${monthName(month)}`}
          inputMode="decimal"
          placeholder="—"
          className="text-right tabular-nums"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </InputGroup>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${r.label} budget options`}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem
            disabled={r.budgetCents == null}
            onClick={() =>
              put.mutate({ amountCents: r.budgetCents, asDefault: true })
            }
          >
            Use {money(r.budgetCents, { whole: true })} every month
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => put.mutate({ amountCents: r.averageCents || null })}
            disabled={!r.averageCents}
          >
            Set to 3-month average ({money(r.averageCents, { whole: true })})
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={r.budgetCents == null}
            onClick={() => rollover.mutate({ enabled: !r.rollover })}
          >
            {r.rollover
              ? "Stop rolling over leftover"
              : "Roll leftover into next month"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={r.source !== "month"}
            onClick={() => put.mutate({ amountCents: null })}
          >
            Clear this month’s amount
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={r.defaultCents == null}
            onClick={() => put.mutate({ amountCents: null, asDefault: true })}
          >
            Remove budget
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
