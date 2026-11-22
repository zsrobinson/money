import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageGrid,
  PageHeader,
  PageMeta,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Alert, AlertDescription, AlertTitle } from "@zsrobinson/shell/ui/alert"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { TriangleAlertIcon } from "lucide-react"
import { z } from "zod"
import {
  AccountDetails,
  AccountSettings,
  BalanceUpdates,
  MoneyInOut,
  StatementCard,
} from "@/components/account-detail"
import { accountGroup, MANUAL_TYPES } from "@/components/accounts"
import {
  Amount,
  CardLink,
  Loading,
  Meter,
  RangeSelect,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { RECONNECT_GUIDANCE } from "@/components/sources"
import { TxnRows } from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import {
  epoch,
  epochFullDate,
  mask,
  money,
  moneyTick,
  percent,
  syncLabel,
} from "@/lib/format"
import { accountQuery, metaQuery } from "@/lib/queries"
import type { Range } from "@/lib/types"

export const Route = createFileRoute("/accounts/$id")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: { crumbs: [{ label: "Accounts", to: "/accounts" }] },
  component: AccountPage,
})

const whole = (d: number) => money(Math.round(d * 100), { whole: true })

function AccountPage() {
  const { id } = Route.useParams()
  const { range } = Route.useSearch()
  const navigate = useNavigate({ from: "/accounts/$id" })
  const q = useQuery(accountQuery(id, range))
  const today = useQuery(metaQuery).data?.today
  usePageTitle(q.data?.account.name, true)
  if (q.isError)
    return (
      <Page>
        <QueryError
          title="This account failed to load"
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
  const {
    account: a,
    series,
    flows,
    recent,
    closedAt,
    liability,
    source,
  } = q.data
  const utilization =
    a.liability && a.limitCents
      ? Math.abs(a.balanceCents ?? 0) / a.limitCents
      : null
  const points = series.map((p) => ({
    time: epoch(p.date),
    balance: p.cents == null ? null : (a.liability ? -p.cents : p.cents) / 100,
  }))
  const kind = a.manual
    ? (MANUAL_TYPES.find((t) => t.value === a.manualType)?.label ?? "Other")
    : accountGroup(a).label
  const meta = [
    a.manual ? null : a.institution,
    kind,
    a.mask ? mask(a.mask) : null,
  ].filter(Boolean)
  const closed = a.availability !== "available" || closedAt
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle className="break-words">{a.name}</PageTitle>
          <PageMeta className="gap-x-1.5">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5 tabular-nums">
                {i > 0 ? (
                  <span aria-hidden className="text-muted-foreground/60">
                    ·
                  </span>
                ) : null}
                {m}
              </span>
            ))}
            {a.manual ? <Badge variant="outline">Manual</Badge> : null}
            {closed ? <Badge variant="secondary">Closed</Badge> : null}
            {!a.manual && a.sourceStatus !== "healthy" ? (
              <Badge variant="destructive">{syncLabel(a.sourceStatus)}</Badge>
            ) : null}
          </PageMeta>
        </div>
      </PageHeader>
      {source?.status === "error" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{source.institution} isn’t syncing</AlertTitle>
          <AlertDescription>{RECONNECT_GUIDANCE}</AlertDescription>
        </Alert>
      ) : null}
      <PageGrid layout="wide" className="items-stretch">
        <SectionCard
          title="Balance"
          info={
            q.data.estimated
              ? "Early history is estimated from transactions."
              : undefined
          }
          action={
            <RangeSelect
              value={q.data.range}
              onChange={(r: Range) =>
                void navigate({ search: { range: r }, replace: true })
              }
            />
          }
        >
          <StatRow className="mb-4">
            <Stat label={a.liability ? "Owed" : "Balance"}>
              <Amount
                cents={
                  a.balanceCents == null
                    ? null
                    : a.liability
                      ? -a.balanceCents
                      : a.balanceCents
                }
                currency={a.currency}
                tone="plain"
              />
            </Stat>
            {a.availableCents != null ? (
              <Stat label={a.liability ? "Available credit" : "Available"}>
                <Amount
                  cents={a.availableCents}
                  currency={a.currency}
                  tone="plain"
                />
              </Stat>
            ) : null}
            {utilization != null ? (
              <Stat
                label="Credit used"
                detail={`of ${money(a.limitCents, { whole: true })}`}
              >
                {percent(utilization)}
              </Stat>
            ) : null}
          </StatRow>
          {utilization != null ? (
            <div className="mb-4">
              <Meter
                label="Credit used"
                value={utilization}
                tone={utilization > 0.3 ? "over" : "default"}
              />
            </div>
          ) : null}
          <TrendChart
            label={`${a.name} balance over time`}
            baseline="data"
            data={points}
            config={{
              balance: {
                label: a.liability ? "Owed" : "Balance",
                color: "var(--chart-1)",
              },
            }}
            format={whole}
            formatTick={moneyTick}
            formatTime={epochFullDate}
            utc
            className="h-56"
          />
        </SectionCard>
        <AccountDetails a={a} holdings={q.data.holdings} closedAt={closedAt} />
      </PageGrid>
      {/* On a phone the bill comes before the long list of transactions. */}
      {liability ? (
        <div className="lg:hidden">
          <StatementCard l={liability} today={today} />
        </div>
      ) : null}
      <PageGrid layout="wide">
        <PageStack>
          {a.manual ? (
            <BalanceUpdates key={a.id} a={a} balances={q.data.balances} />
          ) : null}
          {!a.manual || q.data.transactions ? (
            <SectionCard
              title="Transactions"
              flush
              action={
                q.data.transactions ? (
                  <CardLink to="/transactions" search={{ account: a.id }}>
                    All {q.data.transactions}
                  </CardLink>
                ) : undefined
              }
            >
              {recent.length ? (
                <TxnRows items={recent} showAccount={false} />
              ) : (
                <p className="px-5 pb-5 text-sm text-muted-foreground">
                  No transactions from this account.
                </p>
              )}
            </SectionCard>
          ) : null}
        </PageStack>
        <PageStack>
          {liability ? (
            <div className="max-lg:hidden">
              <StatementCard l={liability} today={today} />
            </div>
          ) : null}
          <MoneyInOut a={a} flows={flows} />
          <AccountSettings key={a.id} a={a} closedAt={closedAt} />
        </PageStack>
      </PageGrid>
    </Page>
  )
}
