import { Link, useLocation } from "@tanstack/react-router"
import { Button } from "@zsrobinson/shell/ui/button"

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

/** Report pages as a segmented row; the sidebar hides its sub-pages on a phone. */
export function ReportNav() {
  const pathname = useLocation({ select: (l) => l.pathname.replace(/\/$/, "") })
  return (
    <nav
      aria-label="Reports"
      className="flex gap-1 rounded-full bg-muted p-0.5"
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
              <Link to={p.to} aria-current={active ? "page" : undefined} />
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
