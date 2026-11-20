import { Fragment } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { cn } from "@zsrobinson/shell"
import { Checkbox } from "@zsrobinson/shell/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zsrobinson/shell/ui/tooltip"
import { EyeOffIcon, NotebookPenIcon, SplitIcon } from "lucide-react"
import { Amount, MerchantMark } from "@/components/money"
import { Choice } from "@/components/pickers"
import { longDate, money, shortDate } from "@/lib/format"
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
 * Dense transaction rows. Columns follow the list's own width; a narrow list
 * stacks merchant over category and date. `grouped` adds a header per day
 * with that day's total, and `primary="account"` names the account instead
 * of the merchant (for a merchant's own page).
 */
export function TxnRows({
  items,
  selected,
  onToggle,
  showAccount = true,
  grouped = false,
  dayTotals,
  primary = "merchant",
  className,
}: {
  items: Txn[]
  selected?: Set<string>
  onToggle?: (id: string, on: boolean) => void
  showAccount?: boolean
  grouped?: boolean
  dayTotals?: Record<string, number>
  primary?: "merchant" | "account"
  className?: string
}) {
  const label = useCategoryLabels()
  const today = useQuery(metaQuery).data?.today
  const tags = new Map((useQuery(tagsQuery).data ?? []).map((t) => [t.id, t]))
  const wide = showAccount && primary === "merchant"
  const columns = grouped
    ? wide
      ? "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_6.5rem] @3xl:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem]"
      : "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_6.5rem]"
    : wide
      ? "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[5.5rem_2rem_minmax(0,2fr)_minmax(0,1fr)_6.5rem] @3xl:grid-cols-[5.5rem_2rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem]"
      : "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[5.5rem_2rem_minmax(0,2fr)_minmax(0,1fr)_6.5rem]"
  return (
    <ul className={cn("@container flex flex-col", className)}>
      {items.map((t, i) => {
        const header = grouped && (i === 0 || items[i - 1].date !== t.date)
        const name = primary === "account" ? t.accountName : txnName(t)
        return (
          <Fragment key={t.id}>
            {header ? (
              <li className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground sm:px-5">
                <span>
                  {today && t.date === today ? "Today" : longDate(t.date)}
                </span>
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
                    aria-label={`Select ${txnName(t)}, ${shortDate(t.date)}`}
                  />
                </span>
              ) : null}
              <Link
                to="/transactions/$id"
                params={{ id: t.id }}
                className={cn(
                  "grid min-h-13 flex-1 items-center gap-x-3 py-2 pr-4 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:min-h-11 sm:pr-5",
                  onToggle ? "pl-2" : "pl-4 sm:pl-5",
                  columns
                )}
              >
                {!grouped ? (
                  <span className="hidden text-sm whitespace-nowrap text-muted-foreground tabular-nums @xl:block">
                    {shortDate(t.date, today)}
                  </span>
                ) : null}
                <MerchantMark name={name} />
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{name}</span>
                    {t.pending ? (
                      <span className="shrink-0 rounded-full border px-1.5 text-[11px] leading-4 text-muted-foreground">
                        Pending
                      </span>
                    ) : null}
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
                  <span className="truncate text-xs text-muted-foreground @xl:hidden">
                    {t.split ? "Split" : label(t.category)}
                    {grouped ? "" : ` · ${shortDate(t.date, today)}`}
                  </span>
                  {t.tags.length ? (
                    <span className="hidden truncate text-xs text-muted-foreground @xl:block">
                      {t.tags
                        .map((id) => tags.get(id)?.name)
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  ) : null}
                </span>
                <span className="hidden truncate text-sm text-muted-foreground @xl:block">
                  {t.split ? "Split" : label(t.category)}
                </span>
                {wide ? (
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
