import { Fragment } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { cn } from "@zsrobinson/shell"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Checkbox } from "@zsrobinson/shell/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zsrobinson/shell/ui/tooltip"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  CheckIcon,
  ChevronDownIcon,
  EyeOffIcon,
  NotebookPenIcon,
  SplitIcon,
} from "lucide-react"
import { CategoryPicker } from "@/components/category-picker"
import { CategoryDot } from "@/components/category-style"
import { Amount, MerchantMark } from "@/components/money"
import { dayHeading, money, shortDate } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { categoriesQuery, metaQuery, tagsQuery } from "@/lib/queries"
import type { Category, Txn } from "@/lib/types"

export function useCategoryLabels() {
  const categories = useQuery(categoriesQuery)
  const map = new Map((categories.data ?? []).map((c) => [c.code, c]))
  return (code: string) => map.get(code)?.label ?? code
}

export const txnName = (t: Pick<Txn, "merchant" | "description">) =>
  t.merchant ?? t.description ?? "Unnamed transaction"

/** The small mark used everywhere for a transaction that still needs review. */
export function ReviewDot() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label="Needs review"
            // A hollow ring, so it never reads as a category colour dot.
            className="inline-block size-2 shrink-0 rounded-full border-[1.5px] border-primary"
          />
        }
      />
      <TooltipContent>Needs review</TooltipContent>
    </Tooltip>
  )
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
/** A tag as a small outline badge with its colour dot. */
export function TagBadge({
  name,
  hue,
  className,
}: {
  name: string
  hue: string | null
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 max-w-40 shrink-0 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground",
        className
      )}
    >
      <CategoryDot color={hue ? TAG_HUE[hue] : null} className="size-1.5" />
      <span className="truncate">{name}</span>
    </Badge>
  )
}

/**
 * The one list of transactions used everywhere: grouped under a header per
 * day (Today, Yesterday, then full dates), the merchant with any Pending badge
 * and tags beneath it, then a category column wide enough for the longest
 * built-in name. `secondary="account"` shows the account in that column
 * instead, for a merchant's own page; `showAccount` adds an account column on
 * wide lists. A narrow list stacks the category under the merchant. Only a
 * list sorted by something other than date drops the day headers
 * (`grouped={false}`), and then shows each date under the merchant.
 *
 * `editable` makes the category a picker in place and adds a quick "mark
 * reviewed" button, for clearing a review queue from the list.
 */
export function TxnRows({
  items,
  selected,
  onToggle,
  showAccount = true,
  dayTotals,
  secondary = "category",
  grouped = true,
  editable = false,
  activeId,
  pickerFor,
  onPickerChange,
  linkSearch,
  className,
}: {
  items: Txn[]
  selected?: Set<string>
  onToggle?: (id: string, on: boolean) => void
  showAccount?: boolean
  /** Net of each day across pages, shown in the day header. */
  dayTotals?: Record<string, number>
  secondary?: "category" | "account"
  grouped?: boolean
  editable?: boolean
  /** The keyboard's current row. */
  activeId?: string
  /** The row whose category picker is open (from a shortcut). */
  pickerFor?: string
  onPickerChange?: (id: string | undefined) => void
  /** Carried to the detail page so it can step through this list. */
  linkSearch?: Record<string, unknown>
  className?: string
}) {
  const categories = useQuery(categoriesQuery).data ?? []
  const today = useQuery(metaQuery).data?.today
  const tags = new Map((useQuery(tagsQuery).data ?? []).map((t) => [t.id, t]))
  const accountColumn = showAccount && secondary === "category"
  const columns = accountColumn
    ? "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[2rem_minmax(0,1fr)_11.5rem_6rem] @3xl:grid-cols-[2rem_minmax(0,1fr)_11.5rem_minmax(0,10rem)_6rem]"
    : "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[2rem_minmax(0,1fr)_11.5rem_6rem]"
  return (
    <ul className={cn("@container flex flex-col", className)}>
      {items.map((t, i) => {
        const header = grouped && (i === 0 || items[i - 1].date !== t.date)
        return (
          <Fragment key={t.id}>
            {header ? (
              <li className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground sm:px-5">
                <span>{dayHeading(t.date, today)}</span>
                {dayTotals?.[t.date] !== undefined ? (
                  <span className="tabular-nums">
                    {money(dayTotals[t.date], { sign: true })}
                  </span>
                ) : null}
              </li>
            ) : null}
            <TxnRow
              t={t}
              today={today}
              columns={columns}
              accountColumn={accountColumn}
              secondary={secondary}
              grouped={grouped}
              editable={editable}
              active={activeId === t.id}
              pickerOpen={pickerFor === t.id}
              onPickerChange={(open) =>
                onPickerChange?.(open ? t.id : undefined)
              }
              categories={categories}
              tagList={t.tags.flatMap((id) => {
                const tag = tags.get(id)
                return tag ? [tag] : []
              })}
              selected={selected?.has(t.id) ?? false}
              onToggle={onToggle}
              linkSearch={linkSearch}
            />
          </Fragment>
        )
      })}
    </ul>
  )
}

