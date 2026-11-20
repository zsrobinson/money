import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import { Checkbox } from "@zsrobinson/shell/ui/checkbox"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EyeOffIcon,
  ListChecksIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react"
import { z } from "zod"
import { EmptyState, Loading } from "@/components/money"
import { Choice, DatePicker } from "@/components/pickers"
import { CategorySelect, ReviewDot, TxnRows } from "@/components/transactions"
import { query } from "@/lib/api"
import { usePageTitle } from "@/lib/crumb"
import { money, pluralize } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import {
  accountsQuery,
  categoriesQuery,
  tagsQuery,
  transactionsQuery,
} from "@/lib/queries"

const STATUS = [
  "visible",
  "unreviewed",
  "reviewed",
  "pending",
  "split",
  "hidden",
  "all",
] as const
const search = z.object({
  q: z.string().optional(),
  account: z.string().optional(),
  category: z.string().optional(),
  merchant: z.string().optional(),
  tag: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  direction: z.enum(["in", "out"]).optional(),
  flow: z.enum(["activity", "bank_transfer", "peer_payment"]).optional(),
  status: z.enum(STATUS).optional(),
  sort: z.enum(["date", "amount", "merchant"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
})
export type TxnSearch = z.infer<typeof search>

export const Route = createFileRoute("/transactions/")({
  validateSearch: search,
  staticData: { crumbs: [{ label: "Transactions", to: "/transactions" }] },
  component: Transactions,
})

const PAGE = 50
const STATUS_LABEL: Record<(typeof STATUS)[number], string> = {
  visible: "All but hidden",
  unreviewed: "Needs review",
  reviewed: "Reviewed",
  pending: "Pending",
  split: "Split",
  hidden: "Hidden",
  all: "Everything",
}
const SORTS = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "amount-desc", label: "Largest first" },
  { value: "amount-asc", label: "Smallest first" },
  { value: "merchant-asc", label: "Merchant A–Z" },
]

