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
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { z } from "zod"
import {
  Amount,
  EmptyState,
  Loading,
  RangeSelect,
  SectionCard,
  Stat,
  StatRow,
} from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import { assetType, epoch, epochFullDate, money, percent } from "@/lib/format"
import { investmentsQuery } from "@/lib/queries"
import type { Range } from "@/lib/types"

export const Route = createFileRoute("/investments")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: { crumbs: [{ label: "Investments", to: "/investments" }] },
  component: Investments,
})

function Investments() {
  usePageTitle("Investments")
  const { range = "1y" } = Route.useSearch()
  const navigate = useNavigate({ from: "/investments" })
  const q = useQuery(investmentsQuery(range))
  const d = q.data
  const first = d?.series[0]?.cents
  const last = d?.series.at(-1)?.cents
  return (
    <Page>
      <PageHeader>
        <PageTitle>Investments</PageTitle>
        <PageActions>
          <RangeSelect
            value={range}
            onChange={(r: Range) =>
              void navigate({ search: { range: r }, replace: true })
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
              label="Gain"
              detail={
                d.costBasisCents
                  ? `${percent(d.gainCents / d.costBasisCents, 1)} on cost`
                  : undefined
              }
            >
              <Amount cents={d.gainCents} tone="signed" whole />
            </Stat>
            {first != null && last != null ? (
              <Stat label="Change in range" detail="includes contributions">
                <Amount cents={last - first} tone="signed" whole />
              </Stat>
            ) : null}
          </StatRow>
          <PageGrid layout="wide">
            <SectionCard title="Value over time">
              <TrendChart
                label="Investment value over time"
                baseline="data"
                data={d.series.map((p) => ({
                  time: epoch(p.date),
                  value: p.cents / 100,
                }))}
                config={{ value: { label: "Value", color: "var(--chart-1)" } }}
                format={(v) => money(Math.round(v * 100), { whole: true })}
                formatTime={epochFullDate}
                className="h-56"
              />
            </SectionCard>
            <SectionCard title="Allocation">
              <DonutChart
                label="Allocation by asset type"
                totalLabel="invested"
                format={(v) => money(v, { whole: true, compact: v >= 1e8 })}
                data={d.allocation.map((a) => ({
                  key: a.type,
                  label: assetType(a.type),
                  value: a.cents,
                }))}
              />
            </SectionCard>
          </PageGrid>
          {d.accounts.map((a) => {
            const rows = d.holdings.filter((h) => h.accountId === a.id)
            if (!rows.length) return null
            return (
              <Card key={a.id} className="gap-0 overflow-x-auto py-0">
                <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                  <Link
                    to="/accounts/$id"
                    params={{ id: a.id }}
                    className="font-heading text-base font-medium underline-offset-4 hover:underline"
                  >
                    {a.name}
                  </Link>
                  <span className="text-sm font-medium tabular-nums">
                    {money(a.holdingsCents, { whole: true })}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Holding</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">
                        Quantity
                      </TableHead>
                      <TableHead className="hidden text-right md:table-cell">
                        Price
                      </TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="pr-5 text-right">Gain</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((h) => (
                      <TableRow key={h.securityId}>
                        <TableCell className="pl-5">
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {h.ticker ?? h.name}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {h.ticker ? h.name : assetType(h.type)}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {h.quantity.toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {h.price == null
                            ? "—"
                            : money(Math.round(h.price * 100))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(h.valueCents, { whole: true })}
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          {h.gainCents == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Amount cents={h.gainCents} tone="signed" whole />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )
          })}
        </PageStack>
      )}
    </Page>
  )
}
