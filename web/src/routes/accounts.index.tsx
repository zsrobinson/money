import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Page, PageHeader, PageStack, PageTitle } from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { z } from "zod"
import {
  Amount,
  Change,
  Loading,
  RangeSelect,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  accountKind,
  epoch,
  epochFullDate,
  money,
  mask,
  moneyTick,
  syncLabel,
} from "@/lib/format"
import { SourceList } from "@/components/sources"
import { accountsQuery, summaryQuery } from "@/lib/queries"
import type { AccountListItem, Range } from "@/lib/types"

export const Route = createFileRoute("/accounts/")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: { crumbs: [{ label: "Accounts", to: "/accounts" }] },
  component: Accounts,
})

const KINDS = ["Cash", "Credit cards", "Investments", "Loans", "Other"]

function Accounts() {
  usePageTitle("Accounts")
  const accounts = useQuery(accountsQuery)
  const { range } = Route.useSearch()
  const navigate = useNavigate({ from: "/accounts/" })
  // Totals come from the server: every open account except those you
  // excluded from net worth, hidden ones included.
  const summary = useQuery(summaryQuery(range))
  const nw = summary.data?.netWorth
  const points = (nw?.series ?? []).map((p) => ({
    time: epoch(p.date),
    assets: p.assets / 100,
    liabilities: p.liabilities / 100,
    net: p.net / 100,
  }))
  const [showHistorical, setShowHistorical] = useState(false)
  const list = accounts.data ?? []
  const open = list.filter((a) => a.availability === "available" && !a.hidden)
  const closed = list.filter((a) => a.availability !== "available" || a.hidden)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Accounts</PageTitle>
      </PageHeader>
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
            title="Assets and liabilities"
            action={
              summary.data ? (
                <RangeSelect
                  value={summary.data.range}
                  onChange={(r: Range) =>
                    void navigate({ search: { range: r }, replace: true })
                  }
                />
              ) : null
            }
          >
            <StatRow className="mb-4">
              <Stat
                label="Net worth"
                detail={
                  nw ? (
                    <Change cents={nw.changeCents} suffix="in this range" />
                  ) : undefined
                }
              >
                <Amount cents={nw?.cents} tone="plain" whole />
              </Stat>
              <Stat label="Assets">
                <Amount cents={nw?.assetsCents} tone="plain" whole />
              </Stat>
              <Stat label="Liabilities">
                <Amount cents={nw?.liabilitiesCents} tone="plain" whole />
              </Stat>
            </StatRow>
            {/* Liabilities get their own axis; on one scale with assets
                every line flattens. */}
            <TrendChart
              label="Assets and net worth over time"
              loading={!nw}
              baseline="data"
              data={points}
              config={{
                assets: { label: "Assets", color: "var(--chart-positive)" },
                net: { label: "Net worth", color: "var(--chart-1)" },
              }}
              format={(v) => money(Math.round(v * 100), { whole: true })}
              formatTime={epochFullDate}
              formatTick={moneyTick}
              utc
              className="h-60"
            />
            <TrendChart
              label="Liabilities over time"
              loading={!nw}
              baseline="data"
              data={points.map((p) => ({ time: p.time, owed: -p.liabilities }))}
              config={{
                owed: { label: "Liabilities", color: "var(--chart-negative)" },
              }}
              format={(v) => money(Math.round(v * 100), { whole: true })}
              formatTime={epochFullDate}
              formatTick={moneyTick}
              utc
              legend
              className="mt-2 h-40"
            />
          </SectionCard>
          {KINDS.map((kind) => {
            const group = open.filter((a) => accountKind(a) === kind)
            if (!group.length) return null
            const total = group.reduce((s, a) => s + (a.balanceCents ?? 0), 0)
            return (
              <SectionCard
                key={kind}
                title={kind}
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
          <SectionCard title="Connections" flush>
            <SourceList />
          </SectionCard>
        </PageStack>
      )}
    </Page>
  )
}

function AccountRows({ accounts }: { accounts: AccountListItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border/70">
      {accounts.map((a) => (
        <li key={a.id}>
          <Link
            to="/accounts/$id"
            params={{ id: a.id }}
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:grid-cols-[minmax(0,1fr)_8rem_7rem_8rem]"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{a.name}</span>
              {/* Wraps on a phone rather than cutting off a status. */}
              <span className="text-xs text-muted-foreground">
                {[
                  a.institution,
                  a.mask ? mask(a.mask) : null,
                  a.excludeNetWorth ? "Not in net worth" : null,
                  a.availability !== "available" ? "Closed" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {a.sourceStatus !== "healthy" &&
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
