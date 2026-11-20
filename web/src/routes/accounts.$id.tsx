import { useState } from "react"
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
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { z } from "zod"
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
import { TxnRows } from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import {
  epoch,
  epochFullDate,
  epochMonthYear,
  money,
  moneyTick,
  monthEpoch,
  percent,
  timeTick,
  titleCase,
} from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { accountQuery } from "@/lib/queries"
import type { Account, Range } from "@/lib/types"

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
  const { account: a, series, flows, recent } = q.data
  const utilization =
    a.liability && a.limitCents
      ? Math.abs(a.balanceCents ?? 0) / a.limitCents
      : null
  const points = series.map((p) => ({
    time: epoch(p.date),
    balance: p.cents == null ? null : (a.liability ? -p.cents : p.cents) / 100,
  }))
  const hasIn = flows.some((f) => f.incomeCents)
  const hasOut = flows.some((f) => f.spendingCents)
  const meta = [
    a.institution,
    titleCase(a.subtype ?? a.type),
    a.mask ? `·· ${a.mask}` : null,
  ].filter(Boolean)
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle className="truncate">{a.name}</PageTitle>
          <PageMeta className="gap-x-1.5">
            {meta.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5 tabular-nums">
                {i > 0 ? (
                  <span aria-hidden className="text-border">
                    ·
                  </span>
                ) : null}
                {m}
              </span>
            ))}
            {a.availability !== "available" ? (
              <Badge variant="secondary">Closed</Badge>
            ) : null}
            {a.sourceStatus !== "healthy" ? (
              <Badge variant="destructive">
                Sync {a.sourceStatus === "stale" ? "behind" : a.sourceStatus}
              </Badge>
            ) : null}
          </PageMeta>
        </div>
      </PageHeader>
      <PageGrid layout="wide" className="items-stretch">
        <SectionCard
          title="Balance"
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
            formatTimeTick={timeTick(points)}
            className="h-56"
          />
          {q.data.estimated ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Early history is estimated from transactions.
            </p>
          ) : null}
        </SectionCard>
        <SectionCard title="Details" className="h-full">
          <DetailList>
            <DetailRow label="Institution">{a.institution}</DetailRow>
            <DetailRow label="Type">{titleCase(a.subtype ?? a.type)}</DetailRow>
            <DetailRow label="Bank name">
              {a.officialName ?? <Unavailable />}
            </DetailRow>
            <DetailRow label="Number">
              {a.mask ? `·· ${a.mask}` : <Unavailable />}
            </DetailRow>
            <DetailRow label="Currency">{a.currency}</DetailRow>
            {a.limitCents != null ? (
              <DetailRow label="Credit limit">{money(a.limitCents)}</DetailRow>
            ) : null}
            <DetailRow label="In net worth">
              {a.excludeNetWorth ? "No" : "Yes"}
            </DetailRow>
            {q.data.holdings ? (
              <DetailRow label="Holdings">{q.data.holdings}</DetailRow>
            ) : null}
          </DetailList>
        </SectionCard>
      </PageGrid>
      <PageGrid layout="wide">
        <SectionCard
          title="Transactions"
          flush
          action={
            <CardLink to="/transactions" search={{ account: a.id }}>
              All {q.data.transactions}
            </CardLink>
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
        <PageStack>
          {hasIn || hasOut ? (
            <SectionCard title="Money in and out">
              <TrendChart
                kind="bar"
                stacked
                label={`${a.name} income and spending by month`}
                data={flows.map((f) => ({
                  time: monthEpoch(f.month),
                  ...(hasIn ? { in: f.incomeCents / 100 } : {}),
                  ...(hasOut ? { out: -f.spendingCents / 100 } : {}),
                }))}
                config={{
                  ...(hasIn
                    ? {
                        in: { label: "Income", color: "var(--chart-positive)" },
                      }
                    : {}),
                  ...(hasOut
                    ? {
                        out: {
                          label: "Spending",
                          color: "var(--chart-negative)",
                        },
                      }
                    : {}),
                }}
                format={whole}
                formatTick={moneyTick}
                formatTime={epochMonthYear}
                className="h-44"
              />
            </SectionCard>
          ) : null}
          <AccountSettings key={a.id} a={a} />
        </PageStack>
      </PageGrid>
    </Page>
  )
}

function AccountSettings({ a }: { a: Account }) {
  const save = useSend<Record<string, unknown>>(
    "PATCH",
    `/api/accounts/${a.id}`,
    { success: "Account updated" }
  )
  const [name, setName] = useState(a.name === a.label ? "" : a.name)
  return (
    <SectionCard title="Settings">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="account-name">Display name</FieldLabel>
          <Input
            id="account-name"
            value={name}
            placeholder={a.label}
            onChange={(e) => setName(e.target.value)}
            onBlur={() =>
              name.trim() !== (a.name === a.label ? "" : a.name) &&
              save.mutate({ displayName: name.trim() || null })
            }
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="account-networth"
            checked={!a.excludeNetWorth}
            onCheckedChange={(on) => save.mutate({ excludeNetWorth: !on })}
          />
          <FieldLabel htmlFor="account-networth">Count in net worth</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="account-hidden"
            checked={a.hidden}
            onCheckedChange={(on) => save.mutate({ hidden: on })}
          />
          <div className="flex flex-col">
            <FieldLabel htmlFor="account-hidden">Hide from lists</FieldLabel>
            <FieldDescription>
              Its balance and transactions still count everywhere.
            </FieldDescription>
          </div>
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}
