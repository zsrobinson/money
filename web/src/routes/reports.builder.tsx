import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { DonutChart, TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import {
  ChartColumnBigIcon,
  ChartColumnStackedIcon,
  ChartLineIcon,
  ChartPieIcon,
  TableIcon,
} from "lucide-react"
import { z } from "zod"
import { CategoryPicker } from "@/components/category-picker"
import { CATEGORY_COLORS, categoryColor } from "@/components/category-style"
import { MerchantFilter } from "@/components/merchant-filter"
import { Loading, SectionCard, Segmented } from "@/components/money"
import { Choice, DatePicker } from "@/components/pickers"
import { ReportNav } from "@/components/report-nav"
import { usePageTitle } from "@/lib/crumb"
import {
  addMonths,
  epochMonthYear,
  epoch,
  fullDate,
  money,
  moneyTick,
  percent,
  shortDate,
} from "@/lib/format"
import {
  accountsQuery,
  categoriesQuery,
  metaQuery,
  reportBuildQuery,
  tagsQuery,
} from "@/lib/queries"
import type { BuiltReport, GroupBy, Interval, Measure } from "@/lib/types"

const PRESETS = ["3m", "6m", "12m", "ytd", "last-year", "custom"] as const
type Preset = (typeof PRESETS)[number]
const CHARTS = ["bar", "stacked", "line", "donut", "table"] as const

export const Route = createFileRoute("/reports/builder")({
  validateSearch: z.object({
    measure: z.enum(["spending", "income", "net"]).optional().catch(undefined),
    by: z
      .enum(["category", "group", "merchant", "tag", "account", "none"])
      .optional()
      .catch(undefined),
    preset: z.enum(PRESETS).optional().catch(undefined),
    from: z.string().optional(),
    to: z.string().optional(),
    interval: z
      .enum(["week", "month", "quarter", "year"])
      .optional()
      .catch(undefined),
    chart: z.enum(CHARTS).optional().catch(undefined),
    compare: z.enum(["previous", "year"]).optional().catch(undefined),
    account: z.string().optional(),
    tag: z.string().optional(),
    category: z.string().optional(),
    merchant: z.string().optional(),
    merchantName: z.string().optional(),
  }),
  staticData: { crumbs: [{ label: "Reports", to: "/reports" }] },
  component: Builder,
})

const MEASURE_LABEL: Record<Measure, string> = {
  spending: "Spending",
  income: "Income",
  net: "Cash flow",
}
const BY_LABEL: Record<GroupBy, string> = {
  group: "Group",
  category: "Category",
  merchant: "Merchant",
  tag: "Tag",
  account: "Account",
  none: "Nothing",
}
const TAG_HUE: Record<string, string> = {
  re: "red",
  or: "orange",
  ye: "yellow",
  gr: "green",
  cy: "cyan",
  bl: "blue",
  pu: "purple",
  ma: "magenta",
}

/** Whole months ending with the last full one, or this or last year. */
function presetRange(preset: Preset, today: string) {
  const last = addMonths(today.slice(0, 7), -1)
  const end = (m: string) => {
    const [y, mo] = m.split("-").map(Number)
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
  }
  const year = Number(today.slice(0, 4))
  if (preset === "ytd") return { from: `${year}-01-01`, to: today }
  if (preset === "last-year")
    return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }
  const n = preset === "3m" ? 3 : preset === "12m" ? 12 : 6
  return { from: `${addMonths(last, -(n - 1))}-01`, to: end(last) }
}

function bucketLabel(key: string, interval: Interval) {
  if (interval === "month") return epochMonthYear(epoch(`${key}-01`))
  if (interval === "week") return `Week of ${shortDate(key)}`
  if (interval === "quarter") return `${key.slice(5)} ${key.slice(0, 4)}`
  return key
}

