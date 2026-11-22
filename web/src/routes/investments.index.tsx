import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { DonutChart, TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { DetailList, DetailRow } from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Tabs, TabsList, TabsTrigger } from "@zsrobinson/shell/ui/tabs"
import { z } from "zod"
import { HoldingRows } from "@/components/investments"
import {
  Amount,
  EmptyState,
  InfoTip,
  Loading,
  RangeSelect,
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
} from "@/lib/format"
import { investmentsQuery } from "@/lib/queries"
import type { Performance, Range } from "@/lib/types"

export const Route = createFileRoute("/investments/")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
    holdings: z.enum(["combined", "account"]).optional().catch(undefined),
  }),
  staticData: { crumbs: [{ label: "Investments", to: "/investments" }] },
  component: Investments,
})

function Investments() {
  usePageTitle("Investments")
  const { range = "1y", holdings: by = "combined" } = Route.useSearch()
  const navigate = useNavigate({ from: "/investments/" })
  const q = useQuery(investmentsQuery(range))
  const d = q.data
  const first = d?.series[0]
  const last = d?.series.at(-1)
  const change = first && last ? last.cents - first.cents : null
  const points = (d?.series ?? []).map((p) => ({
    time: epoch(p.date),
    value: p.cents / 100,
  }))
  const allocation = d ? (
    <SectionCard title="Allocation" fill>
      <DonutChart
        label="Allocation by asset type"
        totalLabel="invested"
        format={(v) => money(v, { whole: true })}
        data={d.allocation.map((a) => ({
          key: a.type,
          label: assetType(a.type),
          value: a.cents,
        }))}
      />
    </SectionCard>
  ) : null
  const holdings = d ? (
    <SectionCard
      title="Holdings"
      flush
      action={
        <Tabs
          value={by}
          onValueChange={(v) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                holdings: v === "account" ? "account" : undefined,
              }),
              replace: true,
            })
          }
        >
          <TabsList>
            <TabsTrigger value="combined" className="px-2.5">
              Combined
            </TabsTrigger>
            <TabsTrigger value="account" className="px-2.5">
              By account
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      {by === "combined" ? (
        <HoldingRows groups={[{ key: "all", rows: d.positions }]} />
      ) : (
        <HoldingRows
          groups={d.accounts
            .map((a) => ({
              key: a.id,
              heading: (
                <>
                  <Link
                    to="/accounts/$id"
                    params={{ id: a.id }}
                    className="underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {a.name}
                  </Link>
                  <span className="tabular-nums">
                    {money(a.holdingsCents, { whole: true })}
                  </span>
                </>
              ),
              rows: d.holdings.filter((h) => h.accountId === a.id),
            }))
            .filter((g) => g.rows.length)}
        />
      )}
    </SectionCard>
  ) : null
  return (
    <Page>
      <PageHeader>
        <PageTitle>Investments</PageTitle>
        <PageActions>
          <RangeSelect
            value={range}
            onChange={(r: Range) =>
              void navigate({
                search: (prev) => ({ ...prev, range: r }),
                replace: true,
              })
            }
          />
        </PageActions>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="Investments failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={8} />
      ) : !d.holdings.length ? (
        <EmptyState title="No investment accounts">
          Connect a brokerage or retirement account to see holdings here.
        </EmptyState>
      ) : (
        <PageStack>
          <StatRow>
            <Stat label="Value">{money(d.totalCents, { whole: true })}</Stat>
            <Stat
              label="Gain on cost"
              detail={
                d.costBasisCents
                  ? `${percentChange(d.gainCents / d.costBasisCents, 1)} on ${money(d.costBasisCents, { whole: true })}`
                  : undefined
              }
            >
              <Amount cents={d.gainCents} tone="signed" whole />
            </Stat>
            {!d.performance && change != null ? (
              <Stat label="Value change (includes deposits)">
                <Amount cents={change} tone="signed" whole />
              </Stat>
            ) : null}
          </StatRow>
          <PageGrid layout="wide" className="items-stretch">
            <SectionCard
              title="Value over time"
              fill
              footer={
                change != null && first ? (
                  <p className="mr-auto text-sm text-muted-foreground">
                    <Amount
                      cents={change}
                      tone="signed"
                      whole
                      className="font-medium"
                    />{" "}
                    since {fullDate(first.date)}
                    {d.performance ? "" : ", deposits included"}
                  </p>
                ) : undefined
              }
            >
              <TrendChart
                label="Investment value over time"
                baseline="data"
                data={points}
                config={{ value: { label: "Value", color: "var(--chart-1)" } }}
                format={(v) => money(Math.round(v * 100), { whole: true })}
                formatTick={moneyTick}
                formatTime={epochFullDate}
                utc
                className="h-full min-h-60"
              />
            </SectionCard>
            {d.performance ? <PerformanceCard p={d.performance} /> : allocation}
          </PageGrid>
          {d.performance ? (
            <PageGrid layout="wide">
              {holdings}
              {allocation}
            </PageGrid>
          ) : (
            holdings
          )}
        </PageStack>
      )}
    </Page>
  )
}

/**
 * How the value moved over the range: money put in, and the market's part,
 * with dividends and interest and a simple return beside them.
 */
function PerformanceCard({ p }: { p: Performance }) {
  const change = p.endCents - p.startCents
  return (
    <SectionCard
      title="Performance"
      fill
      info="Value change is the money you put in plus the market change. Return is the market change against the starting value plus half the contributions."
      action={
        <span className="text-sm text-muted-foreground">
          Since {fullDate(p.from)}
        </span>
      }
    >
      <StatRow className="mb-4">
        <Stat label="Value change">
          <Amount cents={change} tone="signed" whole />
        </Stat>
        <Stat label="Return">
          {p.returnRate == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span
              className={
                p.returnRate > 0
                  ? "text-positive"
                  : p.returnRate < 0
                    ? "text-negative"
                    : ""
              }
            >
              {percentChange(p.returnRate, 1)}
            </span>
          )}
        </Stat>
      </StatRow>
      <DetailList>
        <DetailRow label="Starting value">
          {money(p.startCents, { whole: true })}
        </DetailRow>
        <DetailRow label="Contributions">
          {money(p.contributionsCents, { sign: true, whole: true })}
        </DetailRow>
        <DetailRow label="Market change">
          <Amount cents={p.marketCents} tone="signed" whole />
        </DetailRow>
        <DetailRow label="Value now">
          {money(p.endCents, { whole: true })}
        </DetailRow>
        <DetailRow
          label={
            <span className="flex items-center gap-0.5">
              Dividends and interest
              <InfoTip label="About dividends and interest">
                Paid out over the range; already part of the market change.
              </InfoTip>
            </span>
          }
        >
          <Amount cents={p.incomeCents} tone="plain" whole />
        </DetailRow>
      </DetailList>
    </SectionCard>
  )
}
