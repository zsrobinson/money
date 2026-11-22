import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  cn,
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@zsrobinson/shell/ui/tabs"
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
} from "lucide-react"
import { z } from "zod"
import { useCategories } from "@/components/category-style"
import {
  Amount,
  EmptyState,
  Loading,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import {
  BankBadge,
  cadenceLabel,
  OccurrenceRow,
  RecurringIcon,
  STATUS_LABEL,
} from "@/components/recurring"
import { usePageTitle } from "@/lib/crumb"
import {
  addMonths,
  longDate,
  money,
  monthName,
  monthShort,
  parseDay,
  pluralize,
  relativeDay,
  shortDate,
} from "@/lib/format"
import { metaQuery, recurringQuery } from "@/lib/queries"
import type { CardBill, Occurrence, Recurring } from "@/lib/types"

export const Route = createFileRoute("/recurring/")({
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
    view: z.enum(["calendar", "list"]).optional().catch(undefined),
  }),
  staticData: { crumbs: [{ label: "Recurring", to: "/recurring" }] },
  component: RecurringPage,
})

const WEEKDAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  timeZone: "UTC",
})
const WEEKDAY_NARROW = new Intl.DateTimeFormat(undefined, {
  weekday: "narrow",
  timeZone: "UTC",
})

function RecurringPage() {
  usePageTitle("Recurring")
  const search = Route.useSearch()
  const navigate = useNavigate({ from: "/recurring/" })
  const meta = useQuery(metaQuery).data
  const current = meta?.today.slice(0, 7)
  const month = search.month ?? current
  const view = search.view ?? "calendar"
  const q = useQuery({ ...recurringQuery(month), enabled: !!month })
  const d = q.data
  const setSearch = (next: { month?: string; view?: "calendar" | "list" }) =>
    void navigate({
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    })
  const step = (n: number) => {
    if (!month) return
    const next = addMonths(month, n)
    setSearch({ month: next === current ? undefined : next })
  }
  const items = d?.items ?? []
  const active = items.filter((i) => i.status === "active")
  const bills = active.filter((i) => i.kind === "expense")
  const income = active.filter((i) => i.kind === "income")
  const stopped = items.filter((i) => i.status !== "active")
  const expenses = (d?.calendar ?? []).filter((o) => o.kind === "expense")
  const paid = expenses.filter((o) => o.state === "paid")
  const isCurrent = month === current
  const when = isCurrent ? "this month" : `in ${month ? monthShort(month) : ""}`
  return (
    <Page>
      <PageHeader>
        <PageTitle>Recurring</PageTitle>
        <PageActions>
          {month && !isCurrent ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearch({ month: undefined })}
            >
              This month
            </Button>
          ) : null}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => step(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="min-w-34 text-center text-sm font-medium tabular-nums">
              {month ? monthName(month) : ""}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={() => step(1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </PageActions>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="Recurring payments failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d || !meta ? (
        <Loading rows={8} />
      ) : (
        <PageStack>
          <StatRow>
            <Stat
              label="Bills / month"
              detail={pluralize(bills.length, "bill")}
            >
              {money(d.monthlyExpenseCents, { whole: true })}
            </Stat>
            <Stat
              label="Income / month"
              detail={pluralize(income.length, "source")}
            >
              {money(d.monthlyIncomeCents, { whole: true })}
            </Stat>
            <Stat
              label={`Paid ${when}`}
              detail={`${paid.length} of ${pluralize(expenses.length, "bill")}`}
            >
              {money(d.monthPaidCents, { whole: true })}
            </Stat>
            <Stat
              label={
                isCurrent
                  ? "Still due this month"
                  : month && current && month < current
                    ? `Unpaid in ${monthShort(month)}`
                    : `Due in ${monthShort(d.month)}`
              }
              detail={`${pluralize(expenses.length - paid.length, "bill")} left`}
            >
              {money(d.monthDueCents, { whole: true })}
            </Stat>
          </StatRow>
          <SectionCard
            title="Schedule"
            flush
            action={
              <Tabs
                value={view}
                onValueChange={(v) =>
                  setSearch({
                    view: v === "list" ? "list" : undefined,
                  })
                }
              >
                <TabsList>
                  <TabsTrigger value="calendar" className="px-2.5">
                    <CalendarDaysIcon />
                    Calendar
                  </TabsTrigger>
                  <TabsTrigger value="list" className="px-2.5">
                    <ListIcon />
                    List
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            }
          >
            {view === "calendar" ? (
              <MonthCalendar
                key={d.month}
                month={d.month}
                today={d.today}
                occurrences={d.calendar}
                weekStartsOn={meta.settings.weekStartsOn}
              />
            ) : d.calendar.length ? (
              <MonthList occurrences={d.calendar} />
            ) : (
              <EmptyState title={`Nothing expected in ${monthName(d.month)}`} />
            )}
          </SectionCard>
          <PageGrid layout="wide">
            {d.bills.length ? (
              <CardBills
                bills={d.bills}
                today={d.today}
                className="lg:col-start-2 lg:row-start-1"
              />
            ) : null}
            <PageStack className="lg:col-start-1 lg:row-start-1">
              <ItemList
                title="Bills"
                items={bills}
                today={d.today}
                empty="No regular bills found yet."
              />
              <ItemList
                title="Income"
                items={income}
                today={d.today}
                empty="No regular income found yet."
              />
              {stopped.length ? (
                <Inactive items={stopped} today={d.today} />
              ) : null}
            </PageStack>
          </PageGrid>
        </PageStack>
      )}
    </Page>
  )
}

