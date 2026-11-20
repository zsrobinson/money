import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
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
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { ArrowRightIcon } from "lucide-react"
import { z } from "zod"
import {
  Amount,
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
  epochMonth,
  money,
  monthEpoch,
  percent,
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
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle className="truncate">{a.name}</PageTitle>
          <PageMeta>
            <span>{a.institution}</span>
            <span>{titleCase(a.subtype ?? a.type)}</span>
            {a.mask ? <span className="tabular-nums">·· {a.mask}</span> : null}
            {a.availability !== "available" ? (
              <Badge variant="secondary">Closed</Badge>
            ) : null}
            {a.sourceStatus !== "healthy" ? (
              <Badge variant="destructive">Sync {a.sourceStatus}</Badge>
            ) : null}
          </PageMeta>
        </div>
      </PageHeader>
      <PageGrid layout="wide">
        <PageStack>
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
              data={series.map((p) => ({
                time: epoch(p.date),
                balance:
                  p.cents == null
                    ? null
                    : (a.liability ? -p.cents : p.cents) / 100,
              }))}
              config={{
                balance: {
                  label: a.liability ? "Owed" : "Balance",
                  color: "var(--chart-1)",
                },
              }}
              format={whole}
              formatTime={epochFullDate}
              className="h-56"
            />
            {q.data.estimated ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Early history is estimated from transactions.
              </p>
            ) : null}
          </SectionCard>
          {flows.some((f) => f.incomeCents || f.spendingCents) ? (
            <SectionCard title="Money in and out">
              <TrendChart
                kind="bar"
                stacked
                label={`${a.name} income and spending by month`}
                data={flows.map((f) => ({
                  time: monthEpoch(f.month),
                  in: f.incomeCents / 100,
                  out: -f.spendingCents / 100,
                }))}
                config={{
                  in: { label: "Income", color: "var(--chart-positive)" },
                  out: { label: "Spending", color: "var(--chart-negative)" },
                }}
                format={whole}
                formatTime={epochMonth}
                className="h-48"
              />
            </SectionCard>
          ) : null}
          <SectionCard
            title="Transactions"
            flush
            action={
              <Button
                size="sm"
                variant="ghost"
                render={<Link to="/transactions" search={{ account: a.id }} />}
                nativeButton={false}
              >
                All {q.data.transactions}
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
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
        </PageStack>
        <PageStack>
          <SectionCard title="Details">
            <DetailList>
              <DetailRow label="Institution">{a.institution}</DetailRow>
              <DetailRow label="Type">
                {titleCase(a.subtype ?? a.type)}
              </DetailRow>
              <DetailRow label="Bank name">
                {a.officialName ?? <Unavailable />}
              </DetailRow>
              <DetailRow label="Currency">{a.currency}</DetailRow>
              {a.limitCents != null ? (
                <DetailRow label="Credit limit">
                  {money(a.limitCents)}
                </DetailRow>
              ) : null}
              {q.data.holdings ? (
                <DetailRow label="Holdings">
                  <Link
                    to="/investments"
                    className="underline-offset-4 hover:underline"
                  >
                    {q.data.holdings}
                  </Link>
                </DetailRow>
              ) : null}
            </DetailList>
          </SectionCard>
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
              Its transactions still count in cash flow and budgets.
            </FieldDescription>
          </div>
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}
