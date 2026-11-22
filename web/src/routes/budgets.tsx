import { useState, type ReactNode } from "react"
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
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  GoalIcon,
} from "lucide-react"
import { z } from "zod"
import { useIsMobile } from "@zsrobinson/shell/hooks/use-mobile"
import { CategoryIcon } from "@/components/category-style"
import {
  BudgetBar,
  Loading,
  SectionCard,
  Segmented,
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
  monthShort,
} from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { budgetsQuery } from "@/lib/queries"
import { getJson } from "@/lib/api"
import type { BudgetKind, BudgetRow, Budgets, FlexiblePool } from "@/lib/types"

export const Route = createFileRoute("/budgets")({
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  }),
  staticData: { crumbs: [{ label: "Budgets", to: "/budgets" }] },
  component: BudgetsPage,
})

const whole = (cents: number | null | undefined) =>
  money(cents, { whole: true })
const dollars = (d: number) => money(Math.round(d * 100), { whole: true })

function BudgetsPage() {
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
          : "Already the same as last month",
    }
  )
  const mode = useSend<{ mode: "category" | "flex" }>(
    "PUT",
    "/api/budgets/mode",
    {
      success: (_, v) =>
        v.mode === "flex" ? "Flex budgeting on" : "Category budgets on",
    }
  )
  const go = (by: number) =>
    d &&
    void navigate({ search: { month: addMonths(d.month, by) }, replace: true })
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
          <PageTitle className="min-w-40 text-center sm:min-w-44">
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
          {d ? (
            <Segmented
              label="Budget style"
              value={d.mode}
              onChange={(v) => mode.mutate({ mode: v })}
              options={[
                { value: "category", label: "Categories" },
                {
                  value: "flex",
                  label: "Flex",
                  title: "Fixed, flexible and non-monthly spending",
                },
              ]}
            />
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={copy.isPending}
            onClick={() => copy.mutate()}
          >
            <CopyIcon data-icon="inline-start" />
            <span className="hidden sm:inline">Copy last month</span>
            <span className="sm:hidden">Copy</span>
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
          <Summary d={d} />
          <IncomeCard d={d} />
          {d.mode === "flex" ? <FlexCards d={d} /> : <CategoryCards d={d} />}
          <GoalsCard d={d} />
          {history.data ? (
            <SectionCard
              title="Budget and spending by month"
              footer={
                <span className="mr-auto text-sm text-muted-foreground">
                  Spent in budgets, last 12 months{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {whole(
                      history.data.months.reduce((t, m) => t + m.spentCents, 0)
                    )}
                  </span>{" "}
                  of{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {whole(
                      history.data.months.reduce((t, m) => t + m.budgetCents, 0)
                    )}
                  </span>
                </span>
              }
            >
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
                  spent: { label: "Spent in budgets", color: "var(--chart-1)" },
                }}
                format={dollars}
                formatTick={moneyTick}
                formatTime={(t) =>
                  t === monthEpoch(d.current)
                    ? `${epochMonthYear(t)} so far`
                    : epochMonthYear(t)
                }
                formatTimeTick={epochMonthYear}
                markers={[{ time: monthEpoch(d.current), label: "So far" }]}
                className="h-56"
              />
            </SectionCard>
          ) : null}
        </PageStack>
      )}
    </Page>
  )
}

/** Income, spending in budgets, goals and what is left to plan. */
function Summary({ d }: { d: Budgets }) {
  const t = d.totals
  const left = t.budgetedCents - t.spentCents
  return (
    <Card className="px-5 py-4">
      <StatRow>
        <Stat
          label="Income"
          detail={
            t.plannedIncomeCents != null
              ? `of ${whole(t.plannedIncomeCents)} planned`
              : "No income budget"
          }
        >
          {whole(t.incomeCents)}
        </Stat>
        <Stat
          label="Spent in budgets"
          detail={
            t.unbudgetedCents
              ? `+ ${whole(t.unbudgetedCents)} outside budgets`
              : `of ${whole(t.budgetedCents)}`
          }
        >
          {whole(t.spentCents)}
          {t.unbudgetedCents ? (
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              of {whole(t.budgetedCents)}
            </span>
          ) : null}
        </Stat>
        <Stat label={left >= 0 ? "Left in budgets" : "Over budgets"}>
          <span className={left < 0 ? "text-negative" : ""}>
            {whole(Math.abs(left))}
          </span>
        </Stat>
        <Stat
          label="Left to budget"
          detail={
            t.leftToBudgetCents == null
              ? "Plan income to see it"
              : t.goalsCents
                ? `after ${whole(t.goalsCents)} to goals`
                : undefined
          }
        >
          {t.leftToBudgetCents == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={t.leftToBudgetCents < 0 ? "text-negative" : ""}>
              {t.leftToBudgetCents < 0 ? "−" : ""}
              {whole(Math.abs(t.leftToBudgetCents))}
            </span>
          )}
        </Stat>
      </StatRow>
    </Card>
  )
}