function TxnRow({
  t,
  today,
  columns,
  accountColumn,
  secondary,
  grouped,
  editable,
  active,
  pickerOpen,
  onPickerChange,
  categories,
  tagList,
  selected,
  onToggle,
  linkSearch,
}: {
  t: Txn
  today: string | undefined
  columns: string
  accountColumn: boolean
  secondary: "category" | "account"
  grouped: boolean
  editable: boolean
  active: boolean
  pickerOpen: boolean
  onPickerChange: (open: boolean) => void
  categories: Category[]
  tagList: { id: string; name: string; hue: string | null }[]
  selected: boolean
  onToggle?: (id: string, on: boolean) => void
  linkSearch?: Record<string, unknown>
}) {
  const name = txnName(t)
  const cat = categories.find((c) => c.code === t.category)
  const patch = useSend<Record<string, unknown>>(
    "PATCH",
    `/api/transactions/${t.id}`,
    {
      success: (_, v) =>
        "reviewed" in v
          ? v.reviewed
            ? `${name} reviewed`
            : `${name} needs review again`
          : `${name}: ${categories.find((c) => c.code === v.category)?.label ?? "category changed"}`,
    }
  )
  const canPick = editable && !t.split && secondary === "category"
  const categoryText =
    secondary === "account"
      ? t.accountName
      : t.split
        ? "Split"
        : (cat?.label ?? t.category)
  const picker = (where: "column" | "line") =>
    canPick ? (
      <CategoryPicker
        variant="chip"
        label={`Category for ${name}, ${shortDate(t.date)}`}
        value={t.category}
        categories={categories}
        open={where === "column" ? pickerOpen : undefined}
        onOpenChange={where === "column" ? onPickerChange : undefined}
        onChange={(code) => patch.mutate({ category: code, reviewed: true })}
        className={
          where === "line"
            ? "mx-0 h-6 px-0 text-xs hover:bg-transparent hover:underline data-popup-open:bg-transparent"
            : undefined
        }
      >
        <CategoryDot color={cat?.color} />
        <span className="truncate" title={cat?.fullLabel}>
          {categoryText}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-opacity",
            t.needsReview
              ? "opacity-70"
              : "opacity-0 group-focus-within/row:opacity-70 group-hover/row:opacity-70"
          )}
        />
      </CategoryPicker>
    ) : (
      <span
        className="flex min-w-0 items-center gap-1.5 truncate"
        title={cat?.fullLabel}
      >
        {secondary === "category" && !t.split ? (
          <CategoryDot color={cat?.color} />
        ) : null}
        <span className="truncate">{categoryText}</span>
      </span>
    )
  return (
    <li
      data-txn={t.id}
      className={cn(
        "group/row relative flex items-center border-b border-border/70 last:border-b-0 hover:bg-muted/60",
        t.hidden && "opacity-60",
        active && "bg-muted ring-2 ring-ring/40 ring-inset"
      )}
    >
      {onToggle ? (
        <span className="relative z-10 flex shrink-0 items-center self-stretch pr-1 pl-4 sm:pl-5">
          <Checkbox
            checked={selected}
            onCheckedChange={(on) => onToggle(t.id, on)}
            aria-label={`Select ${name}, ${shortDate(t.date)}`}
          />
        </span>
      ) : null}
      <div
        className={cn(
          "grid min-h-13 flex-1 items-center gap-x-3 py-2 pr-4 sm:pr-5",
          onToggle ? "pl-2" : "pl-4 sm:pl-5",
          columns
        )}
      >
        <MerchantMark name={name} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            {/* The name links to the page; the link covers the row. */}
            <Link
              to="/transactions/$id"
              params={{ id: t.id }}
              search={linkSearch as never}
              className="truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
            >
              {name}
            </Link>
            {t.needsReview ? <ReviewDot /> : null}
            {t.split ? (
              <SplitIcon
                aria-label="Split"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
            {t.note ? (
              <NotebookPenIcon
                aria-label="Has a note"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
            {t.hidden ? (
              <EyeOffIcon
                aria-label="Hidden"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
          </span>
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
              grouped && !t.pending && !tagList.length && "@xl:hidden"
            )}
          >
            {grouped ? null : (
              <>
                <span className="shrink-0 tabular-nums">
                  {shortDate(t.date, today)}
                </span>
                <span aria-hidden className="@xl:hidden">
                  ·
                </span>
              </>
            )}
            <span className="relative z-10 flex min-w-0 @xl:hidden">
              {picker("line")}
            </span>
            {t.pending ? (
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground"
              >
                Pending
              </Badge>
            ) : null}
            {tagList.map((tag, i) => (
              <TagBadge
                key={tag.id}
                name={tag.name}
                hue={tag.hue}
                className={
                  i > 0 ? "hidden @xl:inline-flex" : "hidden @md:inline-flex"
                }
              />
            ))}
          </span>
        </span>
        <span className="relative z-10 hidden min-w-0 text-sm text-muted-foreground @xl:flex">
          {picker("column")}
        </span>
        {accountColumn ? (
          <span className="hidden truncate text-sm text-muted-foreground @3xl:block">
            {t.accountName}
          </span>
        ) : null}
        <span className="flex items-center justify-end gap-1">
          {editable && t.needsReview ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Mark ${name} reviewed`}
              title="Mark reviewed (r)"
              className="relative z-10 rounded-full text-muted-foreground ring-1 ring-border hover:text-foreground"
              onClick={() => patch.mutate({ reviewed: true })}
            >
              <CheckIcon />
            </Button>
          ) : null}
          <Amount
            cents={t.amountCents}
            currency={t.currency}
            className="text-right text-sm font-medium whitespace-nowrap"
          />
        </span>
      </div>
    </li>
  )
}

/** Category options grouped by spending, income and transfers; your categories sit under their parent. */
export function categoryOptions(
  categories: Category[],
  value?: string,
  includeHidden = false
) {
  const visible = categories.filter(
    (c) => includeHidden || !c.hidden || c.code === value
  )
  const tops = visible.filter((c) => !c.parent)
  const groups = [
    { label: "Spending", group: "expense" },
    { label: "Income", group: "income" },
    { label: "Transfers", group: "transfer" },
  ] as const
  return groups.flatMap((g) =>
    tops
      .filter((c) => c.group === g.group)
      .flatMap((c) => [c, ...visible.filter((x) => x.parent === c.code)])
      .map((c) => ({
        value: c.code,
        label: c.label,
        group: g.label,
        indent: Boolean(c.parent),
      }))
  )
}

/** A searchable category field; `placeholder` adds a "none" option. */
export function CategorySelect({
  value,
  onChange,
  categories,
  placeholder,
  id,
  className,
  includeHidden = false,
  disabled,
  size,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (code: string) => void
  categories: Category[]
  placeholder?: string
  id?: string
  className?: string
  includeHidden?: boolean
  disabled?: boolean
  size?: "sm" | "default"
  "aria-label"?: string
}) {
  return (
    <CategoryPicker
      id={id}
      label={ariaLabel ?? "Category"}
      value={value}
      onChange={onChange}
      categories={categories}
      emptyOption={placeholder}
      placeholder={placeholder ?? "Choose a category"}
      includeHidden={includeHidden}
      disabled={disabled}
      className={cn(size === "sm" && "h-7", className)}
    />
  )
}