function Transactions() {
  usePageTitle("Transactions")
  const s = Route.useSearch()
  const navigate = useNavigate({ from: "/transactions/" })
  const set = (patch: Partial<TxnSearch>) =>
    void navigate({
      search: (prev) => ({ ...prev, page: undefined, ...patch }),
      replace: true,
    })
  const [text, setText] = useState(s.q ?? "")
  useEffect(() => {
    const id = setTimeout(() => {
      if ((s.q ?? "") !== text) set({ q: text || undefined })
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(
      s.min ||
      s.max ||
      s.direction ||
      s.flow ||
      s.tag ||
      s.from ||
      s.to ||
      s.status
    )
  )
  const page = s.page ?? 1
  const filters = {
    q: s.q,
    account: s.account,
    category: s.category,
    merchant: s.merchant,
    tag: s.tag,
    from: s.from,
    to: s.to,
    min: s.min != null ? Math.round(s.min * 100) : undefined,
    max: s.max != null ? Math.round(s.max * 100) : undefined,
    direction: s.direction,
    flow: s.flow,
    status: s.status,
  }
  const list = useQuery(
    transactionsQuery({
      ...filters,
      sort: s.sort,
      order: s.order,
      offset: (page - 1) * PAGE,
      limit: PAGE,
    })
  )
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const tags = useQuery(tagsQuery)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const bulk = useSend<
    { ids: string[]; patch: Record<string, unknown>; addTag?: string },
    { updated: number }
  >("POST", "/api/transactions/bulk", {
    success: (r) => `Updated ${pluralize(r.updated, "transaction")}`,
    onSuccess: () => setSelected(new Set()),
  })
  const items = list.data?.items ?? []
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id))
  const active = Object.entries(s).filter(
    ([k, v]) => v !== undefined && !["page", "sort", "order", "q"].includes(k)
  )
  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const byDate = (s.sort ?? "date") === "date"
  return (
    <Page>
      <PageHeader>
        <PageTitle>Transactions</PageTitle>
        <PageActions>
          <Button
            variant="outline"
            size="sm"
            render={
              <a href={`/api/transactions.csv${query(filters)}`} download />
            }
            nativeButton={false}
          >
            <DownloadIcon data-icon="inline-start" />
            Export CSV
          </Button>
          <Button
            variant={s.status === "unreviewed" ? "secondary" : "outline"}
            size="sm"
            aria-pressed={s.status === "unreviewed"}
            onClick={() =>
              set({
                status: s.status === "unreviewed" ? undefined : "unreviewed",
              })
            }
          >
            Needs review
          </Button>
        </PageActions>
      </PageHeader>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="min-w-0 basis-full sm:flex-1 sm:basis-56">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search transactions"
              placeholder="Search merchant, note, category or account"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </InputGroup>
          <CategorySelect
            aria-label="Category"
            className="min-w-0 flex-1 sm:w-44 sm:flex-none"
            categories={categories.data ?? []}
            value={s.category ?? ""}
            placeholder="All categories"
            onChange={(v) => set({ category: v || undefined })}
          />
          <Choice
            aria-label="Account"
            className="min-w-0 flex-1 sm:w-44 sm:flex-none"
            value={s.account ?? ""}
            placeholder="All accounts"
            onChange={(v) => set({ account: v || undefined })}
            options={(accounts.data ?? [])
              .filter((a) => !a.hidden || a.id === s.account)
              .map((a) => ({ value: a.id, label: a.name }))}
          />
          <Button
            variant={filtersOpen ? "secondary" : "outline"}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontalIcon data-icon="inline-start" />
            Filters
          </Button>
        </div>
        {filtersOpen ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Choice
              aria-label="Status"
              className="sm:w-40"
              value={s.status ?? "visible"}
              onChange={(v) =>
                set({
                  status:
                    v === "visible" ? undefined : (v as TxnSearch["status"]),
                })
              }
              options={STATUS.map((x) => ({
                value: x,
                label: STATUS_LABEL[x],
              }))}
            />
            <Choice
              aria-label="Direction"
              className="sm:w-40"
              value={s.direction ?? ""}
              placeholder="Money in and out"
              onChange={(v) =>
                set({ direction: (v || undefined) as TxnSearch["direction"] })
              }
              options={[
                { value: "out", label: "Money out" },
                { value: "in", label: "Money in" },
              ]}
            />
            <Choice
              aria-label="Kind"
              className="sm:w-52"
              value={s.flow ?? ""}
              placeholder="Any kind"
              onChange={(v) =>
                set({ flow: (v || undefined) as TxnSearch["flow"] })
              }
              options={[
                { value: "activity", label: "Purchases and income" },
                {
                  value: "bank_transfer",
                  label: "Transfers and card payments",
                },
                { value: "peer_payment", label: "Peer payments" },
              ]}
            />
            <Choice
              aria-label="Tag"
              className="sm:w-40"
              value={s.tag ?? ""}
              placeholder="Any tag"
              onChange={(v) => set({ tag: v || undefined })}
              options={(tags.data ?? []).map((t) => ({
                value: t.id,
                label: t.name,
              }))}
            />
            <DatePicker
              aria-label="From date"
              placeholder="From"
              className="sm:w-44"
              value={s.from ?? ""}
              onChange={(v) => set({ from: v || undefined })}
            />
            <DatePicker
              aria-label="To date"
              placeholder="To"
              className="sm:w-44"
              value={s.to ?? ""}
              onChange={(v) => set({ to: v || undefined })}
            />
            <Input
              aria-label="Minimum amount"
              inputMode="decimal"
              placeholder="Min $"
              className="sm:w-24"
              defaultValue={s.min ?? ""}
              onBlur={(e) =>
                set({
                  min: e.target.value
                    ? Number(e.target.value) || undefined
                    : undefined,
                })
              }
            />
            <Input
              aria-label="Maximum amount"
              inputMode="decimal"
              placeholder="Max $"
              className="sm:w-24"
              defaultValue={s.max ?? ""}
              onBlur={(e) =>
                set({
                  max: e.target.value
                    ? Number(e.target.value) || undefined
                    : undefined,
                })
              }
            />
          </div>
        ) : null}
      </div>
      <PageMeta>
        {list.data ? (
          <>
            <span>{pluralize(total, "transaction")}</span>
            <span className="tabular-nums">
              <span className="text-positive">
                {money(list.data.inflowCents, { sign: true, whole: true })}
              </span>{" "}
              in
            </span>
            <span className="tabular-nums">
              {money(-list.data.outflowCents, { whole: true })} out
            </span>
            <span className="flex items-center gap-1.5">
              <ReviewDot /> needs review
            </span>
          </>
        ) : null}
        {active.length || s.q ? (
          <Button
            variant="link"
            size="xs"
            className="px-0"
            onClick={() => {
              setText("")
              void navigate({ search: {}, replace: true })
            }}
          >
            <XIcon data-icon="inline-start" />
            Clear filters
          </Button>
        ) : null}
      </PageMeta>
      {list.isError ? (
        <QueryError
          title="Transactions failed to load"
          error={list.error}
          onRetry={() => list.refetch()}
        />
      ) : null}
      <Card className="gap-0 py-0">
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-4 py-1.5 text-sm sm:px-5">
          {selecting ? (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(on) =>
                    setSelected(
                      on ? new Set(items.map((t) => t.id)) : new Set()
                    )
                  }
                  aria-label="Select all on this page"
                />
                {selected.size ? `${selected.size} selected` : "Select all"}
              </label>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {selected.size ? (
                  <>
                    <CategorySelect
                      aria-label="Set category for selected"
                      size="sm"
                      className="w-40"
                      categories={categories.data ?? []}
                      value=""
                      placeholder="Set category"
                      disabled={bulk.isPending}
                      onChange={(v) =>
                        v &&
                        bulk.mutate({
                          ids: [...selected],
                          patch: { category: v },
                        })
                      }
                    />
                    {tags.data?.length ? (
                      <Choice
                        aria-label="Add tag to selected"
                        size="sm"
                        className="w-32"
                        value=""
                        placeholder="Add tag"
                        disabled={bulk.isPending}
                        onChange={(v) =>
                          v &&
                          bulk.mutate({
                            ids: [...selected],
                            patch: {},
                            addTag: v,
                          })
                        }
                        options={tags.data.map((t) => ({
                          value: t.id,
                          label: t.name,
                        }))}
                      />
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulk.isPending}
                      onClick={() =>
                        bulk.mutate({
                          ids: [...selected],
                          patch: { reviewed: true },
                        })
                      }
                    >
                      <CheckIcon data-icon="inline-start" />
                      Mark reviewed
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulk.isPending}
                      onClick={() =>
                        bulk.mutate({
                          ids: [...selected],
                          patch: { hidden: true },
                        })
                      }
                    >
                      <EyeOffIcon data-icon="inline-start" />
                      Hide
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="ghost" onClick={stopSelecting}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="-ml-2"
                onClick={() => setSelecting(true)}
              >
                <ListChecksIcon data-icon="inline-start" />
                Select
              </Button>
              <Choice
                aria-label="Sort"
                size="sm"
                align="end"
                className="ml-auto w-40"
                value={`${s.sort ?? "date"}-${s.order ?? "desc"}`}
                onChange={(v) => {
                  const [sort, order] = v.split("-") as [
                    TxnSearch["sort"],
                    TxnSearch["order"],
                  ]
                  set({
                    sort: sort === "date" ? undefined : sort,
                    order: order === "desc" ? undefined : order,
                  })
                }}
                options={SORTS}
              />
            </>
          )}
        </div>
        {!list.data ? (
          <Loading rows={10} className="p-4" />
        ) : items.length ? (
          <TxnRows
            items={items}
            grouped={byDate}
            dayTotals={list.data.dayTotals}
            selected={selected}
            onToggle={selecting ? toggle : undefined}
          />
        ) : (
          <EmptyState title="No transactions match">
            Change the search or clear filters to see more.
          </EmptyState>
        )}
        {pages > 1 ? (
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm sm:px-5">
            <span className="text-muted-foreground tabular-nums">
              Page {page} of {pages}
            </span>
            <div className="flex gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() =>
                  set({ page: page - 1 > 1 ? page - 1 : undefined })
                }
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next page"
                disabled={page >= pages}
                onClick={() => set({ page: page + 1 })}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </Page>
  )
}
