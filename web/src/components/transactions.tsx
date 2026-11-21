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
import { EyeOffIcon, NotebookPenIcon, SplitIcon } from "lucide-react"
import { Amount, MerchantMark } from "@/components/money"
import { Choice } from "@/components/pickers"
import { dayHeading, money, shortDate } from "@/lib/format"
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
            className="inline-block size-1.5 shrink-0 rounded-full bg-primary"
          />
        }
      />
      <TooltipContent>Needs review</TooltipContent>
    </Tooltip>
  )
}

/**
 * The one list of transactions used everywhere: grouped under a header per
 * day (Today, Yesterday, then full dates), the merchant with any Pending badge
 * beneath it, then a category column wide enough for the longest built-in
 * name. `secondary="account"` shows the account in that column instead, for
 * a merchant's own page; `showAccount` adds an account column on wide lists.
 * A narrow list stacks the category under the merchant. Only a list sorted
 * by something other than date drops the day headers (`grouped={false}`),
 * and then shows each date under the merchant.
 */
export function TxnRows({
  items,
  selected,
  onToggle,
  showAccount = true,
  dayTotals,
  secondary = "category",
  grouped = true,
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
  className?: string
}) {
  const label = useCategoryLabels()
  const today = useQuery(metaQuery).data?.today
  const tags = new Map((useQuery(tagsQuery).data ?? []).map((t) => [t.id, t]))
  const accountColumn = showAccount && secondary === "category"
  const columns = accountColumn
    ? "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[2rem_minmax(0,1fr)_11.5rem_6rem] @3xl:grid-cols-[2rem_minmax(0,1fr)_11.5rem_minmax(0,10rem)_6rem]"
    : "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[2rem_minmax(0,1fr)_11.5rem_6rem]"
  const secondText = (t: Txn) =>
    secondary === "account"
      ? t.accountName
      : t.split
        ? "Split"
        : label(t.category)
  return (
    <ul className={cn("@container flex flex-col", className)}>
      {items.map((t, i) => {
        const header = grouped && (i === 0 || items[i - 1].date !== t.date)
        const name = txnName(t)
        const tagNames = t.tags
          .map((id) => tags.get(id)?.name)
          .filter(Boolean)
          .join(", ")
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
            <li
              className={cn(
                "group/row relative flex items-center border-b border-border/70 last:border-b-0",
                t.hidden && "opacity-60"
              )}
            >
              {onToggle ? (
                <span className="flex shrink-0 items-center self-stretch pr-1 pl-4 sm:pl-5">
                  <Checkbox
                    checked={selected?.has(t.id) ?? false}
                    onCheckedChange={(on) => onToggle(t.id, on)}
                    aria-label={`Select ${name}, ${shortDate(t.date)}`}
                  />
                </span>
              ) : null}
              <Link
                to="/transactions/$id"
                params={{ id: t.id }}
                className={cn(
                  "grid min-h-13 flex-1 items-center gap-x-3 py-2 pr-4 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:pr-5",
                  onToggle ? "pl-2" : "pl-4 sm:pl-5",
                  columns
                )}
              >
                <MerchantMark name={name} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{name}</span>
                    {!t.reviewed && !t.pending && !t.hidden ? (
                      <ReviewDot />
                    ) : null}
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
                      grouped && !t.pending && !tagNames && "@xl:hidden"
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
                    <span className="min-w-0 truncate @xl:hidden">
                      {secondText(t)}
                    </span>
                    {t.pending ? (
                      <Badge
                        variant="outline"
                        className="h-4 px-1.5 text-[11px] font-normal text-muted-foreground"
                      >
                        Pending
                      </Badge>
                    ) : null}
                    {tagNames ? (
                      <span className="hidden min-w-0 truncate @xl:inline">
                        {tagNames}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="hidden truncate text-sm text-muted-foreground @xl:block">
                  {secondText(t)}
                </span>
                {accountColumn ? (
                  <span className="hidden truncate text-sm text-muted-foreground @3xl:block">
                    {t.accountName}
                  </span>
                ) : null}
                <Amount
                  cents={t.amountCents}
                  currency={t.currency}
                  className="text-right text-sm font-medium whitespace-nowrap"
                />
              </Link>
            </li>
          </Fragment>
        )
      })}
    </ul>
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
    <Choice
      id={id}
      size={size}
      value={value}
      onChange={onChange}
      options={categoryOptions(categories, value, includeHidden)}
      placeholder={placeholder}
      className={cn("w-full", className)}
      disabled={disabled}
      aria-label={ariaLabel}
    />
  )
}
