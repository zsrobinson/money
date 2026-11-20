import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Page, PageHeader, PageStack, PageTitle } from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Amount,
  Change,
  Loading,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import { accountKind, money } from "@/lib/format"
import { accountsQuery } from "@/lib/queries"
import type { AccountListItem } from "@/lib/types"

export const Route = createFileRoute("/accounts/")({
  staticData: { crumbs: [{ label: "Accounts", to: "/accounts" }] },
  component: Accounts,
})

const KINDS = ["Cash", "Credit cards", "Investments", "Loans", "Other"]

function Accounts() {
  usePageTitle("Accounts")
  const accounts = useQuery(accountsQuery)
  const [showHistorical, setShowHistorical] = useState(false)
  const list = accounts.data ?? []
  const open = list.filter((a) => a.availability === "available" && !a.hidden)
  const closed = list.filter((a) => a.availability !== "available" || a.hidden)
  const counted = open.filter((a) => !a.excludeNetWorth)
  const assets = counted.reduce(
    (s, a) => s + Math.max(0, a.balanceCents ?? 0),
    0
  )
  const debts = counted.reduce(
    (s, a) => s + Math.min(0, a.balanceCents ?? 0),
    0
  )
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
          <StatRow>
            <Stat label="Net worth">
              <Amount cents={assets + debts} tone="plain" whole />
            </Stat>
            <Stat label="Assets">
              <Amount cents={assets} tone="plain" whole />
            </Stat>
            <Stat label="Liabilities">
              <Amount cents={debts} tone="plain" whole />
            </Stat>
          </StatRow>
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
              <span className="truncate text-xs text-muted-foreground">
                {a.institution}
                {a.mask ? ` ·· ${a.mask}` : ""}
                {a.excludeNetWorth ? " · Not in net worth" : ""}
                {a.availability !== "available" ? " · Closed" : ""}
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
                      color: a.liability
                        ? "var(--chart-neutral)"
                        : "var(--chart-1)",
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
