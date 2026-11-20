import { Link, useLocation } from "@tanstack/react-router"
import { Button } from "@zsrobinson/shell/ui/button"
import type { Range } from "@/lib/types"

const PAGES = [
  {
    to: "/reports",
    label: "Categories",
    match: (p: string) =>
      p === "/reports" || p.startsWith("/reports/categories"),
  },
  {
    to: "/reports/merchants",
    label: "Merchants",
    match: (p: string) => p.startsWith("/reports/merchants"),
  },
  {
    to: "/reports/trends",
    label: "Trends",
    match: (p: string) => p.startsWith("/reports/trends"),
  },
] as const

/**
 * Report pages as a segmented row (the sidebar hides its sub-pages on a
 * phone). The chosen range travels with every tab.
 */
export function ReportNav({ range }: { range: Range }) {
  const pathname = useLocation({ select: (l) => l.pathname.replace(/\/$/, "") })
  return (
    <nav
      aria-label="Reports"
      className="flex w-fit gap-1 rounded-full bg-muted p-0.5"
    >
      {PAGES.map((p) => {
        const active = p.match(pathname)
        return (
          <Button
            key={p.to}
            size="sm"
            variant={active ? "outline" : "ghost"}
            className={
              active
                ? "bg-background shadow-xs dark:bg-background"
                : "text-muted-foreground"
            }
            render={
              <Link
                to={p.to}
                search={{ range }}
                aria-current={active ? "page" : undefined}
              />
            }
            nativeButton={false}
          >
            {p.label}
          </Button>
        )
      })}
    </nav>
  )
}

/** Months of monthly history a range covers, for charts drawn by month. */
export function rangeMonths(range: Range, today: string) {
  if (range === "1m" || range === "3m") return 3
  if (range === "6m") return 6
  if (range === "ytd") return Math.max(3, Number(today.slice(5, 7)))
  if (range === "1y") return 12
  return 24
}
