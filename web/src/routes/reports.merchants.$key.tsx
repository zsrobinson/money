import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
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
  CardLink,
} from "@/components/money"
import { TxnRows } from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import {
  CADENCE,
  epochMonthYear,
  fullDate,
  money,
  monthEpoch,
  moneyTick,
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
          <MerchantMark
            name={d?.name}
            className="size-10 bg-card text-sm ring-1 ring-foreground/10"
          />
          <div className="flex min-w-0 flex-col">
            <PageTitle className="truncate">{d?.name ?? "Merchant"}</PageTitle>
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
          <PageGrid layout="wide" className="items-stretch">
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
                formatTime={epochMonthYear}
                formatTick={moneyTick}
                className="h-56"
              />
            </SectionCard>
            <SectionCard title="Details" fill>
              <DetailList>
                <DetailRow label="Category">
                  <Link
                    to="/reports/categories/$code"
                    params={{ code: d.category }}
                    className="underline-offset-4 hover:underline"
                  >
                    {d.categoryLabel}
                  </Link>
                </DetailRow>
                <DetailRow
                  label={
                    d.totalCents < 0 ? "Received, all time" : "Spent, all time"
                  }
                >
                  {money(Math.abs(d.totalCents), { whole: true })}
                </DetailRow>
                <DetailRow label="Transactions">{d.count}</DetailRow>
                <DetailRow label="Average">
                  {money(Math.abs(d.totalCents) / Math.max(1, d.count))}
                </DetailRow>
                <DetailRow label="First">{fullDate(d.first)}</DetailRow>
                <DetailRow label="Last">{fullDate(d.last)}</DetailRow>
                <DetailRow label="Repeats">
                  {d.recurring
                    ? (CADENCE[d.recurring.cadence] ?? d.recurring.cadence)
                    : "No regular pattern"}
                </DetailRow>
                {d.recurring ? (
                  <>
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
                  </>
                ) : null}
              </DetailList>
            </SectionCard>
          </PageGrid>
          <SectionCard
            title="Transactions"
            flush
            action={
              <CardLink to="/transactions" search={{ merchant: key }}>
                All {d.count}
              </CardLink>
            }
          >
            <TxnRows items={d.transactions.slice(0, 15)} secondary="account" />
          </SectionCard>
        </>
      )}
    </Page>
  )
}
