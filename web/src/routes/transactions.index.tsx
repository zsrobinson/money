import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  cn,
  Page,
  PageActions,
  PageHeader,
  PageMeta,
  PageTitle,
} from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import { Checkbox } from "@zsrobinson/shell/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@zsrobinson/shell/ui/dropdown-menu"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import { Kbd } from "@zsrobinson/shell/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zsrobinson/shell/ui/popover"
import {
  BookmarkIcon,
  CheckIcon,
  KeyboardIcon,
  PlayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EllipsisIcon,
  ListChecksIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { z } from "zod"
import { CategoryPicker } from "@/components/category-picker"
import { EmptyState, Loading } from "@/components/money"
import { Choice, DatePicker } from "@/components/pickers"
import { MerchantFilter } from "@/components/merchant-filter"
import { TxnRows } from "@/components/transactions"
import { query } from "@/lib/api"
import { usePageTitle } from "@/lib/crumb"
import { money, pluralize } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import {
  accountsQuery,
  categoriesQuery,
  metaQuery,
  tagsQuery,
  transactionsQuery,
  viewsQuery,
} from "@/lib/queries"

const STATUS = [
  "visible",
  "unreviewed",
  "reviewed",
  "pending",
  "split",
  "manual",
  "hidden",
  "all",
] as const
const search = z.object({
  q: z.string().optional(),
  account: z.string().optional(),
  category: z.string().optional(),
  merchant: z.string().optional(),
  /** Shown name for the merchant filter. */
  merchantName: z.string().optional(),
  /** A rule's conditions, from its Matches list. */
  match: z.string().optional(),
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
  manual: "Added by hand",
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
const FLOW_LABEL = {
  activity: "Purchases and income",
  bank_transfer: "Transfers",
  peer_payment: "Peer payments",
}

/** The API's filter parameters for a search; amounts in cents. */
function txnFilters(s: TxnSearch) {
  return {
    q: s.q,
    account: s.account,
    category: s.category,
    merchant: s.merchant,
    match: s.match,
    tag: s.tag,
    from: s.from,
    to: s.to,
    min: s.min != null ? Math.round(s.min * 100) : undefined,
    max: s.max != null ? Math.round(s.max * 100) : undefined,
    direction: s.direction,
    flow: s.flow,
    status: s.status,
  }
}

type Bulk = {
  ids?: string[]
  filter?: Record<string, string>
  patch?: Record<string, unknown>
  addTag?: string
  removeTag?: string
}

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
    Boolean(s.min || s.max || s.direction || s.flow || s.tag || s.from || s.to)
  )
  const page = s.page ?? 1
  const filters = txnFilters(s)
  const listParams = Object.fromEntries(
    Object.entries({ ...filters, sort: s.sort, order: s.order }).filter(
      ([, v]) => v !== undefined
    )
  ) as Record<string, string | number>
  const list = useQuery(
    transactionsQuery({
      ...listParams,
      offset: (page - 1) * PAGE,
      limit: PAGE,
    })
  )
  const meta = useQuery(metaQuery)
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const tags = useQuery(tagsQuery)
  const views = useQuery(viewsQuery)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** Every transaction matching the filters, not just this page. */
  const [allMatching, setAllMatching] = useState(false)
  const toggle = (id: string, on: boolean) => {
    setAllMatching(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
    setAllMatching(false)
  }
  const bulk = useSend<Bulk, { updated: number; keptByRules: number }>(
    "POST",
    "/api/transactions/bulk",
    {
      success: (r) =>
        `Updated ${pluralize(r.updated, "transaction")}${r.keptByRules ? `; a rule keeps the tag on ${r.keptByRules}` : ""}`,
      onSuccess: () => {
        setSelected(new Set())
        setAllMatching(false)
      },
    }
  )
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const pageSelected =
    items.length > 0 && items.every((t) => selected.has(t.id))
  const count = allMatching ? total : selected.size
  const apply = (b: Omit<Bulk, "ids" | "filter">) =>
    bulk.mutate({
      ...b,
      ...(allMatching
        ? {
            filter: Object.fromEntries(
              Object.entries(listParams).flatMap(([k, v]) =>
                v === undefined ? [] : [[k, String(v)]]
              )
            ),
          }
        : { ids: [...selected] }),
    })
  const pages = Math.max(1, Math.ceil(total / PAGE))
  // The first transaction in this view waiting for review, to step from.
  const reviewQueue = useQuery({
    ...transactionsQuery({ ...listParams, status: "unreviewed", limit: 1 }),
    enabled: (meta.data?.unreviewed ?? 0) > 0,
  })
  const firstReview = reviewQueue.data?.items[0]?.id
  const byDate = (s.sort ?? "date") === "date"
  const unreviewed = meta.data?.unreviewed ?? 0
  const reviewing = s.status === "unreviewed"

  // Keyboard: j/k move, Enter opens, r marks reviewed, c changes category,
  // x selects, / searches.
  const [active, setActive] = useState<string>()
  const [pickerFor, setPickerFor] = useState<string>()
  const searchRef = useRef<HTMLInputElement>(null)
  const review = useSend<{ id: string; reviewed: boolean }>(
    "PATCH",
    (v) => `/api/transactions/${v.id}`,
    {
      body: (v) => ({ reviewed: v.reviewed }),
      success: (_, v) => (v.reviewed ? "Reviewed" : "Needs review again"),
    }
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        pickerFor ||
        el.closest("input, textarea, select, [role=dialog], [role=listbox]")
      )
        return
      const i = items.findIndex((t) => t.id === active)
      const move = (to: number) => {
        const t = items[Math.max(0, Math.min(items.length - 1, to))]
        if (!t) return
        setActive(t.id)
        document
          .querySelector(`[data-txn="${t.id}"]`)
          ?.scrollIntoView({ block: "nearest" })
      }
      const current = items[i]
      if (e.key === "j" || e.key === "ArrowDown") move(i + 1)
      else if (e.key === "k" || e.key === "ArrowUp") move(i < 0 ? 0 : i - 1)
      else if (e.key === "/") searchRef.current?.focus()
      else if (!current) return
      else if (e.key === "Enter")
        void navigate({
          to: "/transactions/$id",
          params: { id: current.id },
          search: { list: listParams },
        })
      else if (e.key === "r")
        review.mutate({ id: current.id, reviewed: !current.reviewed })
      else if (e.key === "c" && !current.split) setPickerFor(current.id)
      else if (e.key === "x") {
        setSelecting(true)
        toggle(current.id, !selected.has(current.id))
      } else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const save = useSend<{ name: string; search: Record<string, string> }>(
    "POST",
    "/api/views",
    { success: (_, v) => `Saved “${v.name}”` }
  )
  const forget = useSend<{ id: string }>(
    "DELETE",
    (v) => `/api/views/${v.id}`,
    { success: "View removed" }
  )
  const viewSearch = Object.fromEntries(
    Object.entries(s).flatMap(([k, v]) =>
      v === undefined || k === "page" ? [] : [[k, String(v)]]
    )
  )
  const isView = (v: { search: Record<string, string> }) =>
    JSON.stringify(Object.entries(v.search).sort()) ===
    JSON.stringify(Object.entries(viewSearch).sort())
  const currentView = (views.data ?? []).find(isView)
  const openView = (v: { search: Record<string, string> }) => {
    setText(v.search.q ?? "")
    void navigate({
      search: Object.fromEntries(
        Object.entries(v.search).map(([k, val]) => [
          k,
          ["min", "max", "page"].includes(k) ? Number(val) : val,
        ])
      ) as TxnSearch,
      replace: true,
    })
  }

  const account = (accounts.data ?? []).find((a) => a.id === s.account)
  type Chip = { label: string; clear: Partial<TxnSearch> }
  const chips = (
    [
      s.merchant
        ? {
            label: `Merchant: ${s.merchantName ?? s.merchant}`,
            clear: { merchant: undefined, merchantName: undefined },
          }
        : null,
      s.match
        ? { label: "Matching a rule", clear: { match: undefined } }
        : null,
      s.tag
        ? {
            label: `Tag: ${tags.data?.find((t) => t.id === s.tag)?.name ?? "…"}`,
            clear: { tag: undefined },
          }
        : null,
      s.flow ? { label: FLOW_LABEL[s.flow], clear: { flow: undefined } } : null,
      s.direction
        ? {
            label: s.direction === "in" ? "Money in" : "Money out",
            clear: { direction: undefined },
          }
        : null,
      s.from ? { label: `From ${s.from}`, clear: { from: undefined } } : null,
      s.to ? { label: `To ${s.to}`, clear: { to: undefined } } : null,
      s.min != null
        ? { label: `At least $${s.min}`, clear: { min: undefined } }
        : null,
      s.max != null
        ? { label: `At most $${s.max}`, clear: { max: undefined } }
        : null,
      s.status && s.status !== "unreviewed"
        ? { label: STATUS_LABEL[s.status], clear: { status: undefined } }
        : null,
    ] as (Chip | null)[]
  ).filter((x): x is Chip => Boolean(x))
  const anyFilter =
    chips.length > 0 || Boolean(s.q || s.category || s.account || reviewing)

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
            <span className="max-sm:sr-only">Export</span>
          </Button>
          <Button
            size="sm"
            render={<Link to="/transactions/new" />}
            nativeButton={false}
          >
            <PlusIcon data-icon="inline-start" />
            Add
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
              ref={searchRef}
              aria-label="Search transactions"
              placeholder="Search transactions"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
            />
          </InputGroup>
          <CategoryPicker
            label="Category"
            className="min-w-0 basis-[calc(50%-0.25rem)] sm:w-44 sm:basis-auto"
            categories={categories.data ?? []}
            value={s.category ?? ""}
            emptyOption="All categories"
            onChange={(v) => set({ category: v || undefined })}
          />
          <Choice
            aria-label="Account"
            className="min-w-0 basis-[calc(50%-0.25rem)] sm:w-44 sm:basis-auto"
            value={s.account ?? ""}
            placeholder="All accounts"
            onChange={(v) => set({ account: v || undefined })}
            options={(accounts.data ?? [])
              .filter((a) => !a.hidden || a.id === s.account)
              .map((a) => ({ value: a.id, label: a.name }))}
          />
          <Button
            variant="outline"
            aria-pressed={reviewing}
            className={cn(
              "max-sm:flex-1",
              reviewing &&
                "border-primary/40 bg-primary/10 hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/15"
            )}
            onClick={() =>
              set({ status: reviewing ? undefined : "unreviewed" })
            }
          >
            {reviewing ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-primary"
                data-icon="inline-start"
              />
            )}
            Needs review
            <span className="text-muted-foreground tabular-nums">
              {unreviewed}
            </span>
          </Button>
          <Button
            variant={filtersOpen ? "secondary" : "outline"}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <SlidersHorizontalIcon data-icon="inline-start" />
            <span className="max-sm:sr-only">Filters</span>
          </Button>
          <ViewsMenu
            views={views.data ?? []}
            canSave={anyFilter && !currentView}
            onOpen={openView}
            onSave={(name) => save.mutate({ name, search: viewSearch })}
            onDelete={(id) => forget.mutateAsync({ id })}
          />
        </div>
        {filtersOpen ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <MerchantFilter
              className="col-span-2 sm:w-52"
              value={s.merchant}
              name={s.merchantName}
              onChange={(key, name) =>
                set({ merchant: key, merchantName: name })
              }
            />
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
              className="sm:w-36"
              value={s.direction ?? ""}
              placeholder="In and out"
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
              className="sm:w-48"
              value={s.flow ?? ""}
              placeholder="Any kind"
              onChange={(v) =>
                set({ flow: (v || undefined) as TxnSearch["flow"] })
              }
              options={Object.entries(FLOW_LABEL).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Choice
              aria-label="Tag"
              className="sm:w-36"
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
              className="sm:w-40"
              value={s.from ?? ""}
              onChange={(v) => set({ from: v || undefined })}
            />
            <DatePicker
              aria-label="To date"
              placeholder="To"
              className="sm:w-40"
              value={s.to ?? ""}
              onChange={(v) => set({ to: v || undefined })}
            />
            <Input
              key={`min-${s.min}`}
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
              key={`max-${s.max}`}
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
        {chips.length || anyFilter ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {currentView ? (
              <Badge className="h-6 gap-1 pr-1 font-normal" variant="outline">
                <BookmarkIcon className="size-3" />
                {currentView.name}
                <button
                  type="button"
                  aria-label={`Leave view ${currentView.name}`}
                  className="rounded-full p-0.5 hover:bg-muted"
                  onClick={() => {
                    setText("")
                    void navigate({ search: {}, replace: true })
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ) : null}
            {chips.map((c) => (
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
            {anyFilter ? (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => {
                  setText("")
                  void navigate({ search: {}, replace: true })
                }}
              >
                Clear all
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <PageMeta>
        {list.data ? (
          <>
            <span>
              {pluralize(total, "transaction")}
              {account ? ` in ${account.name}` : ""}
            </span>
            <span
              className="tabular-nums"
              title="Leaves out transfers between your accounts and hidden transactions"
            >
              <span className="text-positive">
                {money(list.data.inflowCents, { sign: true, whole: true })}
              </span>{" "}
              in · {money(-list.data.outflowCents, { whole: true })} out
            </span>
          </>
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
                  checked={pageSelected || allMatching}
                  onCheckedChange={(on) => {
                    setAllMatching(false)
                    setSelected(
                      on ? new Set(items.map((t) => t.id)) : new Set()
                    )
                  }}
                  aria-label="Select all on this page"
                />
                {count ? `${count.toLocaleString()} selected` : "Select all"}
              </label>
              {pageSelected && total > items.length && !allMatching ? (
                <Button
                  size="xs"
                  variant="link"
                  className="px-0"
                  onClick={() => setAllMatching(true)}
                >
                  Select all {total.toLocaleString()} matching
                </Button>
              ) : null}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {count ? (
                  <BulkActions
                    count={count}
                    disabled={bulk.isPending}
                    onApply={apply}
                  />
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
              {firstReview ? (
                <Button
                  size="sm"
                  variant="ghost"
                  render={
                    <Link
                      to="/transactions/$id"
                      params={{ id: firstReview }}
                      search={{ list: { ...listParams, status: "unreviewed" } }}
                    />
                  }
                  nativeButton={false}
                >
                  <PlayIcon data-icon="inline-start" />
                  Start review
                </Button>
              ) : null}
              <Shortcuts />
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
            editable
            activeId={active}
            pickerFor={pickerFor}
            onPickerChange={setPickerFor}
            linkSearch={{ list: listParams }}
          />
        ) : reviewing ? (
          <EmptyState title="All caught up">
            Nothing needs review right now.
          </EmptyState>
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

/**
 * Saved filter views: open one, save the current filters, or delete one
 * (with a confirm) under Manage.
 */
function ViewsMenu({
  views,
  canSave,
  onOpen,
  onSave,
  onDelete,
}: {
  views: { id: string; name: string; search: Record<string, string> }[]
  canSave: boolean
  onOpen: (v: { search: Record<string, string> }) => void
  onSave: (name: string) => void
  onDelete: (id: string) => Promise<unknown>
}) {
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [deleting, setDeleting] = useState<{ id: string; name: string }>()
  return (
    <>
      <Popover open={saving} onOpenChange={setSaving}>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            <BookmarkIcon data-icon="inline-start" />
            <span className="max-sm:sr-only">Views</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {views.length ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {views.map((v) => (
                  <DropdownMenuItem key={v.id} onClick={() => onOpen(v)}>
                    {v.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ) : null}
            {views.length ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={!canSave}
              onClick={() => {
                setName("")
                setSaving(true)
              }}
            >
              <PlusIcon />
              Save current filters…
            </DropdownMenuItem>
            {views.length ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Manage views</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-48">
                  {views.map((v) => (
                    <DropdownMenuItem
                      key={v.id}
                      variant="destructive"
                      onClick={() => setDeleting(v)}
                    >
                      <Trash2Icon />
                      Delete {v.name}…
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverTrigger
          nativeButton={false}
          render={
            <span aria-hidden className="pointer-events-none -ml-2 w-0" />
          }
        />
        <PopoverContent align="end" className="w-64 gap-2 p-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              onSave(name.trim())
              setSaving(false)
            }}
          >
            <Input
              autoFocus
              aria-label="View name"
              placeholder="Name this view"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Save
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <ConfirmAction
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={`Delete the view “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete view"
        destructive
        onConfirm={() => onDelete(deleting!.id)}
      >
        Only the saved filters go; no transactions change.
      </ConfirmAction>
    </>
  )
}

/** The actions for a selection: category, tags, review, hide, merchant, date. */
function BulkActions({
  count,
  disabled,
  onApply,
}: {
  count: number
  disabled: boolean
  onApply: (b: Omit<Bulk, "ids" | "filter">) => void
}) {
  const categories = useQuery(categoriesQuery).data ?? []
  const tags = useQuery(tagsQuery).data ?? []
  const [form, setForm] = useState<"merchant" | "date" | null>(null)
  const [value, setValue] = useState("")
  const many = `${count.toLocaleString()} ${count === 1 ? "transaction" : "transactions"}`
  return (
    <>
      <CategoryPicker
        label={`Set category for ${many}`}
        className="h-7 w-40"
        categories={categories}
        value=""
        placeholder="Set category"
        disabled={disabled}
        onChange={(v) => v && onApply({ patch: { category: v } })}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onApply({ patch: { reviewed: true } })}
      >
        <CheckIcon data-icon="inline-start" />
        Mark reviewed
      </Button>
      <Popover
        open={form !== null}
        onOpenChange={(open) => !open && setForm(null)}
      >
        <PopoverTrigger
          nativeButton={false}
          render={
            <span aria-hidden className="pointer-events-none -ml-1.5 w-0" />
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="More changes"
                disabled={disabled}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => onApply({ patch: { reviewed: false } })}
              >
                Mark as needing review
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onApply({ patch: { hidden: true } })}
              >
                Hide from totals
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onApply({ patch: { hidden: null } })}
              >
                Unhide
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setValue("")
                  setForm("merchant")
                }}
              >
                Rename merchant…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onApply({ patch: { merchant: null } })}
              >
                Restore bank’s merchant
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setValue("")
                  setForm("date")
                }}
              >
                Change date…
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {tags.length ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Add tag</DropdownMenuLabel>
                  {tags.map((t) => (
                    <DropdownMenuItem
                      key={`add-${t.id}`}
                      onClick={() => onApply({ addTag: t.id })}
                    >
                      {t.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Remove tag</DropdownMenuLabel>
                  {tags.map((t) => (
                    <DropdownMenuItem
                      key={`remove-${t.id}`}
                      onClick={() => onApply({ removeTag: t.id })}
                    >
                      {t.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverContent align="end" className="w-72 gap-2 p-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!value) return
              onApply({
                patch:
                  form === "merchant" ? { merchant: value } : { date: value },
              })
              setForm(null)
            }}
          >
            {form === "date" ? (
              <DatePicker
                aria-label={`New date for ${many}`}
                className="flex-1"
                clearable={false}
                value={value}
                onChange={setValue}
              />
            ) : (
              <Input
                autoFocus
                aria-label={`Merchant name for ${many}`}
                placeholder="Merchant name"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            <Button type="submit" size="sm" disabled={!value}>
              Apply
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </>
  )
}

/** The list's keyboard shortcuts, behind a "?" button. */
function Shortcuts() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Keyboard shortcuts"
            className="max-lg:hidden"
          />
        }
      >
        <KeyboardIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-2 p-3 text-sm">
        {[
          [["j", "k"], "Next and previous"],
          [["Enter"], "Open"],
          [["r"], "Mark reviewed"],
          [["c"], "Change category"],
          [["x"], "Select"],
          [["/"], "Search"],
        ].map(([keys, what]) => (
          <div
            key={what as string}
            className="flex items-center justify-between gap-3"
          >
            <span className="text-muted-foreground">{what as string}</span>
            <span className="flex gap-1">
              {(keys as string[]).map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
