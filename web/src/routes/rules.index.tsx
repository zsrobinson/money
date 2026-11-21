import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Page, PageActions, PageHeader, PageTitle } from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card } from "@zsrobinson/shell/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zsrobinson/shell/ui/dropdown-menu"
import { Switch } from "@zsrobinson/shell/ui/switch"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisIcon,
  PlusIcon,
} from "lucide-react"
import { EmptyState, Loading } from "@/components/money"
import { ruleParts, RulesHelp } from "@/components/rules"
import { useCategoryLabels } from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import { pluralize } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { accountsQuery, rulesQuery } from "@/lib/queries"

export const Route = createFileRoute("/rules/")({
  staticData: { crumbs: [{ label: "Rules", to: "/rules" }] },
  component: Rules,
})

function Rules() {
  usePageTitle("Rules")
  const rules = useQuery(rulesQuery)
  const accounts = useQuery(accountsQuery)
  const label = useCategoryLabels()
  const accountName = (id: string) =>
    accounts.data?.find((a) => a.id === id)?.name ?? "one account"
  const toggle = useSend<{ id: string; enabled: boolean }>(
    "PATCH",
    (v) => `/api/rules/${v.id}`,
    {
      body: (v) => ({ enabled: v.enabled }),
      success: (_, v) => (v.enabled ? "Rule turned on" : "Rule turned off"),
    }
  )
  const order = useSend<{ ids: string[] }>("POST", "/api/rules/order", {
    success: "Order saved",
  })
  const list = rules.data ?? []
  const move = (index: number, by: number) => {
    const ids = list.map((r) => r.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + by, 0, id)
    order.mutate({ ids })
  }
  return (
    <Page>
      <PageHeader>
        <div className="flex items-center gap-1.5">
          <PageTitle>Rules</PageTitle>
          <RulesHelp />
        </div>
        <PageActions>
          <Button
            size="sm"
            render={<Link to="/rules/new" />}
            nativeButton={false}
          >
            <PlusIcon data-icon="inline-start" />
            New rule
          </Button>
        </PageActions>
      </PageHeader>
      {rules.isError ? (
        <QueryError
          title="Rules failed to load"
          error={rules.error}
          onRetry={() => rules.refetch()}
        />
      ) : null}
      <Card className="gap-0 py-0">
        {!rules.data ? (
          <Loading rows={5} className="p-4" />
        ) : list.length ? (
          <ol className="flex flex-col divide-y divide-border/70">
            {list.map((r, i) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-4 py-2 sm:px-5"
              >
                <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <Link
                  to="/rules/$id"
                  params={{ id: r.id }}
                  className="flex min-h-10 min-w-0 flex-1 flex-col justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {(() => {
                    const p = ruleParts(r, label, accountName)
                    return (
                      <>
                        <span
                          className={`text-sm ${r.enabled ? "" : "text-muted-foreground"}`}
                        >
                          {p.when}
                        </span>
                        <span
                          className={`text-sm font-medium ${r.enabled ? "" : "text-muted-foreground"}`}
                        >
                          {p.then}
                        </span>
                      </>
                    )
                  })()}
                  <span className="text-xs text-muted-foreground">
                    {r.enabled
                      ? `${pluralize(r.matches ?? 0, "transaction")} match`
                      : "Off"}
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="max-sm:hidden"
                    aria-label="Move up"
                    disabled={i === 0 || order.isPending}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="max-sm:hidden"
                    aria-label="Move down"
                    disabled={i === list.length - 1 || order.isPending}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="sm:hidden"
                          aria-label="Reorder rule"
                        />
                      }
                    >
                      <EllipsisIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUpIcon />
                        Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === list.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDownIcon />
                        Move down
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Switch
                    className="ml-2"
                    aria-label={r.enabled ? "Turn rule off" : "Turn rule on"}
                    checked={r.enabled}
                    onCheckedChange={(enabled) =>
                      toggle.mutate({ id: r.id, enabled })
                    }
                  />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="No rules yet"
            action={
              <Button
                size="sm"
                render={<Link to="/rules/new" />}
                nativeButton={false}
              >
                Create a rule
              </Button>
            }
          >
            Rules recategorize, rename, tag or hide matching transactions, past
            and future.
          </EmptyState>
        )}
      </Card>
    </Page>
  )
}
