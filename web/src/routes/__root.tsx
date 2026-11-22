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
  sessionQuery,
} from "@/lib/queries"

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
  const signedOut =
    session.error instanceof ApiError && session.error.status === 401
  return (
    <AppShell
      name="Money"
      email={session.data?.email}
      apps={session.isError ? [] : session.data?.services}
      navGroups={groups}
      searchPlaceholder="Jump to a page, account or category…"
      breadcrumbs={<AppBreadcrumbs />}
    >
      {signedOut ? <SignedOut /> : <Outlet />}
    </AppShell>
  )
}
