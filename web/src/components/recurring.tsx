import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { cn } from "@zsrobinson/shell"
import { Badge } from "@zsrobinson/shell/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zsrobinson/shell/ui/tooltip"
import { CheckIcon } from "lucide-react"
import { CategoryIcon, useCategories } from "@/components/category-style"
import { Amount } from "@/components/money"
import { CADENCE } from "@/lib/format"
import type { Occurrence, Recurring } from "@/lib/types"

export const STATUS_LABEL: Record<Recurring["status"], string> = {
  active: "Active",
  inactive: "Stopped",
  cancelled: "Cancelled",
  ignored: "Not recurring",
}

export const cadenceLabel = (cadence: string) => CADENCE[cadence] ?? cadence

/** Bills are paid or due; income is received or expected. */
export function stateLabel(
  state: Occurrence["state"],
  kind: Recurring["kind"]
) {
  if (state === "paid") return kind === "income" ? "Received" : "Paid"
  if (state === "due") return kind === "income" ? "Expected" : "Due"
  return "Missed"
}

/** One badge style per expected charge's state, everywhere it shows. */
export function StateBadge({
  state,
  kind,
  className,
}: {
  state: Occurrence["state"]
  kind: Recurring["kind"]
  className?: string
}) {
  return (
    <Badge
      variant={
        state === "paid"
          ? "secondary"
          : state === "missed"
            ? "destructive"
            : "outline"
      }
      className={cn(
        state === "paid" && "text-muted-foreground",
        state === "due" && "text-muted-foreground",
        className
      )}
    >
      {state === "paid" ? <CheckIcon data-icon="inline-start" /> : null}
      {stateLabel(state, kind)}
    </Badge>
  )
}

/** The schedule came from the bank rather than from detection. */
export function BankBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={cn(
              "h-4 px-1.5 text-[11px] font-normal text-muted-foreground",
              className
            )}
          />
        }
      >
        Bank
      </TooltipTrigger>
      <TooltipContent>Schedule from your bank</TooltipContent>
    </Tooltip>
  )
}

/** A recurring item's category icon, in its fixed colour. */
export function RecurringIcon({
  category,
  size,
  className,
}: {
  category: string
  size?: "sm" | "md"
  className?: string
}) {
  const c = useCategories().get(category)
  return (
    <CategoryIcon
      icon={c?.icon}
      color={c?.color}
      size={size}
      className={className}
    />
  )
}

/**
 * One expected charge as a row: a date column, the merchant with its
 * category icon, the state badge and the amount. Rows link to the item.
 */
export function OccurrenceRow({
  occurrence: o,
  date,
  detail,
}: {
  occurrence: Occurrence
  /** The left date column; omitted under a day heading. */
  date?: ReactNode
  detail?: ReactNode
}) {
  return (
    <li className="border-b border-border/70 last:border-b-0">
      <Link
        to="/recurring/$key"
        params={{ key: o.key }}
        className={cn(
          "grid min-h-13 items-center gap-x-3 py-2 pr-4 pl-4 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:pr-5 sm:pl-5",
          date
            ? "grid-cols-[2.75rem_2rem_minmax(0,1fr)_auto] sm:grid-cols-[3rem_2rem_minmax(0,1fr)_5.5rem_6rem]"
            : "grid-cols-[2rem_minmax(0,1fr)_auto] sm:grid-cols-[2rem_minmax(0,1fr)_5.5rem_6rem]"
        )}
      >
        {date ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {date}
          </span>
        ) : null}
        <RecurringIcon category={o.category} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 text-sm font-medium">{o.merchant}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StateBadge state={o.state} kind={o.kind} className="sm:hidden" />
            {detail ? <span className="truncate">{detail}</span> : null}
          </span>
        </span>
        <span className="hidden sm:flex">
          <StateBadge state={o.state} kind={o.kind} />
        </span>
        <Amount
          cents={o.amountCents}
          className={cn(
            "text-right text-sm font-medium whitespace-nowrap",
            o.state === "paid" && "text-muted-foreground"
          )}
        />
      </Link>
    </li>
  )
}
