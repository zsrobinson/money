import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageGrid,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { investmentTxnLabel, isCash, quantity } from "@/components/investments"
import {
  Amount,
  EmptyState,
  Loading,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  assetType,
  epoch,
  epochFullDate,
  fullDate,
  money,
  moneyTick,
  percentChange,
  shortDate,
} from "@/lib/format"
import { holdingQuery, metaQuery } from "@/lib/queries"
import type { InvestmentTxn } from "@/lib/types"

/** "23.076 at $22.53" for a trade; nothing for cash movements. */
const trade = (t: InvestmentTxn) =>
  t.quantity && t.price != null
    ? `${quantity(Math.abs(t.quantity))} at ${money(Math.round(t.price * 100))}`
    : ""

export const Route = createFileRoute("/investments/$security")({
  staticData: { crumbs: [{ label: "Investments", to: "/investments" }] },
  component: HoldingPage,
})

function HoldingPage() {
  const { security } = Route.useParams()
  const q = useQuery(holdingQuery(security))
  const today = useQuery(metaQuery).data?.today
  const h = q.data
  const [all, setAll] = useState(false)
  usePageTitle(h ? (h.ticker ?? h.name) : undefined, true)
  if (q.isError)
    return (
      <Page>
        <QueryError
          title="This holding failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      </Page>
    )
  if (!h)
    return (
      <Page>
        <Loading rows={8} />
      </Page>
    )
  const cash = isCash(h)
  const more = h.transactions.length > 12
  const first = h.series[0]
  const change = first ? h.valueCents - first.cents : null
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle>{h.name}</PageTitle>
          <PageMeta>
            {h.ticker ? (
              <Badge variant="outline" className="font-mono">
                {h.ticker}
              </Badge>
            ) : null}
            <span>{assetType(h.type)}</span>
            {!cash && h.price != null ? (
              <span className="tabular-nums">
                {money(Math.round(h.price * 100))} a share
              </span>
            ) : null}
          </PageMeta>
        </div>
      </PageHeader>
      <StatRow>
        <Stat label="Value">{money(h.valueCents, { whole: true })}</Stat>
        {!cash ? <Stat label="Shares">{quantity(h.quantity)}</Stat> : null}
        <Stat label="Cost basis">
          {h.costBasisCents == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            money(h.costBasisCents, { whole: true })
          )}
        </Stat>
        <Stat
          label="Gain on cost"
          detail={
            h.gainCents != null && h.costBasisCents
              ? percentChange(h.gainCents / h.costBasisCents, 1)
              : undefined
          }
        >
          <Amount cents={h.gainCents} tone="signed" whole />
        </Stat>
      </StatRow>
      <PageGrid layout="wide">
        <SectionCard
          title="Value over time"
          footer={
            change != null && first ? (
              <p className="mr-auto text-sm text-muted-foreground">
                <Amount
                  cents={change}
                  tone="signed"
                  whole
                  className="font-medium"
                />{" "}
                since {fullDate(first.date)}, purchases included
              </p>
            ) : undefined
          }
        >
          <TrendChart
            label={`${h.ticker ?? h.name} value over time`}
            baseline="data"
            data={h.series.map((p) => ({
              time: epoch(p.date),
              value: p.cents / 100,
            }))}
            config={{ value: { label: "Value", color: "var(--chart-1)" } }}
            format={(v) => money(Math.round(v * 100), { whole: true })}
            formatTick={moneyTick}
            formatTime={epochFullDate}
            utc
            className="h-56"
          />
        </SectionCard>
        <SectionCard title="Accounts" flush>
          <ul className="flex flex-col border-t">
            {h.accounts.map((a) => (
              <li
                key={a.accountId}
                className="border-b border-border/70 last:border-b-0"
              >
                <Link
                  to="/accounts/$id"
                  params={{ id: a.accountId }}
                  className="flex min-h-13 items-center gap-3 px-4 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:px-5"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">{a.accountName}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {cash ? "" : `${quantity(a.quantity)} shares · `}
                      {a.costBasisCents == null
                        ? "No cost basis"
                        : `Cost ${money(a.costBasisCents, { whole: true })}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="text-sm font-medium tabular-nums">
                      {money(a.valueCents, { whole: true })}
                    </span>
                    {a.costBasisCents ? (
                      <span className="text-xs">
                        <Amount
                          cents={a.valueCents - a.costBasisCents}
                          tone="signed"
                          whole
                        />
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </PageGrid>
      <SectionCard
        title="Activity"
        flush
        action={
          more ? (
            <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${h.transactions.length}`}
            </Button>
          ) : null
        }
      >
        {h.transactions.length ? (
          <ul className="@container flex flex-col border-t">
            {(all ? h.transactions : h.transactions.slice(0, 12)).map((t) => (
              <li
                key={t.id}
                className="grid min-h-13 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/70 px-4 py-2 last:border-b-0 sm:px-5 @xl:grid-cols-[5.5rem_minmax(0,1fr)_12rem_7rem]"
              >
                <span className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums @xl:block">
                  {shortDate(t.date, today)}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    {investmentTxnLabel(t)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <span className="tabular-nums @xl:hidden">
                      {shortDate(t.date, today)} ·{" "}
                    </span>
                    {t.accountName}
                  </span>
                </span>
                <span className="hidden text-right text-sm text-muted-foreground tabular-nums @xl:block">
                  {trade(t)}
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <Amount
                    cents={t.amountCents}
                    className="text-right text-sm font-medium whitespace-nowrap"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums @xl:hidden">
                    {trade(t)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No activity from your bank" />
        )}
      </SectionCard>
    </Page>
  )
}
