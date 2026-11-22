import { Children, type ComponentProps, type ReactNode } from "react"
import { cn } from "@zsrobinson/shell"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@zsrobinson/shell/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@zsrobinson/shell/ui/tooltip"
import { Skeleton } from "@zsrobinson/shell/ui/skeleton"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@zsrobinson/shell/ui/empty"
import { Button } from "@zsrobinson/shell/ui/button"
import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, InfoIcon } from "lucide-react"
import { Choice } from "@/components/pickers"
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
  info,
  action,
  children,
  footer,
  className,
  contentClassName,
  flush = false,
  fill = false,
}: {
  title: ReactNode
  /** A short explanation behind an info icon beside the title. */
  info?: ReactNode
  action?: ReactNode
  children: ReactNode
  /** Actions or notes at the bottom of the card, such as Save and Delete. */
  footer?: ReactNode
  className?: string
  contentClassName?: string
  /** Content reaches the card edges, for lists and tables. */
  flush?: boolean
  /** Stretch to the row's height; the content grows to fill it. */
  fill?: boolean
}) {
  return (
    <Card
      className={cn(
        "min-w-0",
        flush && !footer && "gap-2 pb-0",
        flush && footer && "gap-2",
        fill && "h-full",
        className
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          {title}
          {info ? (
            <InfoTip label={`About ${String(title)}`}>{info}</InfoTip>
          ) : null}
        </CardTitle>
        {action ? (
          <CardAction className="flex items-center gap-2">{action}</CardAction>
        ) : null}
      </CardHeader>
      <CardContent
        className={cn(
          flush && "px-0",
          fill && "flex flex-1 flex-col",
          contentClassName
        )}
      >
        {children}
      </CardContent>
      {footer ? (
        <CardFooter className="flex-wrap justify-end gap-2 border-t">
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  )
}

/** Explanations live behind this icon instead of in subheads. */
export function InfoTip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={label}
            className="text-muted-foreground"
          />
        }
      >
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{children}</TooltipContent>
    </Tooltip>
  )
}

/** A figure with its label above and, when it is data, context below. */
export function Stat({
  label,
  children,
  detail,
  info,
  className,
}: {
  label: ReactNode
  children: ReactNode
  detail?: ReactNode
  /** How the figure is worked out, behind an info icon. */
  info?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="flex min-h-5 items-center gap-0.5 text-xs text-muted-foreground sm:text-sm">
        {label}
        {info ? (
          <InfoTip label={`About ${String(label)}`}>{info}</InfoTip>
        ) : null}
      </span>
      <span className="text-lg font-semibold tracking-tight tabular-nums sm:text-xl">
        {children}
      </span>
      {detail ? (
        <span className="text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  )
}

/** A row of figures: up to three across on a phone (four make a 2×2), one line on wider screens. */
export function StatRow({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  const count = Children.toArray(children).filter(Boolean).length
  return (
    <div
      className={cn(
        "grid gap-x-4 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10",
        count === 4 || count === 2
          ? "grid-cols-2"
          : count >= 3
            ? "grid-cols-3"
            : "grid-cols-1",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** The one style for a card's "go to" action: quiet, with an arrow. */
export function CardLink({
  to,
  search,
  params,
  children,
}: {
  to: string
  search?: Record<string, unknown>
  params?: Record<string, string>
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      render={
        <Link to={to} search={search as never} params={params as never} />
      }
      nativeButton={false}
    >
      {children}
      <ArrowRightIcon data-icon="inline-end" />
    </Button>
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
    <Choice
      aria-label="Time range"
      size="sm"
      align="end"
      className="w-36"
      value={value}
      onChange={(v) => onChange(v as Range)}
      options={RANGE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
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

/**
 * A small segmented control (the report tabs' look) for two to four
 * choices, such as chart type or a view toggle.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  label: string
  size?: "sm" | "xs"
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "flex w-fit shrink-0 gap-0.5 rounded-full bg-muted p-0.5",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <Button
            key={o.value}
            role="radio"
            aria-checked={active}
            title={o.title}
            size={size}
            variant={active ? "outline" : "ghost"}
            className={cn(
              size === "xs" && "h-6 px-2.5 text-xs",
              active
                ? "bg-background shadow-xs dark:bg-background"
                : "text-muted-foreground"
            )}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </Button>
        )
      })}
    </div>
  )
}

/**
 * Budget progress: the budget fills in the hue, anything over it in red at
 * the end so the overrun shows its size, and a tick marks how much of the
 * month has gone.
 */
export function BudgetBar({
  spent,
  budget,
  elapsed,
  label,
}: {
  spent: number
  budget: number
  /** 0–1 of the period gone; no tick outside (0, 1). */
  elapsed?: number
  label: string
}) {
  const scale = Math.max(budget, spent, 1)
  const within = Math.max(0, Math.min(spent, budget)) / scale
  const over = spent > budget ? (spent - Math.max(0, budget)) / scale : 0
  const ahead =
    elapsed !== undefined &&
    elapsed > 0 &&
    elapsed < 1 &&
    budget > 0 &&
    spent <= budget &&
    spent / budget > elapsed + 0.1
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(budget, 0)}
      aria-valuenow={Math.max(0, spent)}
      className="relative h-1.5 w-full rounded-full bg-muted"
    >
      <div className="flex h-full w-full overflow-hidden rounded-full">
        <div
          className="h-full bg-primary"
          style={{ width: `${within * 100}%` }}
        />
        {over > 0 ? (
          <div
            className="h-full border-l-2 border-background bg-negative"
            style={{ width: `${over * 100}%` }}
          />
        ) : null}
      </div>
      {elapsed !== undefined && elapsed > 0 && elapsed < 1 && budget > 0 ? (
        <div
          aria-hidden
          className={cn(
            "absolute -top-0.5 h-2.5 w-0.5 rounded-full",
            ahead ? "bg-warning" : "bg-foreground/60"
          )}
          style={{ left: `calc(${(budget * elapsed) / scale} * 100% - 1px)` }}
        />
      ) : null}
    </div>
  )
}
