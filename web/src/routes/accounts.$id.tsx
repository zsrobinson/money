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
import { Field, FieldGroup, FieldLabel } from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { z } from "zod"
import {
  Amount,
  CardLink,
  InfoTip,
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
  mask,
  percent,
  sentenceCase,
  syncLabel,
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
  const hasMoved = flows.some(
    (f) =>
      f.incomeCents ||
      f.spendingCents ||
      f.transferInCents ||
      f.transferOutCents
  )
  // Each kind of movement the account has, so a card's payments show beside
  // its spending under a legend.
  const flowConfig = {
    ...(flows.some((f) => f.incomeCents)
      ? { in: { label: "Income", color: "var(--chart-positive)" } }
      : {}),
    ...(flows.some((f) => f.spendingCents)
      ? { out: { label: "Spending", color: "var(--chart-negative)" } }
      : {}),
    ...(flows.some((f) => f.transferInCents)
      ? {
          moveIn: {
            label: a.liability ? "Payments" : "Transfers in",
            color: "var(--chart-2)",
          },
        }
      : {}),
    ...(flows.some((f) => f.transferOutCents)
      ? {
          moveOut: {
            label: "Transfers out",
            color: "var(--chart-neutral)",
          },
        }
      : {}),
  }
  const kind = sentenceCase(a.subtype ?? a.type)
  const meta = [a.institution, kind, a.mask ? mask(a.mask) : null].filter(
    Boolean
  )
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle className="truncate">{a.name}</PageTitle>
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
            {a.availability !== "available" ? (
              <Badge variant="secondary">Closed</Badge>
            ) : null}
            {a.sourceStatus !== "healthy" ? (
              <Badge variant="destructive">{syncLabel(a.sourceStatus)}</Badge>
            ) : null}
          </PageMeta>
        </div>
      </PageHeader>
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
        <SectionCard title="Details" fill>
          <DetailList>
            <DetailRow label="Institution">{a.institution}</DetailRow>
            <DetailRow label="Type">{kind}</DetailRow>
            <DetailRow label="Bank name">
              {a.officialName ?? <Unavailable />}
            </DetailRow>
            <DetailRow label="Number">
              {a.mask ? mask(a.mask) : <Unavailable />}
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
      <PageGrid layout="wide" className="items-stretch">
        <SectionCard
          title="Transactions"
          flush
          fill
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
          {hasMoved ? (
            <SectionCard title="Money in and out">
              <TrendChart
                kind="bar"
                stacked
                label={`${a.name} money in and out by month`}
                data={flows.map((f) => ({
                  time: monthEpoch(f.month),
                  ...("in" in flowConfig ? { in: f.incomeCents / 100 } : {}),
                  ...("out" in flowConfig
                    ? { out: -f.spendingCents / 100 }
                    : {}),
                  ...("moveIn" in flowConfig
                    ? { moveIn: f.transferInCents / 100 }
                    : {}),
                  ...("moveOut" in flowConfig
                    ? { moveOut: -f.transferOutCents / 100 }
                    : {}),
                }))}
                config={flowConfig}
                format={whole}
                formatTick={moneyTick}
                formatTime={epochMonthYear}
                className="h-56"
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
          <span className="flex items-center gap-0.5">
            <FieldLabel htmlFor="account-hidden">Hide from lists</FieldLabel>
            <InfoTip label="About hiding">
              Its balance and transactions still count everywhere.
            </InfoTip>
          </span>
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}
