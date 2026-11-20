import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageGrid,
  PageHeader,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@zsrobinson/shell/ui/dropdown-menu"
import { EllipsisIcon } from "lucide-react"
import {
  Amount,
  EmptyState,
  Loading,
  MerchantMark,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  CADENCE,
  cadenceDays,
  daysBetween,
  longDate,
  money,
  pluralize,
  relativeDay,
  shortDate,
} from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { recurringQuery } from "@/lib/queries"
import type { Recurring } from "@/lib/types"

export const Route = createFileRoute("/recurring")({
  staticData: { crumbs: [{ label: "Recurring", to: "/recurring" }] },
  component: RecurringPage,
})

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)

/** Every expected charge and payment in the window, repeating ones included. */
function timeline(items: Recurring[], today: string, days: number) {
  const end = addDays(today, days)
  const out: { date: string; item: Recurring }[] = []
  for (const item of items) {
    if (item.status !== "active") continue
    for (
      let d = item.nextDate;
      d <= end;
      d = addDays(d, cadenceDays(item.cadence))
    )
      if (d >= today) out.push({ date: d, item })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

function RecurringPage() {
  usePageTitle("Recurring")
  const q = useQuery(recurringQuery)
  const d = q.data
  const items = d?.items ?? []
  const active = items.filter((i) => i.status === "active")
  const bills = active.filter((i) => i.kind === "expense")
  const income = active.filter((i) => i.kind === "income")
  const stopped = items.filter((i) => i.status !== "active")
  const upcoming = d ? timeline(items, d.today, 30) : []
  const dueOut = upcoming
    .filter((u) => u.item.kind === "expense")
    .reduce((s, u) => s - u.item.amountCents, 0)
  const dueIn = upcoming
    .filter((u) => u.item.kind === "income")
    .reduce((s, u) => s + u.item.amountCents, 0)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Recurring</PageTitle>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="Recurring payments failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={8} />
      ) : (
        <PageStack>
          <StatRow>
            <Stat
              label="Bills a month"
              detail={pluralize(bills.length, "bill")}
            >
              {money(d.monthlyExpenseCents, { whole: true })}
            </Stat>
            <Stat
              label="Income a month"
              detail={pluralize(income.length, "source")}
            >
              {money(d.monthlyIncomeCents, { whole: true })}
            </Stat>
            <Stat
              label="Next 30 days"
              detail={`${money(dueIn, { whole: true })} in`}
            >
              {money(dueOut, { whole: true })} out
            </Stat>
          </StatRow>
          <PageGrid layout="wide">
            <PageStack>
              <RecurringList
                title="Bills and subscriptions"
                items={bills}
                today={d.today}
                empty="No regular bills found yet."
              />
              <RecurringList
                title="Income"
                items={income}
                today={d.today}
                empty="No regular income found yet."
              />
              {stopped.length ? (
                <RecurringList
                  title="Stopped, cancelled or ignored"
                  items={stopped}
                  today={d.today}
                />
              ) : null}
            </PageStack>
            <SectionCard
              title="Next 30 days"
              flush
              className="lg:sticky lg:top-16"
            >
              {upcoming.length ? (
                <ol className="flex flex-col">
                  {upcoming.map((u, i) => (
                    <li key={`${u.item.key}-${u.date}`}>
                      {i === 0 || upcoming[i - 1].date !== u.date ? (
                        <div className="flex items-baseline justify-between gap-3 border-y bg-muted/50 px-5 py-1.5 text-xs font-medium text-muted-foreground first:border-t-0">
                          <span>
                            {daysBetween(d.today, u.date) < 2
                              ? relativeDay(u.date, d.today)
                              : longDate(u.date)}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex min-h-10 items-center justify-between gap-3 px-5 py-1.5 text-sm">
                        <span className="truncate">{u.item.merchant}</span>
                        <Amount
                          cents={u.item.amountCents}
                          className="whitespace-nowrap"
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted-foreground">
                  Nothing expected.
                </p>
              )}
            </SectionCard>
          </PageGrid>
        </PageStack>
      )}
    </Page>
  )
}

const STATUS: Record<Recurring["status"], string> = {
  active: "Active",
  inactive: "Stopped",
  cancelled: "Cancelled",
  ignored: "Not recurring",
}

function RecurringList({
  title,
  items,
  today,
  empty,
}: {
  title: string
  items: Recurring[]
  today: string
  empty?: string
}) {
  return (
    <SectionCard title={title} flush>
      {items.length ? (
        <ul className="flex flex-col divide-y divide-border/70">
          {items.map((i) => (
            <RecurringRow key={i.key} item={i} today={today} />
          ))}
        </ul>
      ) : (
        <EmptyState title={empty ?? "Nothing here"} />
      )}
    </SectionCard>
  )
}

function RecurringRow({ item: i, today }: { item: Recurring; today: string }) {
  const patch = useSend<Record<string, unknown>>(
    "PATCH",
    `/api/recurring/${encodeURIComponent(i.key)}`,
    {
      success: "Updated",
    }
  )
  const source =
    i.cadenceSource === "provider"
      ? " (from your bank)"
      : i.cadenceSource === "manual"
        ? " (set by you)"
        : ""
  return (
    <li className="flex items-center gap-3 px-5 py-2">
      <MerchantMark name={i.merchant} />
      <Link
        to="/reports/merchants/$key"
        params={{ key: i.key }}
        className="flex min-w-0 flex-1 flex-col rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate text-sm font-medium">{i.merchant}</span>
        <span className="truncate text-xs text-muted-foreground">
          {CADENCE[i.cadence] ?? i.cadence}
          {source} ·{" "}
          {i.status === "active"
            ? relativeDay(i.nextDate, today)
            : `${STATUS[i.status]}, last ${shortDate(i.lastDate, today)}`}
        </span>
      </Link>
      <span className="hidden max-w-32 truncate text-xs text-muted-foreground sm:block">
        {i.accountName}
      </span>
      <Amount
        cents={i.amountCents}
        className="w-24 text-right text-sm font-medium whitespace-nowrap"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${i.merchant} options`}
            />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Repeats</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={i.cadence}
                onValueChange={(cadence) => patch.mutate({ cadence })}
              >
                {Object.entries(CADENCE).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {i.status !== "active" ? (
              <DropdownMenuItem
                onClick={() => patch.mutate({ status: "active" })}
              >
                Mark active
              </DropdownMenuItem>
            ) : null}
            {i.status !== "cancelled" ? (
              <DropdownMenuItem
                onClick={() => patch.mutate({ status: "cancelled" })}
              >
                Mark cancelled
              </DropdownMenuItem>
            ) : null}
            {i.status !== "ignored" ? (
              <DropdownMenuItem
                onClick={() => patch.mutate({ status: "ignored" })}
              >
                Not recurring
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