// Category, progress, spent, budget, menu; a phone moves progress below.
// A phone puts spending in the status line so names keep their width.
const GRID =
  "grid grid-cols-[minmax(0,1fr)_6.5rem_2rem] items-center gap-x-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7rem_7.5rem_2rem]"

function BudgetSection({
  title,
  action,
  spentLabel = "Spent",
  progressLabel = "Progress",
  children,
  empty,
  footer,
}: {
  title: ReactNode
  action?: ReactNode
  spentLabel?: string
  progressLabel?: string
  children: ReactNode
  empty?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex min-h-12 items-center justify-between gap-2 border-b px-5 py-2">
        <span className="font-heading text-base font-medium">{title}</span>
        {action}
      </div>
      <div
        className={`${GRID} border-b px-5 py-1.5 text-xs text-muted-foreground`}
      >
        <span>Category</span>
        <span className="hidden sm:block">{progressLabel}</span>
        <span className="hidden text-right sm:block">{spentLabel}</span>
        <span className="text-right">Budget</span>
        <span />
      </div>
      {empty ?? (
        <ul className="flex flex-col divide-y divide-border/70">{children}</ul>
      )}
      {footer ? (
        <div
          className={`${GRID} border-t bg-muted/40 px-5 py-2.5 text-sm font-medium`}
        >
          {footer}
        </div>
      ) : null}
    </Card>
  )
}

/** Top-level rows, each followed by its children and its own remainder. */
function tree(rows: BudgetRow[], tops: BudgetRow[]) {
  return tops.flatMap((r) => {
    const kids = rows.filter((x) => x.parent === r.code)
    const lines: { row: BudgetRow; rest?: boolean }[] = [{ row: r }]
    for (const k of kids) lines.push({ row: k })
    // With budgeted children, the parent's own amount is its own line.
    if (r.hasChildBudgets && (r.budgetCents != null || r.ownSpentCents))
      lines.push({ row: r, rest: true })
    return lines
  })
}

function CategoryCards({ d }: { d: Budgets }) {
  const tops = d.expenses.filter((r) => !r.parent)
  const budgeted = tops.filter((r) => r.totalBudgetCents != null)
  const other = tops
    .filter((r) => r.totalBudgetCents == null)
    .sort((a, b) => b.spentCents - a.spentCents)
  return (
    <>
      <BudgetSection
        title="Spending"
        footer={
          budgeted.length ? (
            <>
              <span>Total</span>
              <span className="hidden sm:block" />
              <span className="hidden text-right tabular-nums sm:block">
                {whole(d.totals.spentCents)}
              </span>
              <span className="text-right tabular-nums max-sm:col-span-2">
                <span className="sm:hidden">
                  {whole(d.totals.spentCents)} of{" "}
                </span>
                {whole(d.totals.budgetedCents)}
              </span>
              <span className="hidden sm:block" />
            </>
          ) : undefined
        }
        empty={
          budgeted.length ? undefined : (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              No budgets yet. Add an amount to any category below.
            </p>
          )
        }
      >
        {tree(d.expenses, budgeted).map(({ row, rest }) => (
          <BudgetLine
            key={`${d.month}-${row.code}-${rest ? "rest" : "row"}-${row.budgetCents}`}
            row={row}
            rest={rest}
            d={d}
          />
        ))}
      </BudgetSection>
      {other.length ? (
        <BudgetSection
          title="Not budgeted"
          spentLabel="Spent"
          progressLabel="Average (3 months)"
        >
          {tree(d.expenses, other).map(({ row, rest }) => (
            <BudgetLine
              key={`${d.month}-${row.code}-${rest ? "rest" : "row"}-${row.budgetCents}`}
              row={row}
              rest={rest}
              d={d}
            />
          ))}
        </BudgetSection>
      ) : null}
    </>
  )
}

