import type { ComponentProps, ReactNode } from "react"
import { cn } from "@zsrobinson/shell"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@zsrobinson/shell/ui/empty"
import { ChartRangeSelect } from "@zsrobinson/shell/blocks/chart-card"
import { money, RANGE_OPTIONS } from "@/lib/format"
import type { Range } from "@/lib/types"

/**
 * Money with tabular figures. Inflows read green with a plus sign; outflows
 * stay in the body colour so a page of spending is not a wall of red.
 * `signed` also colours negatives, for gains and losses.
 */
export function Amount({
  cents,
  currency,
  tone = "inflow",
  whole = false,
  className,
}: {
  cents: number | null | undefined
  currency?: string
  tone?: "inflow" | "signed" | "plain"
  whole?: boolean
  className?: string
}) {
  const positive = cents != null && cents > 0
  const negative = cents != null && cents < 0
  return (
    <span
      className={cn(
        "tabular-nums",
        tone !== "plain" && positive && "text-positive",
        tone === "signed" && negative && "text-negative",
        cents == null && "text-muted-foreground",
        className
      )}
    >
      {money(cents, { currency, sign: tone !== "plain", whole })}
    </span>
  )
}

/** A neutral initial mark; remote logos are never loaded. */
export function MerchantMark({
  name,
  className,
}: {
  name: string | null | undefined
  className?: string
}) {
  const letter =
    (name ?? "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .charAt(0)
      .toUpperCase() || "·"
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground",
        className
      )}
    >
      {letter}
    </span>
  )
}

export function SectionCard({
  title,
  action,
  children,
  className,
  contentClassName,
  flush = false,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  /** Content reaches the card edges, for lists and tables. */
  flush?: boolean
}) {
  return (
    <Card className={cn("min-w-0", flush && "pb-0", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {action ? (
          <CardAction className="flex items-center gap-2">{action}</CardAction>
        ) : null}
      </CardHeader>
      <CardContent className={cn(flush && "px-0", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  )
}

/** A figure with its label above and context below. */
export function Stat({
  label,
  children,
  detail,
  className,
}: {
  label: ReactNode
  children: ReactNode
  detail?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tracking-tight tabular-nums">
        {children}
      </span>
      {detail ? (
        <span className="text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  )
}

/** A row of figures that wraps to two columns on a phone. */
export function StatRow({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10",
        className
      )}
      {...props}
    />
  )
}

export function RangeSelect({
  value,
  onChange,
}: {
  value: Range
  onChange: (range: Range) => void
}) {
  return (
    <ChartRangeSelect<Range>
      value={value}
      onChange={onChange}
      ranges={RANGE_OPTIONS as never}
    />
  )
}

export function Change({
  cents,
  suffix,
}: {
  cents: number
  suffix?: ReactNode
}) {
  return (
    <span className="tabular-nums">
      <span
        className={
          cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : ""
        }
      >
        {money(cents, { sign: true, whole: Math.abs(cents) >= 100000 })}
      </span>
      {suffix ? <span className="text-muted-foreground"> {suffix}</span> : null}
    </span>
  )
}

export function Meter({
  value,
  tone = "default",
  label,
}: {
  value: number
  tone?: "default" | "over" | "positive"
  label: string
}) {
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(1, Math.max(0, value)) * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full rounded-full",
          tone === "over"
            ? "bg-negative"
            : tone === "positive"
              ? "bg-positive"
              : "bg-primary"
        )}
        style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }}
      />
    </div>
  )
}

export function Loading({
  rows = 4,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("flex flex-col gap-2", className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <Empty className="border-0 py-8">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {children ? <EmptyDescription>{children}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
