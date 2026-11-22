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
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { PlusIcon } from "lucide-react"
import { z } from "zod"
import {
  ACCOUNT_GROUPS,
  accountGroup,
  NetWorthChanges,
  NetWorthStack,
} from "@/components/accounts"
import {
  Amount,
  Change,
  Loading,
  RangeSelect,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { ConnectionStatusLine } from "@/components/sources"
import { usePageTitle } from "@/lib/crumb"
import { mask, money, syncLabel } from "@/lib/format"
import { accountsQuery, networthQuery } from "@/lib/queries"
import type { AccountListItem, NetWorthByType, Range } from "@/lib/types"

export const Route = createFileRoute("/accounts/")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: { crumbs: [{ label: "Accounts", to: "/accounts" }] },
  component: Accounts,
})

/** Assets, debts and net worth on the last day of the series. */
function totals(nw: NetWorthByType | undefined) {
  const first = nw?.series[0]
  const last = nw?.series.at(-1)
  if (!nw || !first || !last) return null
  let assets = 0
  let debts = 0
  for (const g of nw.groups)
    if (last[g] >= 0) assets += last[g]
    else debts -= last[g]
  return { net: last.net, change: last.net - first.net, assets, debts }
}

function Accounts() {
  usePageTitle("Accounts")
  const accounts = useQuery(accountsQuery)
  const { range } = Route.useSearch()
  const navigate = useNavigate({ from: "/accounts/" })
  const networth = useQuery(networthQuery(range))
  const t = totals(networth.data)
  const [showHistorical, setShowHistorical] = useState(false)
  const list = accounts.data ?? []
  const open = list.filter((a) => a.availability === "available" && !a.hidden)
  const closed = list.filter((a) => a.availability !== "available" || a.hidden)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Accounts</PageTitle>
        <PageActions>
          <Button
            size="sm"
            render={<Link to="/accounts/new" />}
            nativeButton={false}
          >
            <PlusIcon data-icon="inline-start" />
            Add account
          </Button>
        </PageActions>
      </PageHeader>
      <ConnectionStatusLine />
      {accounts.isError ? (
        <QueryError
          title="Accounts failed to load"
          error={accounts.error}
          onRetry={() => accounts.refetch()}
        />
      ) : null}
      {!accounts.data ? (
        <Loading rows={8} />
      ) : (
        <PageStack>
          <SectionCard
            title="Net worth"
            action={
              networth.data ? (
                <RangeSelect
                  value={networth.data.range}
                  onChange={(r: Range) =>
                    void navigate({ search: { range: r }, replace: true })
                  }
                />
              ) : null
            }
            footer={
              networth.data ? (
                <div className="w-full">
                  <NetWorthChanges data={networth.data} />
                </div>
              ) : undefined
            }
          >
            <StatRow className="mb-4">
              <Stat
                label="Net worth"
                detail={
                  t ? <Change cents={t.change} suffix="in this range" /> : null
                }
              >
                <Amount cents={t?.net} tone="plain" whole />
              </Stat>
              <Stat label="Assets">
                <Amount cents={t?.assets} tone="plain" whole />
              </Stat>
              <Stat label="Liabilities">
                <Amount cents={t?.debts} tone="plain" whole />
              </Stat>
            </StatRow>
            {networth.data ? (
              <NetWorthStack data={networth.data} className="h-72" />
            ) : (
              <Loading rows={1} className="h-72 [&>*]:h-72" />
            )}
          </SectionCard>
          {ACCOUNT_GROUPS.map((g) => {
            const group = open.filter((a) => accountGroup(a).key === g.key)
            if (!group.length) return null
            const total = group.reduce((s, a) => s + (a.balanceCents ?? 0), 0)
            return (
              <SectionCard
                key={g.key}
                title={g.label}
                flush
                action={
                  <span className="text-sm font-medium tabular-nums">
                    {money(total, { whole: true })}
                  </span>
                }
              >
                <AccountRows accounts={group} />
              </SectionCard>
            )
          })}
          {closed.length ? (
            <SectionCard
              title="Closed and hidden"
              flush
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowHistorical((v) => !v)}
                  aria-expanded={showHistorical}
                >
                  {showHistorical ? "Hide" : `Show ${closed.length}`}
                </Button>
              }
            >
              {showHistorical ? (
                <AccountRows accounts={closed} />
              ) : (
                <div className="pb-1" />
              )}
            </SectionCard>
          ) : null}
        </PageStack>
      )}
    </Page>
  )
}

function AccountRows({ accounts }: { accounts: AccountListItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border/70 border-t">
      {accounts.map((a) => (
        <li key={a.id}>
          <Link
            to="/accounts/$id"
            params={{ id: a.id }}
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:grid-cols-[minmax(0,1fr)_8rem_7rem_8rem]"
          >
            <span className="flex min-w-0 flex-col">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium break-words">
                  {a.name}
                </span>
                {a.manual ? (
                  <Badge variant="outline" className="font-normal">
                    Manual
                  </Badge>
                ) : null}
              </span>
              {/* Wraps on a phone rather than cutting off a status. */}
              <span className="text-xs text-muted-foreground">
                {[
                  a.manual ? null : a.institution,
                  a.mask ? mask(a.mask) : null,
                  a.excludeNetWorth ? "Not in net worth" : null,
                  a.hidden ? "Hidden" : null,
                  a.availability !== "available" ? "Closed" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {!a.manual &&
                a.sourceStatus !== "healthy" &&
                a.availability === "available" ? (
                  <span className="text-negative">
                    {" · "}
                    {syncLabel(a.sourceStatus)}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="hidden sm:block" aria-hidden>
              {a.spark.some((v) => v != null) ? (
                <TrendChart
                  sparkline
                  label={`${a.name} balance, last 90 days`}
                  className="h-8"
                  data={a.spark.map((v, i) => ({
                    time: i,
                    balance: v == null ? null : v / 100,
                  }))}
                  config={{
                    balance: {
                      label: "Balance",
                      color: "var(--chart-1)",
                    },
                  }}
                />
              ) : null}
            </span>
            <span className="hidden text-right text-xs sm:block">
              {a.changeCents != null ? <Change cents={a.changeCents} /> : null}
              <span className="block text-muted-foreground">30 days</span>
            </span>
            <Amount
              cents={a.balanceCents}
              currency={a.currency}
              tone="plain"
              className="text-right text-sm font-medium"
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}