function FlexCards({ d }: { d: Budgets }) {
  const tops = d.expenses.filter((r) => !r.parent)
  const of = (kind: BudgetKind) => tops.filter((r) => r.kind === kind)
  const lines = (rows: BudgetRow[]) =>
    tree(d.expenses, rows).map(({ row, rest }) => (
      <BudgetLine
        key={`${d.month}-${row.code}-${rest ? "rest" : "row"}-${row.budgetCents}`}
        row={row}
        rest={rest}
        d={d}
      />
    ))
  const flexible = of("flexible")
  return (
    <>
      <BudgetSection title="Fixed">{lines(of("fixed"))}</BudgetSection>
      <BudgetSection title="Flexible">
        {d.flexible ? <PoolLine pool={d.flexible} d={d} /> : null}
        {flexible.length ? (
          lines(flexible)
        ) : (
          <li className="px-5 py-3 text-sm text-muted-foreground">
            Move categories here from a row’s menu.
          </li>
        )}
      </BudgetSection>
      {of("non_monthly").length ? (
        <BudgetSection title="Non-monthly" spentLabel="Spent">
          {lines(of("non_monthly"))}
        </BudgetSection>
      ) : null}
    </>
  )
}

function IncomeCard({ d }: { d: Budgets }) {
  const rows = d.income.filter(
    (r) => !r.parent && (r.totalBudgetCents != null || r.spentCents)
  )
  if (!rows.length) return null
  return (
    <BudgetSection title="Income" spentLabel="Received">
      {tree(d.income, rows).map(({ row, rest }) => (
        <BudgetLine
          key={`${d.month}-${row.code}-${rest ? "rest" : "row"}-${row.budgetCents}`}
          row={row}
          rest={rest}
          d={d}
        />
      ))}
    </BudgetSection>
  )
}

