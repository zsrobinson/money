import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { SearchIcon } from "lucide-react"
import { z } from "zod"
import {
  EmptyState,
  InfoTip,
  Loading,
  MerchantMark,
  RangeSelect,
} from "@/components/money"
import { ReportNav } from "@/components/report-nav"
import { usePageTitle } from "@/lib/crumb"
import { money, pluralize, shortDate } from "@/lib/format"
import { merchantReportQuery } from "@/lib/queries"
import type { Range } from "@/lib/types"

export const Route = createFileRoute("/reports/merchants/")({
  validateSearch: z.object({
    range: z.enum(["1m", "3m", "6m", "ytd", "1y", "all"]).optional(),
  }),
  staticData: { crumbs: [{ label: "Reports", to: "/reports" }] },
  component: Merchants,
})

function Merchants() {
  usePageTitle("Merchants")
  const { range = "6m" } = Route.useSearch()
  const navigate = useNavigate({ from: "/reports/merchants/" })
  const q = useQuery(merchantReportQuery(range))
  const [text, setText] = useState("")
  const needle = useDeferredValue(text.trim().toLocaleLowerCase())
  const rows = (q.data?.rows ?? []).filter(
    (r) => !needle || r.name.toLocaleLowerCase().includes(needle)
  )
  return (
    <Page>
      <PageHeader>
        <PageTitle>Reports</PageTitle>
        <PageActions>
          <RangeSelect
            value={range}
            onChange={(r: Range) =>
              void navigate({ search: { range: r }, replace: true })
            }
          />
        </PageActions>
      </PageHeader>
      {/* The sidebar lists report pages; a phone shows them here. */}
      <div className="md:hidden">
        <ReportNav range={range} />
      </div>
      {q.isError ? (
        <QueryError
          title="Merchants failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Filter merchants"
            placeholder="Filter merchants"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </InputGroup>
        {q.data ? (
          <PageMeta className="gap-x-0.5">
            <span>{pluralize(q.data.rows.length, "merchant")}</span>
            <InfoTip label="About this list">
              Purchases only; income, refunds and transfers are left out.
            </InfoTip>
          </PageMeta>
        ) : null}
      </div>
      <Card className="gap-0 overflow-x-auto py-0">
        {!q.data ? (
          <Loading rows={10} className="p-4" />
        ) : rows.length ? (
          <Table className="md:table-fixed">
            {/* Number columns get room; the merchant takes the rest. */}
            <colgroup>
              <col />
              <col className="hidden md:table-column md:w-44" />
              <col className="hidden sm:table-column sm:w-18" />
              <col className="hidden sm:table-column sm:w-26" />
              <col className="hidden md:table-column md:w-22" />
              <col className="w-28" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Merchant</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Visits
                </TableHead>
                <TableHead className="hidden text-right sm:table-cell">
                  Average
                </TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  Last
                </TableHead>
                <TableHead className="pr-5 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="max-w-0 pl-5 whitespace-normal">
                    <Link
                      to="/reports/merchants/$key"
                      params={{ key: r.key }}
                      className="flex min-w-0 items-center gap-3 font-medium underline-offset-4 hover:underline"
                    >
                      <MerchantMark name={r.name} className="size-7" />
                      <span className="line-clamp-2 md:truncate">{r.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden truncate text-muted-foreground md:table-cell">
                    {r.categoryLabel}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {r.count}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {money(r.averageCents)}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                    {shortDate(r.last)}
                  </TableCell>
                  <TableCell className="pr-5 text-right font-medium tabular-nums">
                    {money(r.cents, { whole: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="No merchants match">
            Try a shorter name or a longer range.
          </EmptyState>
        )}
      </Card>
    </Page>
  )
}