/** A fixed colour per series: a category's own, a tag's hue, else by rank. */
function seriesColor(s: BuiltReport["series"][number], i: number, by: GroupBy) {
  if (s.key === "other") return "var(--chart-neutral)"
  if (by === "category" || by === "group") return categoryColor(s.color)
  if (by === "tag" && s.color) return categoryColor(TAG_HUE[s.color])
  if (by === "none") return "var(--chart-1)"
  return categoryColor(CATEGORY_COLORS[(i * 5) % CATEGORY_COLORS.length])
}

function Builder() {
  usePageTitle("Report builder")
  const s = Route.useSearch()
  const navigate = useNavigate({ from: "/reports/builder" })
  const set = (patch: Partial<typeof s>) =>
    void navigate({
      search: (p) => ({ ...p, ...patch }),
      replace: true,
      resetScroll: false,
    })
  const meta = useQuery(metaQuery)
  const categories = useQuery(categoriesQuery)
  const accounts = useQuery(accountsQuery)
  const tags = useQuery(tagsQuery)
  const measure = s.measure ?? "spending"
  const by = s.by ?? "group"
  const preset = s.preset ?? "6m"
  const interval = s.interval ?? "month"
  const chart = s.chart ?? (by === "none" ? "bar" : "stacked")
  const today = meta.data?.today
  const range =
    preset === "custom" && s.from && s.to
      ? { from: s.from, to: s.to }
      : today
        ? presetRange(preset === "custom" ? "6m" : preset, today)
        : null
  const q = useQuery({
    ...reportBuildQuery({
      measure,
      by,
      from: range?.from,
      to: range?.to,
      interval,
      compare: s.compare,
      account: s.account,
      tag: s.tag,
      category: s.category,
      merchant: s.merchant,
      limit: chart === "table" ? 20 : 8,
    }),
    enabled: Boolean(range),
  })
  const d = q.data
  const format = (c: number) => money(c, { whole: true })
  const dollars = (v: number) => format(Math.round(v * 100))
  return (
    <Page>
      <PageHeader>
        <PageTitle>Reports</PageTitle>
      </PageHeader>
      <ReportNav range="6m" />
      <Card className="gap-3 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Measure"
            value={measure}
            onChange={(v) => set({ measure: v === "spending" ? undefined : v })}
            options={(["spending", "income", "net"] as const).map((m) => ({
              value: m,
              label: MEASURE_LABEL[m],
            }))}
          />
          <span className="text-sm text-muted-foreground">by</span>
          <Choice
            aria-label="Group by"
            size="sm"
            className="w-32"
            value={by}
            onChange={(v) =>
              set({ by: v === "group" ? undefined : (v as GroupBy) })
            }
            options={(Object.keys(BY_LABEL) as GroupBy[]).map((k) => ({
              value: k,
              label: BY_LABEL[k],
            }))}
          />
          <span className="text-sm text-muted-foreground">per</span>
          <Choice
            aria-label="Interval"
            size="sm"
            className="w-28"
            value={interval}
            onChange={(v) =>
              set({
                interval:
                  v === "month"
                    ? undefined
                    : (v as "week" | "quarter" | "year"),
              })
            }
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "quarter", label: "Quarter" },
              { value: "year", label: "Year" },
            ]}
          />
          <Segmented
            label="Chart"
            className="sm:ml-auto"
            value={chart}
            onChange={(v) => set({ chart: v })}
            options={[
              { value: "bar", label: <ChartColumnBigIcon />, title: "Bars" },
              {
                value: "stacked",
                label: <ChartColumnStackedIcon />,
                title: "Stacked bars",
              },
              { value: "line", label: <ChartLineIcon />, title: "Lines" },
              { value: "donut", label: <ChartPieIcon />, title: "Donut" },
              { value: "table", label: <TableIcon />, title: "Table" },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Choice
            aria-label="Date range"
            size="sm"
            className="sm:w-40"
            value={preset}
            onChange={(v) =>
              set({
                preset: v === "6m" ? undefined : (v as Preset),
                ...(v === "custom" && range
                  ? range
                  : { from: undefined, to: undefined }),
              })
            }
            options={[
              { value: "3m", label: "Last 3 months" },
              { value: "6m", label: "Last 6 months" },
              { value: "12m", label: "Last 12 months" },
              { value: "ytd", label: "This year" },
              { value: "last-year", label: "Last year" },
              { value: "custom", label: "Custom dates" },
            ]}
          />
          <Choice
            aria-label="Compare with"
            size="sm"
            className="sm:w-48"
            value={s.compare ?? ""}
            placeholder="No comparison"
            onChange={(v) =>
              set({
                compare: (v || undefined) as "previous" | "year" | undefined,
              })
            }
            options={[
              { value: "previous", label: "vs the period before" },
              { value: "year", label: "vs a year earlier" },
            ]}
          />
          {preset === "custom" ? (
            <>
              <DatePicker
                aria-label="From"
                className="sm:w-40"
                clearable={false}
                value={s.from ?? range?.from ?? ""}
                onChange={(v) => set({ from: v })}
              />
              <DatePicker
                aria-label="To"
                className="sm:w-40"
                clearable={false}
                value={s.to ?? range?.to ?? ""}
                onChange={(v) => set({ to: v })}
              />
            </>
          ) : null}
          <Choice
            aria-label="Account"
            size="sm"
            className="sm:w-40"
            value={s.account ?? ""}
            placeholder="All accounts"
            onChange={(v) => set({ account: v || undefined })}
            options={(accounts.data ?? [])
              .filter((a) => !a.hidden)
              .map((a) => ({ value: a.id, label: a.name }))}
          />
          <CategoryPicker
            label="Category filter"
            className="h-7 sm:w-44"
            categories={categories.data ?? []}
            value={s.category ?? ""}
            emptyOption="All categories"
            onChange={(v) => set({ category: v || undefined })}
          />
          <Choice
            aria-label="Tag"
            size="sm"
            className="sm:w-36"
            value={s.tag ?? ""}
            placeholder="Any tag"
            onChange={(v) => set({ tag: v || undefined })}
            options={(tags.data ?? []).map((t) => ({
              value: t.id,
              label: t.name,
            }))}
          />
          <MerchantFilter
            className="h-7 sm:w-44"
            value={s.merchant}
            name={s.merchantName}
            onChange={(key, name) => set({ merchant: key, merchantName: name })}
          />
        </div>
      </Card>
      {q.isError ? (
        <QueryError
          title="This report failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!d ? (
        <Loading rows={8} />
      ) : (
        <>
          <SectionCard
            flush={chart === "table"}
            title={`${MEASURE_LABEL[measure]}${by === "none" ? "" : ` by ${BY_LABEL[by].toLowerCase()}`}`}
            action={
              <span className="text-right text-sm tabular-nums">
                <span className="font-medium">
                  {d.totalCents == null ? "" : format(d.totalCents)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {fullDate(d.from)} – {fullDate(d.to)}
                </span>
              </span>
            }
            footer={
              d.compare && d.totalCents != null ? (
                <Compared d={d} />
              ) : by === "tag" ? (
                <span className="mr-auto text-sm text-muted-foreground">
                  A transaction with two tags counts under both.
                </span>
              ) : undefined
            }
          >
            {chart === "table" ? (
              <ReportTable d={d} format={format} />
            ) : chart === "donut" ? (
              <DonutChart
                label={`${MEASURE_LABEL[measure]} share by ${BY_LABEL[by].toLowerCase()}`}
                format={format}
                max={9}
                data={d.series.map((x, i) => ({
                  key: x.key,
                  label: x.label,
                  value: x.totalCents,
                  color: seriesColor(x, i, by),
                }))}
              />
            ) : (
              <TrendChart
                kind={chart === "line" ? "area" : "bar"}
                stacked={chart === "stacked"}
                label={`${MEASURE_LABEL[measure]} by ${BY_LABEL[by].toLowerCase()} per ${interval}`}
                data={d.buckets.map((b, bi) => ({
                  time:
                    interval === "week"
                      ? epoch(b.key)
                      : epoch(`${b.from.slice(0, 7)}-01`),
                  ...Object.fromEntries(
                    d.series.map((x) => [x.key, x.values[bi] / 100])
                  ),
                }))}
                config={Object.fromEntries(
                  d.series.map((x, i) => [
                    x.key,
                    { label: x.label, color: seriesColor(x, i, by) },
                  ])
                )}
                format={dollars}
                formatTick={moneyTick}
                formatTime={(t) => {
                  const b = d.buckets.find((x) =>
                    interval === "week"
                      ? epoch(x.key) === t
                      : epoch(`${x.from.slice(0, 7)}-01`) === t
                  )
                  return b ? bucketLabel(b.key, interval) : epochMonthYear(t)
                }}
                formatTimeTick={(t) =>
                  interval === "week"
                    ? shortDate(new Date(t).toISOString().slice(0, 10))
                    : epochMonthYear(t)
                }
                className="h-72"
              />
            )}
          </SectionCard>
          {chart !== "table" && by !== "none" ? (
            <SectionCard title="Totals" flush>
              <ReportTable d={d} format={format} />
            </SectionCard>
          ) : null}
        </>
      )}
    </Page>
  )
}

function Compared({ d }: { d: BuiltReport }) {
  const before = d.compare!.totalCents
  const now = d.totalCents ?? 0
  const change = before ? (now - before) / Math.abs(before) : null
  const worse = d.measure === "spending" ? now > before : now < before
  return (
    <span className="mr-auto text-sm text-muted-foreground">
      {money(before, { whole: true })} from {shortDate(d.compare!.from)} to{" "}
      {fullDate(d.compare!.to)}
      {change != null ? (
        <span className={worse ? "text-negative" : "text-positive"}>
          {" "}
          · {change > 0 ? "+" : ""}
          {percent(change)}
        </span>
      ) : null}
    </span>
  )
}

function ReportTable({
  d,
  format,
}: {
  d: BuiltReport
  format: (c: number) => string
}) {
  const total = d.series.reduce((s, x) => s + x.totalCents, 0)
  const link = (key: string) =>
    d.by === "merchant" && key !== "other" && key !== "unknown"
      ? { to: "/reports/merchants/$key" as const, params: { key } }
      : (d.by === "category" || d.by === "group") && key !== "other"
        ? { to: "/reports/categories/$code" as const, params: { code: key } }
        : null
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">{BY_LABEL[d.by]}</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="hidden text-right sm:table-cell">
              Share
            </TableHead>
            <TableHead className="hidden text-right sm:table-cell">
              Transactions
            </TableHead>
            {d.compare ? (
              <TableHead className="pr-5 text-right">Change</TableHead>
            ) : (
              <TableHead className="pr-5" />
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.series.map((x, i) => {
            const to = link(x.key)
            const before = d.compare?.byKey[x.key] ?? 0
            const change =
              d.compare && before
                ? (x.totalCents - before) / Math.abs(before)
                : null
            return (
              <TableRow key={x.key}>
                <TableCell className="pl-5 whitespace-normal">
                  <span className="flex min-w-0 items-center gap-2 break-words">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor(x, i, d.by) }}
                    />
                    {to ? (
                      <Link
                        {...(to as {
                          to: "/reports/categories/$code"
                          params: { code: string }
                        })}
                        className="underline-offset-4 hover:underline"
                      >
                        {x.label}
                      </Link>
                    ) : (
                      <span>{x.label}</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {format(x.totalCents)}
                </TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                  {total > 0 && x.totalCents > 0
                    ? percent(x.totalCents / total)
                    : "—"}
                </TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                  {x.count.toLocaleString()}
                </TableCell>
                <TableCell className="pr-5 text-right text-muted-foreground tabular-nums">
                  {change == null
                    ? ""
                    : `${change > 0 ? "+" : ""}${percent(change)}`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        {d.totalCents != null ? (
          <TableFooter>
            <TableRow>
              <TableCell className="pl-5 font-medium">Total</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {format(d.totalCents)}
              </TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="pr-5" />
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  )
}
