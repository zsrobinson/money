import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { cn } from "@zsrobinson/shell"
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@zsrobinson/shell/ui/native-select"
import { EyeOffIcon, NotebookPenIcon, SplitIcon } from "lucide-react"
import { Amount, MerchantMark } from "@/components/money"
import { shortDate } from "@/lib/format"
import { categoriesQuery, metaQuery, tagsQuery } from "@/lib/queries"
import type { Category, Txn } from "@/lib/types"

export function useCategoryLabels() {
  const categories = useQuery(categoriesQuery)
  const map = new Map((categories.data ?? []).map((c) => [c.code, c]))
  return (code: string) => map.get(code)?.label ?? code
}

export const txnName = (t: Pick<Txn, "merchant" | "description">) =>
  t.merchant ?? t.description ?? "Unnamed transaction"

/**
 * Dense transaction rows. Desktop shows date, merchant, category, account and
 * amount in columns; a phone stacks merchant over category and date.
 */
export function TxnRows({
  items,
  selected,
  onToggle,
  showAccount = true,
  className,
}: {
  items: Txn[]
  selected?: Set<string>
  onToggle?: (id: string, on: boolean) => void
  showAccount?: boolean
  className?: string
}) {
  const label = useCategoryLabels()
  const today = useQuery(metaQuery).data?.today
  const tags = new Map((useQuery(tagsQuery).data ?? []).map((t) => [t.id, t]))
  return (
    <ul
      className={cn(
        "@container flex flex-col divide-y divide-border/70",
        className
      )}
    >
      {items.map((t) => (
        <li
          key={t.id}
          className={cn(
            "group/row relative flex items-center",
            t.hidden && "opacity-60"
          )}
        >
          {onToggle ? (
            <label className="flex h-full shrink-0 cursor-pointer items-center self-stretch pr-1 pl-4 sm:pl-5">
              <input
                type="checkbox"
                className="size-4 cursor-pointer accent-(--primary)"
                checked={selected?.has(t.id) ?? false}
                onChange={(e) => onToggle(t.id, e.target.checked)}
                aria-label={`Select ${txnName(t)}, ${shortDate(t.date)}`}
              />
            </label>
          ) : null}
          <Link
            to="/transactions/$id"
            params={{ id: t.id }}
            className={cn(
              "grid min-h-13 flex-1 items-center gap-x-3 py-2 pr-4 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:min-h-11 sm:pr-5",
              onToggle ? "pl-2" : "pl-4 sm:pl-5",
              // Columns follow the list's own width, so narrow cards stack too.
              showAccount
                ? "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[4.5rem_2rem_minmax(0,1.4fr)_minmax(0,1fr)_7rem] @3xl:grid-cols-[4.5rem_2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_7rem]"
                : "grid-cols-[2rem_minmax(0,1fr)_auto] @xl:grid-cols-[4rem_2rem_minmax(0,2fr)_minmax(0,1fr)_6.5rem]"
            )}
          >
            <span className="hidden text-sm text-muted-foreground tabular-nums @xl:block">
              {shortDate(t.date, today)}
            </span>
            <MerchantMark name={txnName(t)} />
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {txnName(t)}
                </span>
                {t.pending ? (
                  <span className="shrink-0 rounded-full border px-1.5 text-[11px] leading-4 text-muted-foreground">
                    Pending
                  </span>
                ) : null}
                {!t.reviewed && !t.pending && !t.hidden ? (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-primary"
                    aria-label="Not reviewed"
                  />
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
                {label(t.category)} · {shortDate(t.date, today)}
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
            {showAccount ? (
              <span className="hidden truncate text-sm text-muted-foreground @3xl:block">
                {t.accountName}
              </span>
            ) : null}
            <Amount
              cents={t.amountCents}
              currency={t.currency}
              className="text-right text-sm font-medium"
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Categories grouped by income, spending and transfers; custom ones sit under their parent. */
export function CategorySelect({
  value,
  onChange,
  categories,
  placeholder,
  id,
  className,
  includeHidden = false,
  disabled,
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
  "aria-label"?: string
}) {
  const visible = categories.filter(
    (c) => includeHidden || !c.hidden || c.code === value
  )
  const tops = visible.filter((c) => !c.parent)
  const groups = [
    { label: "Spending", group: "expense" },
    { label: "Income", group: "income" },
    { label: "Transfers", group: "transfer" },
  ] as const
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("w-full", className)}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {placeholder !== undefined ? (
        <NativeSelectOption value="">{placeholder}</NativeSelectOption>
      ) : null}
      {groups.map((g) => (
        <NativeSelectOptGroup key={g.group} label={g.label}>
          {tops
            .filter((c) => c.group === g.group)
            .flatMap((c) => [c, ...visible.filter((x) => x.parent === c.code)])
            .map((c) => (
              <NativeSelectOption key={c.code} value={c.code}>
                {c.parent ? `\u2003${c.label}` : c.label}
              </NativeSelectOption>
            ))}
        </NativeSelectOptGroup>
      ))}
    </NativeSelect>
  )
}
