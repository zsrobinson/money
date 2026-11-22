import { useEffect, useState } from "react"
import { useQuery, type QueryClient } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  Link,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { AppShell, type NavGroup } from "@zsrobinson/shell"
import {
  NotFound,
  RouteError,
  SignedOut,
} from "@zsrobinson/shell/blocks/page-states"
import {
  ArrowLeftRightIcon,
  ChartPieIcon,
  CircleDollarSignIcon,
  GoalIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  ListFilterIcon,
  ShapesIcon,
  StoreIcon,
  PlusIcon,
  ReceiptTextIcon,
  RepeatIcon,
  SettingsIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react"
import { AppBreadcrumbs } from "@/components/app-breadcrumbs"
import { ApiError } from "@/lib/api"
import {
  accountsQuery,
  categoriesQuery,
  metaQuery,
  searchQuery,
  sessionQuery,
} from "@/lib/queries"
import { money, shortDate } from "@/lib/format"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: ({ context: { queryClient } }) => {
      void queryClient.prefetchQuery(sessionQuery)
      void queryClient.prefetchQuery(metaQuery)
    },
    component: Root,
    notFoundComponent: () => <NotFound homeLabel="Go to dashboard" />,
    errorComponent: RouteError,
  }
)

function Root() {
  const session = useQuery(sessionQuery)
  const meta = useQuery(metaQuery)
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const at = (path: string) =>
    path === "/"
      ? pathname === "/"
      : pathname === path || pathname.startsWith(`${path}/`)
  const link = (
    id: string,
    label: string,
    to: string,
    icon: React.ReactNode,
    extra: Partial<NavGroup["items"][number]> = {}
  ) => ({
    id,
    label,
    icon,
    render: <Link to={to} />,
    onSelect: () => void navigate({ to }),
    active: at(to),
    ...extra,
  })
  const unreviewed = meta.data?.unreviewed ?? 0
  const groups: NavGroup[] = [
    {
      id: "main",
      items: [
        link("dashboard", "Dashboard", "/", <LayoutDashboardIcon />),
        link("accounts", "Accounts", "/accounts", <LandmarkIcon />),
        link(
          "transactions",
          "Transactions",
          "/transactions",
          <ReceiptTextIcon />,
          {
            badge: unreviewed ? (
              <span className="tabular-nums">{unreviewed}</span>
            ) : undefined,
          }
        ),
        link("cashflow", "Cash flow", "/cash-flow", <ArrowLeftRightIcon />),
        link("reports", "Reports", "/reports", <ChartPieIcon />, {
          children: [
            {
              ...link("reports-categories", "Categories", "/reports", null),
              active: pathname === "/reports" || at("/reports/categories"),
            },
            link("reports-merchants", "Merchants", "/reports/merchants", null),
            link("reports-builder", "Builder", "/reports/builder", null),
          ],
        }),
      ],
    },
    {
      id: "plan",
      label: "Planning",
      items: [
        link("budgets", "Budgets", "/budgets", <WalletIcon />),
        link("recurring", "Recurring", "/recurring", <RepeatIcon />),
        link("goals", "Goals", "/goals", <GoalIcon />),
        link("investments", "Investments", "/investments", <TrendingUpIcon />),
      ],
    },
    {
      id: "setup",
      label: "Setup",
      items: [
        link("categories", "Categories", "/categories", <ShapesIcon />),
        link("rules", "Rules", "/rules", <ListFilterIcon />),
        link("settings", "Settings", "/settings", <SettingsIcon />),
      ],
    },
    {
      id: "jump-accounts",
      label: "Accounts",
      hidden: true,
      items: (accounts.data ?? [])
        .filter((a) => !a.hidden)
        .map((a) =>
          link(
            `account-${a.id}`,
            a.name,
            `/accounts/${a.id}`,
            <LandmarkIcon />,
            { active: false }
          )
        ),
    },
    {
      id: "jump-categories",
      label: "Categories",
      hidden: true,
      items: (categories.data ?? [])
        .filter((c) => !c.hidden && c.group !== "transfer")
        .map((c) =>
          link(
            `category-${c.code}`,
            c.label,
            `/reports/categories/${c.code}`,
            <CircleDollarSignIcon />,
            { active: false }
          )
        ),
    },
    {
      id: "actions",
      label: "Actions",
      hidden: true,
      items: [
        link(
          "review",
          "Review transactions",
          "/transactions?status=unreviewed",
          <ReceiptTextIcon />,
          { active: false }
        ),
        link("new-rule", "New rule", "/rules/new", <PlusIcon />, {
          active: false,
        }),
        link("new-goal", "New goal", "/goals/new", <PlusIcon />, {
          active: false,
        }),
      ],
    },
  ]
  // Merchants and transactions come from the server as you type.
  const [typed, setTyped] = useState("")
  const [term, setTerm] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setTerm(typed.trim()), 200)
    return () => clearTimeout(id)
  }, [typed])
  const found = useQuery(searchQuery(term))
  const searchGroups: NavGroup[] =
    term.length > 1 && found.data
      ? [
          {
            id: "search-merchants",
            label: "Merchants",
            items: found.data.merchants.map((m) =>
              link(
                `merchant-${m.key}`,
                m.name,
                `/reports/merchants/${encodeURIComponent(m.key)}`,
                <StoreIcon />,
                { active: false }
              )
            ),
          },
          {
            id: "search-transactions",
            label: "Transactions",
            items: found.data.transactions.map((t) =>
              link(
                `txn-${t.id}`,
                `${t.merchant ?? t.description ?? "Transaction"} · ${shortDate(t.date, meta.data?.today)} · ${money(t.amountCents)}`,
                `/transactions/${t.id}`,
                <ReceiptTextIcon />,
                { active: false }
              )
            ),
          },
        ].filter((g) => g.items.length)
      : []
  const signedOut =
    session.error instanceof ApiError && session.error.status === 401
  return (
    <AppShell
      name="Money"
      email={session.data?.email}
      apps={session.isError ? [] : session.data?.services}
      navGroups={groups}
      searchPlaceholder="Search pages, merchants and transactions…"
      search={{
        onQueryChange: setTyped,
        groups: searchGroups,
        loading: term.length > 1 && found.isFetching,
      }}
      breadcrumbs={<AppBreadcrumbs />}
    >
      {signedOut ? <SignedOut /> : <Outlet />}
    </AppShell>
  )
}
