import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageMeta,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { DetailList, DetailRow } from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { ApiError } from "@zsrobinson/shell/lib/api"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import { StoreIcon } from "lucide-react"
import { categoryColor, useCategories } from "@/components/category-style"
import {
  CardLink,
  EmptyState,
  Loading,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { Choice } from "@/components/pickers"
import {
  BankBadge,
  cadenceLabel,
  RecurringIcon,
  STATUS_LABEL,
} from "@/components/recurring"
import { CompactTxnList } from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import {
  CADENCE,
  cadenceDays,
  epoch,
  epochDate,
  epochFullDate,
  epochMonthYear,
  fullDate,
  money,
  pluralize,
  relativeDay,
  shortDate,
} from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { metaQuery, recurringDetailQuery } from "@/lib/queries"
import type { RecurringDetail } from "@/lib/types"

export const Route = createFileRoute("/recurring/$key")({
  staticData: { crumbs: [{ label: "Recurring", to: "/recurring" }] },
  component: RecurringItemPage,
})

const notFound = (e: unknown) => e instanceof ApiError && e.status === 404

function RecurringItemPage() {
  const { key } = Route.useParams()
  const q = useQuery({
    ...recurringDetailQuery(key),
    retry: (n, e) => !notFound(e) && n < 2,
  })
  usePageTitle(q.data?.merchant, true)
  if (q.isError && notFound(q.error)) return <NotTracked merchantKey={key} />
  if (q.isError)
    return (
      <Page>
        <QueryError
          title="This recurring payment failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      </Page>
    )
  if (!q.data)
    return (
      <Page>
        <Loading rows={8} />
      </Page>
    )
  return <ItemView item={q.data} />
}

/** A merchant that is not (or no longer) recurring: offer to track it. */
function NotTracked({ merchantKey }: { merchantKey: string }) {
  const track = useSend<{ status: "active"; cadence: string }>(
    "PATCH",
    `/api/recurring/${encodeURIComponent(merchantKey)}`,
    { success: "Tracking as recurring" }
  )
  return (
    <Page>
      <EmptyState
        title="Not a recurring payment"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/reports/merchants/$key"
                  params={{ key: merchantKey }}
                />
              }
              nativeButton={false}
            >
              View merchant
            </Button>
            <Button
              size="sm"
              disabled={track.isPending}
              onClick={() =>
                track.mutate({ status: "active", cadence: "monthly" })
              }
            >
              Track as monthly
            </Button>
          </div>
        }
      >
        Track it to see when it is next expected.
      </EmptyState>
    </Page>
  )
}

