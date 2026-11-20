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
import { CADENCE, money, pluralize, relativeDay, shortDate } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { recurringQuery } from "@/lib/queries"
import type { Recurring } from "@/lib/types"

export const Route = createFileRoute("/recurring")({
  staticData: { crumbs: [{ label: "Recurring", to: "/recurring" }] },
  component: RecurringPage,
})

function RecurringPage() {
  usePageTitle("Recurring")
  const q = useQuery(recurringQuery)
  const d = q.data
  const items = d?.items ?? []
  const active = items.filter((i) => i.status === "active")
  const bills = active.filter((i) => i.kind === "expense")
  const income = active.filter((i) => i.kind === "income")
  const soon = bills.filter(
    (i) => d && i.nextDate >= d.today && i.nextDate <= addDaysIso(d.today, 30)
  )
  const stopped = items.filter((i) => i.status !== "active")
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
              detail={pluralize(bills.length, "active bill")}
            >
              {money(d.monthlyExpenseCents, { whole: true })}
            </Stat>
            <Stat
              label="Income a month"
              detail={pluralize(income.length, "source")}
            >
              {money(d.monthlyIncomeCents, { whole: true })}
            </Stat>
            <Stat label="Due in 30 days">
              {money(-soon.reduce((s, i) => s + i.amountCents, 0), {
                whole: true,
              })}
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
            <SectionCard title="Next 30 days">
              {soon.length ? (
                <ol className="flex flex-col gap-3">
                  {soon.map((i) => (
                    <li
                      key={i.key}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">
                          {i.merchant}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {relativeDay(i.nextDate, d.today)}
                        </span>
                      </span>
                      <Amount cents={i.amountCents} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing due.</p>
              )}
            </SectionCard>
          </PageGrid>
        </PageStack>
      )}
    </Page>
  )
}

function addDaysIso(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

const STATUS: Record<Recurring["status"], string> = {
  active: "Active",
  inactive: "Stopped",
  cancelled: "Cancelled",
  ignored: "Ignored",
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
    { success: "Updated" }
  )
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
          {i.cadenceSource === "provider"
            ? " (from your bank)"
            : i.cadenceSource === "manual"
              ? " (set by you)"
              : ""}
          {" · "}
          {i.status === "active"
            ? `next ${relativeDay(i.nextDate, today).toLowerCase()}`
            : `${STATUS[i.status]}, last ${shortDate(i.lastDate, today)}`}
        </span>
      </Link>
      <span className="hidden text-xs text-muted-foreground sm:block">
        {i.accountName}
      </span>
      <Amount
        cents={i.amountCents}
        className="w-20 text-right text-sm font-medium"
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