/** Weeks of the month starting on the chosen weekday, with each day's charges. */
function calendarDays(month: string, weekStartsOn: "sunday" | "monday") {
  const first = parseDay(`${month}-01`)
  const start = weekStartsOn === "monday" ? 1 : 0
  const offset = (first.getUTCDay() - start + 7) % 7
  const days = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)
  ).getUTCDate()
  const cells = Math.ceil((offset + days) / 7) * 7
  return Array.from({ length: cells }, (_, i) => {
    const day = i - offset + 1
    return day >= 1 && day <= days
      ? `${month}-${String(day).padStart(2, "0")}`
      : null
  })
}

const STATE_DOT: Record<Occurrence["state"], string> = {
  paid: "bg-muted-foreground/45",
  due: "ring-1 ring-inset ring-foreground/55",
  missed: "bg-destructive",
}
const STATE_CHIP: Record<Occurrence["state"], string> = {
  paid: "bg-muted text-muted-foreground",
  due: "border border-border text-foreground",
  missed: "bg-destructive/10 text-destructive dark:bg-destructive/20",
}

function MonthCalendar({
  month,
  today,
  occurrences,
  weekStartsOn,
}: {
  month: string
  today: string
  occurrences: Occurrence[]
  weekStartsOn: "sunday" | "monday"
}) {
  const days = calendarDays(month, weekStartsOn)
  const byDay = new Map<string, Occurrence[]>()
  for (const o of occurrences)
    byDay.set(o.date, [...(byDay.get(o.date) ?? []), o])
  const [selected, setSelected] = useState(() =>
    today.startsWith(month) ? today : (occurrences[0]?.date ?? `${month}-01`)
  )
  const chosen = byDay.get(selected) ?? []
  const categories = useCategories()
  const headings = days.slice(0, 7).map((_, i) => {
    // Any week works for weekday names; 2023-01-01 is a Sunday.
    const day = parseDay(
      `2023-01-0${1 + ((i + (weekStartsOn === "monday" ? 1 : 0)) % 7)}`
    )
    return { short: WEEKDAY.format(day), narrow: WEEKDAY_NARROW.format(day) }
  })
  const total = chosen.reduce((s, o) => s + o.amountCents, 0)
  return (
    <div className="flex flex-col">
      <div className="px-3 pb-3 sm:px-5">
        <div
          aria-hidden
          className="grid grid-cols-7 gap-1 pb-1 text-center text-xs text-muted-foreground"
        >
          {headings.map((h) => (
            <span key={h.short}>
              <span className="sm:hidden">{h.narrow}</span>
              <span className="hidden sm:inline">{h.short}</span>
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((date, i) => {
            if (!date) return <span key={`blank-${i}`} aria-hidden />
            const list = byDay.get(date) ?? []
            const isToday = date === today
            const isSelected = date === selected
            return (
              <button
                key={date}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${longDate(date)}${list.length ? `, ${pluralize(list.length, "expected charge")}` : ""}`}
                onClick={() => setSelected(date)}
                className={cn(
                  "flex min-h-13 min-w-0 cursor-pointer flex-col items-center gap-1 rounded-xl p-1 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24 sm:items-stretch sm:p-1.5",
                  isSelected && "bg-muted hover:bg-muted"
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
                    isToday
                      ? "bg-primary font-medium text-primary-foreground"
                      : list.length
                        ? "font-medium"
                        : "text-muted-foreground"
                  )}
                >
                  {Number(date.slice(8))}
                </span>
                {list.length ? (
                  <>
                    <span className="flex flex-wrap justify-center gap-0.5 sm:hidden">
                      {list.slice(0, 4).map((o) => (
                        <span
                          key={o.key}
                          className={cn(
                            "size-1.5 rounded-full",
                            STATE_DOT[o.state]
                          )}
                        />
                      ))}
                    </span>
                    <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                      {list.slice(0, 3).map((o) => (
                        <span
                          key={o.key}
                          className={cn(
                            "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4",
                            STATE_CHIP[o.state]
                          )}
                        >
                          {o.state === "paid" ? (
                            <CheckIcon className="size-3 shrink-0" />
                          ) : null}
                          <span className="truncate">{o.merchant}</span>
                        </span>
                      ))}
                      {list.length > 3 ? (
                        <span className="px-1.5 text-[11px] text-muted-foreground">
                          {list.length - 3} more
                        </span>
                      ) : null}
                    </span>
                  </>
                ) : null}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(["paid", "due", "missed"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", STATE_DOT[s])} />
              {s === "paid" ? "Paid" : s === "due" ? "Due" : "Missed"}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-y bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground sm:px-5">
        <span>{relativeDayHeading(selected, today)}</span>
        {chosen.length ? (
          <span className="tabular-nums">{money(total, { sign: true })}</span>
        ) : null}
      </div>
      {chosen.length ? (
        <ul className="flex flex-col">
          {chosen.map((o) => (
            <OccurrenceRow
              key={o.key}
              occurrence={o}
              detail={categories.label(o.category)}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
          Nothing expected this day.
        </p>
      )}
    </div>
  )
}

/** "In 3 days" reads "in 3 days" mid-sentence; dates keep their case. */
const lower = (s: string) =>
  /^(In|Today|Tomorrow|Yesterday)\b/.test(s)
    ? s.charAt(0).toLowerCase() + s.slice(1)
    : s

const relativeDayHeading = (date: string, today: string) => {
  const r = relativeDay(date, today)
  return r === "Today" || r === "Tomorrow" || r === "Yesterday"
    ? `${r}, ${shortDate(date)}`
    : longDate(date)
}

/** One row per expected charge, the date in its own column. */
function MonthList({ occurrences }: { occurrences: Occurrence[] }) {
  const categories = useCategories()
  return (
    <ul className="flex flex-col border-t">
      {occurrences.map((o) => (
        <OccurrenceRow
          key={`${o.key}-${o.date}`}
          occurrence={o}
          detail={categories.label(o.category)}
          date={
            <span className="flex flex-col leading-tight">
              <span>{WEEKDAY.format(parseDay(o.date))}</span>
              <span className="text-sm font-medium text-foreground">
                {shortDate(o.date)}
              </span>
            </span>
          }
        />
      ))}
    </ul>
  )
}

function CardBills({
  bills,
  today,
  className,
}: {
  bills: CardBill[]
  today: string
  className?: string
}) {
  return (
    <SectionCard title="Card bills" flush className={className}>
      <ul className="flex flex-col border-t">
        {bills.map((b) => (
          <li
            key={b.accountId}
            className="border-b border-border/70 last:border-b-0"
          >
            <Link
              to="/accounts/$id"
              params={{ id: b.accountId }}
              className="flex min-h-13 items-center gap-3 px-4 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:px-5"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-sm font-medium">
                  {b.accountName}
                </span>
                <span className="text-xs text-muted-foreground">
                  Due {lower(relativeDay(b.dueDate, today))}
                  {b.minimumCents != null
                    ? ` · Minimum ${money(b.minimumCents)}`
                    : ""}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-medium tabular-nums">
                  {money(b.statementCents)}
                </span>
                {b.paid ? (
                  <Badge variant="secondary" className="text-muted-foreground">
                    <CheckIcon data-icon="inline-start" />
                    Paid
                  </Badge>
                ) : b.overdue ? (
                  <Badge variant="destructive">Overdue</Badge>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

function ItemRow({ item: i, today }: { item: Recurring; today: string }) {
  return (
    <li className="border-b border-border/70 last:border-b-0">
      <Link
        to="/recurring/$key"
        params={{ key: i.key }}
        className="flex min-h-13 items-center gap-3 px-4 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:px-5"
      >
        <RecurringIcon category={i.category} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium">
            {i.merchant}
            {i.cadenceSource === "provider" ? (
              <BankBadge className="ml-1.5 align-[1px]" />
            ) : null}
          </span>
          <span className="text-xs text-muted-foreground">
            {cadenceLabel(i.cadence)} ·{" "}
            {i.status === "active"
              ? `Next ${lower(relativeDay(i.nextDate, today))}`
              : `${STATUS_LABEL[i.status]}, last ${shortDate(i.lastDate, today)}`}
          </span>
        </span>
        <Amount
          cents={i.amountCents}
          className={cn(
            "shrink-0 text-right text-sm font-medium whitespace-nowrap",
            i.status !== "active" && "text-muted-foreground"
          )}
        />
      </Link>
    </li>
  )
}

function ItemList({
  title,
  items,
  today,
  empty,
}: {
  title: string
  items: Recurring[]
  today: string
  empty: string
}) {
  return (
    <SectionCard
      title={title}
      flush
      action={
        items.length ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            {items.length}
          </span>
        ) : null
      }
    >
      {items.length ? (
        <ul className="flex flex-col border-t">
          {items.map((i) => (
            <ItemRow key={i.key} item={i} today={today} />
          ))}
        </ul>
      ) : (
        <EmptyState title={empty} />
      )}
    </SectionCard>
  )
}

/** Stopped, cancelled and not-recurring items, folded away by default. */
function Inactive({ items, today }: { items: Recurring[]; today: string }) {
  const [open, setOpen] = useState(false)
  return (
    <SectionCard
      title="Inactive"
      flush
      className={cn(!open && "gap-0 pb-0")}
      action={
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : `Show ${items.length}`}
          <ChevronDownIcon
            data-icon="inline-end"
            className={cn("transition-transform", open && "rotate-180")}
          />
        </Button>
      }
    >
      {open ? (
        <ul className="flex flex-col border-t">
          {items.map((i) => (
            <ItemRow key={i.key} item={i} today={today} />
          ))}
        </ul>
      ) : null}
    </SectionCard>
  )
}