function GoalsCard({ d }: { d: Budgets }) {
  if (!d.goals.length) return null
  return (
    <SectionCard
      title="Goals"
      flush
      action={
        <span className="text-sm text-muted-foreground tabular-nums">
          {whole(d.totals.goalsCents)} / month
        </span>
      }
    >
      <ul className="flex flex-col divide-y divide-border/70">
        {d.goals.map((g) => (
          <li key={g.id}>
            <Link
              to="/goals/$id"
              params={{ id: g.id }}
              className="flex min-h-11 items-center gap-3 px-5 py-2 text-sm hover:bg-muted/60"
            >
              <GoalIcon className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {g.name}
              </span>
              <span className="tabular-nums">
                {whole(g.monthlyCents)} / month
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/** The amount input: typing applies this month and later unless the row is set to "only this month". */
function AmountInput({
  label,
  cents,
  onCommit,
}: {
  label: string
  cents: number | null
  onCommit: (cents: number | null) => void
}) {
  const [value, setValue] = useState(
    cents == null ? "" : Math.round(cents / 100).toLocaleString()
  )
  const commit = () => {
    const next =
      value.trim() === ""
        ? null
        : Math.round(Number(value.replace(/[^0-9.]/g, "")) * 100)
    if (next === cents || (next != null && Number.isNaN(next))) return
    onCommit(next)
  }
  return (
    <InputGroup className="h-8">
      <InputGroupAddon>$</InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        inputMode="decimal"
        placeholder="—"
        className="text-right tabular-nums"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </InputGroup>
  )
}

function BudgetLine({
  row: r,
  rest = false,
  d,
}: {
  row: BudgetRow
  /** The parent's own amount, beside its budgeted children. */
  rest?: boolean
  d: Budgets
}) {
  const month = d.month
  const [onlyMonth, setOnlyMonth] = useState(false)
  const put = useSend<{
    amountCents: number | null
    scope?: "forward" | "month"
    reset?: boolean
  }>("PUT", `/api/budgets/${month}/${r.code}`, {
    success: (_, v) =>
      v.reset
        ? `${r.label} back to its usual amount`
        : v.scope === "month"
          ? `${r.label} set for ${monthShort(month)} only`
          : v.amountCents == null
            ? `${r.label} budget removed from ${monthShort(month)} on`
            : `${r.label} budget saved from ${monthShort(month)} on`,
    onSuccess: () => setOnlyMonth(false),
  })
  const rollover = useSend<{ enabled: boolean }>(
    "PUT",
    `/api/budgets/rollover/${r.code}`,
    {
      body: (v) => ({ enabled: v.enabled, since: month }),
      success: (_, v) =>
        v.enabled ? "Leftover now rolls over" : "Rollover turned off",
    }
  )
  const kind = useSend<{ budgetKind: BudgetKind }>(
    "PATCH",
    `/api/categories/${r.code}`,
    { success: (_, v) => `${r.label} is now ${KIND_LABEL[v.budgetKind]}` }
  )
  const income = r.group === "income"
  const flexible = r.kind === "flexible"
  // The remainder line edits the parent's own amount and its own spending.
  const own = rest || !r.hasChildBudgets
  const budget = rest ? r.budgetCents : r.totalBudgetCents
  const spent = rest ? r.ownSpentCents : r.spentCents
  const budgeted = budget != null && !flexible
  const available = (budget ?? 0) + (rest ? 0 : r.rolloverCents)
  const over = budgeted && spent > available
  const label = rest ? `Everything else in ${r.label}` : r.label
  const elapsed = income || r.kind === "non_monthly" ? undefined : d.elapsed
  const ahead =
    budgeted &&
    !over &&
    elapsed !== undefined &&
    elapsed > 0 &&
    elapsed < 1 &&
    available > 0 &&
    spent / available > elapsed + 0.1
  const indented = Boolean(r.parent) || rest
  return (
    <li className={`${GRID} gap-y-1.5 px-5 py-2.5`}>
      <span
        className={`flex min-w-0 items-center gap-2.5 ${indented ? "pl-6" : ""}`}
      >
        {indented ? null : (
          <CategoryIcon icon={r.icon} color={r.color} size="sm" />
        )}
        {rest ? (
          <span className="line-clamp-2 min-w-0 text-sm break-words text-muted-foreground">
            Everything else
          </span>
        ) : (
          <Link
            to="/reports/categories/$code"
            params={{ code: r.code }}
            className={`line-clamp-2 min-w-0 text-sm break-words underline-offset-4 hover:underline ${indented ? "text-muted-foreground" : "font-medium"}`}
          >
            {label}
          </Link>
        )}
        {r.source === "month" && own && !flexible ? (
          <Badge
            variant="outline"
            className="hidden shrink-0 font-normal sm:inline-flex"
          >
            {monthShort(month)} only
          </Badge>
        ) : null}
      </span>
      <div
        className={`col-span-3 row-start-2 flex flex-col gap-1 sm:col-span-1 sm:row-start-auto ${indented ? "pl-6 sm:pl-0" : ""}`}
      >
        {budgeted ? (
          <BudgetBar
            label={`${label} ${income ? "received" : "budget used"}`}
            spent={spent}
            budget={available}
            elapsed={income ? undefined : elapsed}
          />
        ) : null}
        <span className="text-xs text-muted-foreground">
          <span className="sm:hidden">
            {whole(spent)} {income ? "received" : "spent"}
            {r.source === "month" && own && !flexible
              ? ` · ${monthShort(month)} only`
              : ""}
            {" · "}
          </span>
          {flexible ? (
            "In the flexible budget"
          ) : !budgeted ? (
            r.averageCents < 0 ? (
              <span className="text-positive">
                {whole(-r.averageCents)} back on average
              </span>
            ) : (
              `${whole(r.averageCents)} average`
            )
          ) : income ? (
            spent >= available ? (
              <span className="text-positive">
                {whole(spent - available)} above plan
              </span>
            ) : (
              `${whole(available - spent)} to come`
            )
          ) : over ? (
            <span className="text-negative">
              {whole(spent - available)} over
            </span>
          ) : (
            <>
              {`${whole(available - spent)} left`}
              {ahead ? (
                <span className="text-warning"> · ahead of pace</span>
              ) : null}
            </>
          )}
          {!rest && r.rolloverCents
            ? ` · ${money(r.rolloverCents, { sign: true, whole: true })} ${r.kind === "non_monthly" ? "saved up" : "rolled over"}`
            : ""}
        </span>
      </div>
      <span className="hidden text-right text-sm tabular-nums sm:block">
        {whole(spent)}
      </span>
      {own && !flexible ? (
        <div className="flex flex-col items-end gap-0.5">
          <AmountInput
            label={`${label} budget${onlyMonth ? ` for ${monthName(month)} only` : ` from ${monthName(month)}`}`}
            cents={r.budgetCents}
            onCommit={(cents) =>
              put.mutate({
                amountCents: cents,
                scope: onlyMonth ? "month" : "forward",
              })
            }
          />
          {onlyMonth ? (
            <span className="text-[11px] text-muted-foreground">
              {monthShort(month)} only
            </span>
          ) : null}
        </div>
      ) : (
        <span className="pr-3 text-right text-sm text-muted-foreground tabular-nums">
          {flexible ? "" : whole(budget)}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${label} budget options`}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          {own && !flexible ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setOnlyMonth((v) => !v)}>
                {onlyMonth
                  ? "Change this month and later"
                  : `Change ${monthName(month)} only`}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  put.mutate({ amountCents: r.averageCents || null })
                }
                disabled={!r.averageCents}
              >
                Set to 3-month average ({whole(r.averageCents)})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  put.mutate({ amountCents: r.lastMonthCents || null })
                }
                disabled={!r.lastMonthCents}
              >
                Set to last month ({whole(r.lastMonthCents)})
              </DropdownMenuItem>
              {!income && !rest ? (
                <DropdownMenuItem
                  disabled={
                    r.totalBudgetCents == null || r.kind === "non_monthly"
                  }
                  onClick={() => rollover.mutate({ enabled: !r.rollover })}
                >
                  {r.rollover
                    ? "Stop rolling over leftover"
                    : "Roll leftover into next month"}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          ) : null}
          {d.mode === "flex" && !income && !r.parent && !rest ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Budget as</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={r.kind}
                  onValueChange={(v) =>
                    kind.mutate({ budgetKind: v as BudgetKind })
                  }
                >
                  {(["fixed", "flexible", "non_monthly"] as const).map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </>
          ) : null}
          {own && !flexible ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={r.source !== "month"}
                onClick={() => put.mutate({ amountCents: null, reset: true })}
              >
                Use the usual amount
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={r.budgetCents == null}
                onClick={() => put.mutate({ amountCents: null })}
              >
                Remove budget from {monthShort(month)} on
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

const KIND_LABEL: Record<BudgetKind, string> = {
  fixed: "Fixed",
  flexible: "Flexible",
  non_monthly: "Non-monthly",
}

/** The one budget all flexible categories share. */
function PoolLine({ pool, d }: { pool: FlexiblePool; d: Budgets }) {
  const put = useSend<{ amountCents: number | null }>(
    "PUT",
    `/api/budgets/${d.month}/__flexible`,
    { success: `Flexible budget saved from ${monthShort(d.month)} on` }
  )
  const budgeted = pool.budgetCents != null
  const available = (pool.budgetCents ?? 0) + pool.rolloverCents
  const over = budgeted && pool.spentCents > available
  return (
    <li className={`${GRID} gap-y-1.5 bg-muted/30 px-5 py-2.5`}>
      <span className="text-sm font-medium">Flexible spending</span>
      <div className="col-span-3 row-start-2 flex flex-col gap-1 sm:col-span-1 sm:row-start-auto">
        {budgeted ? (
          <BudgetBar
            label="Flexible budget used"
            spent={pool.spentCents}
            budget={available}
            elapsed={d.elapsed}
          />
        ) : null}
        <span className="text-xs text-muted-foreground">
          <span className="sm:hidden">{whole(pool.spentCents)} spent · </span>
          {!budgeted ? (
            `${whole(pool.averageCents)} average`
          ) : over ? (
            <span className="text-negative">
              {whole(pool.spentCents - available)} over
            </span>
          ) : (
            `${whole(available - pool.spentCents)} left`
          )}
        </span>
      </div>
      <span className="hidden text-right text-sm tabular-nums sm:block">
        {whole(pool.spentCents)}
      </span>
      <AmountInput
        key={`${d.month}-${pool.budgetCents}`}
        label={`Flexible budget from ${monthName(d.month)}`}
        cents={pool.budgetCents}
        onCommit={(cents) => put.mutate({ amountCents: cents })}
      />
      <span />
    </li>
  )
}