function ItemView({ item: i }: { item: RecurringDetail }) {
  const navigate = useNavigate()
  const today = useQuery(metaQuery).data?.today ?? i.lastDate
  const categories = useCategories()
  const category = categories.get(i.category)
  const url = `/api/recurring/${encodeURIComponent(i.key)}`
  const patch = useSend<{
    status?: "active" | "ignored" | "cancelled"
    cadence?: string
    expectedCents?: number | null
  }>("PATCH", url, { success: "Saved" })
  const forget = useSend("DELETE", url, {
    success: i.manual ? "Stopped tracking" : "Back to detected",
    onSuccess: () => {
      if (i.manual) void navigate({ to: "/recurring" })
    },
  })
  const sign = i.kind === "income" ? 1 : -1
  const charges = (i.history ?? []).slice(-12)
  const monthlyish = cadenceDays(i.cadence) >= 28
  const points = charges.map((h) => ({
    time: epoch(h.date),
    amount: Math.abs(h.amountCents) / 100,
  }))
  const verb = i.kind === "income" ? "Received" : "Paid"
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 items-center gap-3">
          <RecurringIcon category={i.category} className="size-10" />
          <div className="flex min-w-0 flex-col">
            <PageTitle className="line-clamp-2">{i.merchant}</PageTitle>
            <PageMeta>
              <span>
                {cadenceLabel(i.cadence)}
                {i.kind === "income" ? " income" : ""}
              </span>
              {i.cadenceSource === "provider" ? <BankBadge /> : null}
              {i.status !== "active" ? (
                <Badge variant="secondary">{STATUS_LABEL[i.status]}</Badge>
              ) : null}
              {i.manual ? <Badge variant="outline">Added by you</Badge> : null}
            </PageMeta>
          </div>
        </div>
        <PageActions>
          <Button
            size="sm"
            variant="outline"
            render={
              <Link to="/reports/merchants/$key" params={{ key: i.key }} />
            }
            nativeButton={false}
          >
            <StoreIcon data-icon="inline-start" />
            Merchant
          </Button>
        </PageActions>
      </PageHeader>
      <PageGrid layout="wide">
        <PageStack>
          <SectionCard
            title="Charges"
            footer={
              <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {pluralize(
                    i.count,
                    i.kind === "income" ? "payment" : "charge"
                  )}{" "}
                  since {fullDate((i.history ?? [])[0]?.date ?? i.lastDate)}
                  {i.missed ? ` · ${i.missed} missed` : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="w-4 border-t border-dashed border-muted-foreground"
                  />
                  Expected {money(Math.abs(i.amountCents))}
                </span>
              </div>
            }
          >
            <StatRow className="mb-4">
              <Stat
                label={
                  i.kind === "income" ? "Average payment" : "Average charge"
                }
              >
                {money(Math.abs(i.averageCents))}
              </Stat>
              <Stat label="Last 12 months">
                {money(Math.abs(i.yearCents), { whole: true })}
              </Stat>
              <Stat label="Per month">
                {money(Math.abs(i.monthlyCents), { whole: true })}
              </Stat>
            </StatRow>
            <TrendChart
              kind="bar"
              label={`${i.merchant}: each ${i.kind === "income" ? "payment" : "charge"} against the expected amount`}
              data={points}
              config={{
                amount: {
                  label: verb,
                  color: categoryColor(category?.color),
                },
              }}
              references={[{ value: Math.abs(i.amountCents) / 100 }]}
              format={(v) => money(Math.round(v * 100))}
              // Small charges need cents on the axis, not rounded dollars.
              formatTick={(v) =>
                money(Math.round(v * 100), { whole: Number.isInteger(v) })
              }
              formatTime={epochFullDate}
              formatTimeTick={monthlyish ? epochMonthYear : epochDate}
              className="h-56"
            />
          </SectionCard>
        </PageStack>
        <SectionCard
          title="Schedule"
          footer={
            i.manual || i.edited ? (
              <ConfirmAction
                trigger={
                  <Button
                    variant="ghost"
                    className={i.manual ? "text-destructive" : undefined}
                  >
                    {i.manual ? "Stop tracking" : "Undo my changes"}
                  </Button>
                }
                title={
                  i.manual
                    ? `Stop tracking ${i.merchant}?`
                    : `Undo changes to ${i.merchant}?`
                }
                confirmLabel={i.manual ? "Stop tracking" : "Undo changes"}
                destructive={i.manual}
                onConfirm={() => forget.mutateAsync()}
              >
                {i.manual
                  ? "It leaves Recurring. Its transactions are unchanged."
                  : "Its schedule, amount and status go back to what was detected."}
              </ConfirmAction>
            ) : undefined
          }
        >
          <DetailList>
            <DetailRow label="Repeats">
              <Choice
                aria-label="Repeats"
                size="sm"
                align="end"
                className="w-40"
                value={i.cadence}
                onChange={(cadence) => patch.mutate({ cadence })}
                options={Object.entries(CADENCE).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </DetailRow>
            <DetailRow label="Expected">
              <ExpectedInput
                key={i.amountCents}
                cents={Math.abs(i.amountCents)}
                onCommit={(cents) =>
                  patch.mutate({
                    expectedCents: cents == null ? null : sign * cents,
                  })
                }
              />
            </DetailRow>
            <DetailRow label="Status">
              <Choice
                aria-label="Status"
                size="sm"
                align="end"
                className="w-40"
                value={i.status === "inactive" ? "active" : i.status}
                onChange={(status) =>
                  patch.mutate({
                    status: status as "active" | "ignored" | "cancelled",
                  })
                }
                options={[
                  { value: "active", label: "Active" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "ignored", label: "Not recurring" },
                ]}
              />
            </DetailRow>
            <DetailRow label="Next expected">
              {i.status === "active" && i.upcoming.length ? (
                <span className="flex flex-col items-end">
                  <span>{relativeDay(i.upcoming[0].date, today)}</span>
                  {i.upcoming.length > 1 ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      then{" "}
                      {i.upcoming
                        .slice(1, 3)
                        .map((u) => shortDate(u.date, today))
                        .join(", ")}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="font-normal text-muted-foreground">
                  Not expected
                </span>
              )}
            </DetailRow>
            <DetailRow label="Last">{fullDate(i.lastDate)}</DetailRow>
            <DetailRow label="Category">
              <Link
                to="/reports/categories/$code"
                params={{ code: i.category }}
                className="underline-offset-4 hover:underline"
              >
                {categories.label(i.category)}
              </Link>
            </DetailRow>
            {i.accountName ? (
              <DetailRow label="Account">
                <Link
                  to="/accounts/$id"
                  params={{ id: i.accountId }}
                  className="truncate underline-offset-4 hover:underline"
                >
                  {i.accountName}
                </Link>
              </DetailRow>
            ) : null}
          </DetailList>
        </SectionCard>
      </PageGrid>
      <SectionCard
        title="Transactions"
        flush
        action={
          i.count > i.transactions.length || i.count > 10 ? (
            <CardLink to="/transactions" search={{ merchant: i.key }}>
              All {i.count}
            </CardLink>
          ) : null
        }
      >
        <div className="border-t">
          <CompactTxnList
            items={i.transactions.slice(0, 12)}
            secondary="account"
          />
        </div>
      </SectionCard>
    </Page>
  )
}

/** The expected amount, edited in place: saved on Enter or when leaving. */
function ExpectedInput({
  cents,
  onCommit,
}: {
  cents: number
  onCommit: (cents: number | null) => void
}) {
  const initial = (cents / 100).toFixed(2)
  const [text, setText] = useState(initial)
  const commit = () => {
    const clean = text.replace(/[^0-9.]/g, "")
    if (!clean) {
      setText(initial)
      return
    }
    const next = Math.round(Number(clean) * 100)
    if (!Number.isFinite(next) || next <= 0) {
      setText(initial)
      return
    }
    setText((next / 100).toFixed(2))
    if (next !== cents) onCommit(next)
  }
  return (
    <InputGroup className="h-7 w-32">
      <InputGroupAddon>$</InputGroupAddon>
      <InputGroupInput
        aria-label="Expected amount"
        inputMode="decimal"
        value={text}
        className="text-right tabular-nums"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            setText(initial)
            e.currentTarget.blur()
          }
        }}
      />
    </InputGroup>
  )
}
