import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { DonutChart, TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zsrobinson/shell/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zsrobinson/shell/ui/tooltip"
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
  SlidersHorizontalIcon,
  XIcon,
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
/** "Category" is top-level (children inside); "Subcategory" splits them. */
const BY_LABEL: Record<GroupBy, string> = {
  group: "Category",
  category: "Subcategory",
  merchant: "Merchant",
  tag: "Tag",
  account: "Account",
  none: "Nothing",
}
const BY_ORDER: GroupBy[] = [
  "group",
  "category",
  "merchant",
  "tag",
  "account",
  "none",
]
const CHART_OPTIONS = [
  { value: "bar", label: "Bars side by side", icon: ChartColumnBigIcon },
  { value: "stacked", label: "Stacked bars", icon: ChartColumnStackedIcon },
  { value: "line", label: "Lines", icon: ChartLineIcon },
  { value: "donut", label: "Donut", icon: ChartPieIcon },
  { value: "table", label: "Table", icon: TableIcon },
] as const
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
  // A merchant takes its main category's colour.
  if (by === "merchant" && s.color) return categoryColor(s.color)
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
  type Chip = { label: string; clear: Partial<typeof s> }
  const filterChips = (
    [
      s.account
        ? {
            label:
              accounts.data?.find((a) => a.id === s.account)?.name ?? "Account",
            clear: { account: undefined },
          }
        : null,
      s.category
        ? {
            label:
              categories.data?.find((c) => c.code === s.category)?.label ??
              "Category",
            clear: { category: undefined },
          }
        : null,
      s.tag
        ? {
            label: `#${tags.data?.find((t) => t.id === s.tag)?.name ?? "tag"}`,
            clear: { tag: undefined },
          }
        : null,
      s.merchant
        ? {
            label: s.merchantName ?? s.merchant,
            clear: { merchant: undefined, merchantName: undefined },
          }
        : null,
    ] as (Chip | null)[]
  ).filter((x): x is Chip => Boolean(x))
  const filterCount = filterChips.length
  const dollars = (v: number) => format(Math.round(v * 100))
  return (
    <Page>
      <PageHeader>
        <PageTitle>Reports</PageTitle>
      </PageHeader>
      <div className="md:hidden">
        <ReportNav range="6m" />
      </div>
      <Card className="gap-3 px-4 py-4 sm:px-5">
        {/* One sentence: Spending by category per month. */}
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
          <span className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">by</span>
            <Choice
              aria-label="Group by"
              size="sm"
              className="w-36 max-w-full"
              value={by}
              onChange={(v) =>
                set({ by: v === "group" ? undefined : (v as GroupBy) })
              }
              options={BY_ORDER.map((k) => ({
                value: k,
                label: BY_LABEL[k],
              }))}
            />
          </span>
          <span className="flex items-center gap-2">
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
          </span>
          <div
            role="radiogroup"
            aria-label="Chart"
            className="flex w-fit gap-0.5 rounded-full bg-muted p-0.5 sm:ml-auto"
          >
            {CHART_OPTIONS.map((o) => (
              <Tooltip key={o.value}>
                <TooltipTrigger
                  render={
                    <Button
                      role="radio"
                      aria-checked={chart === o.value}
                      aria-label={o.label}
                      size="icon-sm"
                      variant={chart === o.value ? "outline" : "ghost"}
                      className={
                        chart === o.value
                          ? "bg-background shadow-xs dark:bg-background"
                          : "text-muted-foreground"
                      }
                      onClick={() => set({ chart: o.value })}
                    />
                  }
                >
                  <o.icon />
                </TooltipTrigger>
                <TooltipContent>{o.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Choice
            aria-label="Date range"
            size="sm"
            className="w-52 max-w-full"
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
              { value: "3m", label: "Last 3 full months" },
              { value: "6m", label: "Last 6 full months" },
              { value: "12m", label: "Last 12 full months" },
              { value: "ytd", label: "This year" },
              { value: "last-year", label: "Last year" },
              { value: "custom", label: "Custom dates" },
            ]}
          />
          <Choice
            aria-label="Compare with"
            size="sm"
            className="w-44 max-w-full"
            value={s.compare ?? ""}
            placeholder="No comparison"
            onChange={(v) =>
              set({
                compare: (v || undefined) as "previous" | "year" | undefined,
              })
            }
            options={[
              { value: "previous", label: "vs period before" },
              { value: "year", label: "vs a year earlier" },
            ]}
          />
          {preset === "custom" ? (
            <>
              <DatePicker
                aria-label="From"
                className="w-40"
                clearable={false}
                value={s.from ?? range?.from ?? ""}
                onChange={(v) => set({ from: v })}
              />
              <DatePicker
                aria-label="To"
                className="w-40"
                clearable={false}
                value={s.to ?? range?.to ?? ""}
                onChange={(v) => set({ to: v })}
              />
            </>
          ) : null}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  size="sm"
                  variant={filterCount ? "secondary" : "outline"}
                />
              }
            >
              <SlidersHorizontalIcon data-icon="inline-start" />
              Filters{filterCount ? ` (${filterCount})` : ""}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[min(20rem,calc(100vw-2rem))] gap-2 p-3"
            >
              <Choice
                aria-label="Account"
                className="w-full"
                value={s.account ?? ""}
                placeholder="All accounts"
                onChange={(v) => set({ account: v || undefined })}
                options={(accounts.data ?? [])
                  .filter((a) => !a.hidden)
                  .map((a) => ({ value: a.id, label: a.name }))}
              />
              <CategoryPicker
                label="Category filter"
                categories={categories.data ?? []}
                value={s.category ?? ""}
                emptyOption="All categories"
                onChange={(v) => set({ category: v || undefined })}
              />
              <Choice
                aria-label="Tag"
                className="w-full"
                value={s.tag ?? ""}
                placeholder="Any tag"
                onChange={(v) => set({ tag: v || undefined })}
                options={(tags.data ?? []).map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
              <MerchantFilter
                className="w-full"
                value={s.merchant}
                name={s.merchantName}
                onChange={(key, name) =>
                  set({ merchant: key, merchantName: name })
                }
              />
            </PopoverContent>
          </Popover>
        </div>
        {filterChips.length ? (
          <div className="flex flex-wrap gap-1.5">
            {filterChips.map((c) => (
              <Badge
                key={c.label}
                variant="secondary"
                className="h-6 gap-1 pr-1 font-normal"
              >
                {c.label}
                <button
                  type="button"
                  aria-label={`Remove filter ${c.label}`}
                  className="rounded-full p-0.5 hover:bg-background/60"
                  onClick={() => set(c.clear)}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
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
              <div className="mr-auto flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                {d.totalCents != null && d.buckets.length > 1 ? (
                  <span>
                    Average per {interval}{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {format(Math.round(d.totalCents / d.buckets.length))}
                    </span>
                  </span>
                ) : null}
                {d.compare && d.totalCents != null ? <Compared d={d} /> : null}
                {by === "tag" ? (
                  <span>A transaction with two tags counts under both.</span>
                ) : null}
              </div>
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
                  // Stacks keep to one side of zero: a series that went the
                  // other way (money back) is in the table, not the stack.
                  ...Object.fromEntries(
                    d.series.map((x) => [
                      x.key,
                      (chart === "stacked" && measure !== "net"
                        ? Math.max(0, x.values[bi])
                        : x.values[bi]) / 100,
                    ])
                  ),
                }))}
                // A series that only went the other way has nothing to stack;
                // it stays in the table below rather than an empty legend entry.
                config={Object.fromEntries(
                  d.series
                    .map((x, i) => [x, i] as const)
                    .filter(
                      ([x]) =>
                        chart !== "stacked" ||
                        measure === "net" ||
                        x.values.some((v) => v > 0)
                    )
                    .map(([x, i]) => [
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

/** Up is bad for spending and good for income or cash flow, everywhere. */
const changeTone = (measure: string, now: number, before: number) =>
  now === before
    ? ""
    : (measure === "spending" ? now > before : now < before)
      ? "text-negative"
      : "text-positive"
/** A share that rounds to nothing still shows it is there. */
const share = (x: number) => (x > 0 && x < 0.005 ? "<1%" : percent(x))

function Compared({ d }: { d: BuiltReport }) {
  const before = d.compare!.totalCents
  const now = d.totalCents ?? 0
  const change = before ? (now - before) / Math.abs(before) : null
  return (
    <span>
      {money(before, { whole: true })} from {shortDate(d.compare!.from)} to{" "}
      {fullDate(d.compare!.to)}
      {change != null ? (
        <span className={changeTone(d.measure, now, before)}>
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
                    ? share(x.totalCents / total)
                    : "—"}
                </TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                  {x.count.toLocaleString()}
                </TableCell>
                <TableCell
                  className={`pr-5 text-right tabular-nums ${changeTone(d.measure, x.totalCents, before)}`}
                >
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
