import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
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
import { DetailList, DetailRow } from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { ListFilterIcon } from "lucide-react"
import {
  Loading,
  MerchantMark,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { TxnRows } from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import {
  CADENCE,
  epochMonth,
  fullDate,
  money,
  monthEpoch,
  shortDate,
} from "@/lib/format"
import { merchantDetailQuery } from "@/lib/queries"

export const Route = createFileRoute("/reports/merchants/$key")({
  staticData: {
    crumbs: [
      { label: "Reports", to: "/reports" },
      { label: "Merchants", to: "/reports/merchants" },
    ],
  },
  component: MerchantDetail,
})

function MerchantDetail() {
  const { key } = Route.useParams()
  const q = useQuery(merchantDetailQuery(key))
  usePageTitle(q.data?.name, true)
  const d = q.data
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 items-center gap-3">
          <MerchantMark name={d?.name} className="size-10 text-sm" />
          <div className="flex min-w-0 flex-col">
            <PageTitle className="truncate">{d?.name ?? "Merchant"}</PageTitle>
            {d ? (
              <PageMeta>
                <Link
                  to="/reports/categories/$code"
                  params={{ code: d.category }}
                  className="underline-offset-4 hover:underline"
                >
                  {d.categoryLabel}
                </Link>
                <span>Since {fullDate(d.first)}</span>
              </PageMeta>
            ) : null}
          </div>
        </div>
        <PageActions>
          {d ? (
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/rules/new" search={{ merchant: d.name }} />}
              nativeButton={false}
            >
              <ListFilterIcon data-icon="inline-start" />
              Create rule
            </Button>
          ) : null}
        </PageActions>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="This merchant failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={8} />
      ) : (
        <>
          <StatRow>
            <Stat
              label={d.totalCents < 0 ? "Received" : "Spent"}
              detail="all time"
            >
              {money(Math.abs(d.totalCents), { whole: true })}
            </Stat>
            <Stat label="Transactions">{d.count}</Stat>
            <Stat label="Average">
              {money(Math.abs(d.totalCents) / Math.max(1, d.count))}
            </Stat>
            <Stat label="Last">{shortDate(d.last)}</Stat>
          </StatRow>
          <PageGrid layout="wide">
            <PageStack>
              <SectionCard title="Last 12 months">
                <TrendChart
                  kind="bar"
                  label={`${d.name} by month`}
                  data={d.monthly.map((m) => ({
                    time: monthEpoch(m.month),
                    amount: Math.abs(m.cents) / 100,
                  }))}
                  config={{
                    amount: {
                      label: d.totalCents < 0 ? "Received" : "Spent",
                      color: "var(--chart-1)",
                    },
                  }}
                  format={(v) => money(Math.round(v * 100), { whole: true })}
                  formatTime={epochMonth}
                  className="h-48"
                />
              </SectionCard>
              <SectionCard
                title="Transactions"
                flush
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    render={
                      <Link to="/transactions" search={{ merchant: key }} />
                    }
                    nativeButton={false}
                  >
                    All {d.count}
                  </Button>
                }
              >
                <TxnRows items={d.transactions.slice(0, 15)} />
              </SectionCard>
            </PageStack>
            <SectionCard title="Recurring">
              {d.recurring ? (
                <DetailList>
                  <DetailRow label="Repeats">
                    {CADENCE[d.recurring.cadence] ?? d.recurring.cadence}
                  </DetailRow>
                  <DetailRow label="Usual amount">
                    {money(Math.abs(d.recurring.amountCents))}
                  </DetailRow>
                  <DetailRow label="Next expected">
                    {d.recurring.status === "active"
                      ? fullDate(d.recurring.nextDate)
                      : "Not expected"}
                  </DetailRow>
                  <DetailRow label="Status">
                    <Link
                      to="/recurring"
                      className="underline-offset-4 hover:underline"
                    >
                      {d.recurring.status === "active"
                        ? "Active"
                        : d.recurring.status === "inactive"
                          ? "Stopped"
                          : d.recurring.status === "cancelled"
                            ? "Cancelled"
                            : "Ignored"}
                    </Link>
                  </DetailRow>
                </DetailList>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No regular pattern found for this merchant.
                </p>
              )}
            </SectionCard>
          </PageGrid>
        </>
      )}
    </Page>
  )
}
