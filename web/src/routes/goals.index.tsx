import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@zsrobinson/shell/ui/card"
import { PlusIcon } from "lucide-react"
import { EmptyState, Loading, Meter } from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import { fullDate, money, percent } from "@/lib/format"
import { goalsQuery } from "@/lib/queries"
import type { Goal } from "@/lib/types"

export const Route = createFileRoute("/goals/")({
  staticData: { crumbs: [{ label: "Goals", to: "/goals" }] },
  component: Goals,
})

export function GoalStatus({ goal: g }: { goal: Goal }) {
  if (g.progress >= 1) return <Badge>Reached</Badge>
  if (g.onTrack === true) return <Badge variant="secondary">On track</Badge>
  if (g.onTrack === false) return <Badge variant="destructive">Behind</Badge>
  return null
}

function Goals() {
  usePageTitle("Goals")
  const q = useQuery(goalsQuery)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Goals</PageTitle>
        <PageActions>
          <Button
            size="sm"
            render={<Link to="/goals/new" />}
            nativeButton={false}
          >
            <PlusIcon data-icon="inline-start" />
            New goal
          </Button>
        </PageActions>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="Goals failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : null}
      {!q.data ? (
        <Loading rows={6} />
      ) : q.data.length ? (
        <PageGrid layout="two">
          {q.data.map((g) => (
            <Card key={g.id} className="relative min-w-0">
              <CardHeader>
                <CardTitle>
                  <Link
                    to="/goals/$id"
                    params={{ id: g.id }}
                    className="outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring"
                  >
                    {g.name}
                  </Link>
                </CardTitle>
                <CardAction>
                  <GoalStatus goal={g} />
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xl font-semibold tracking-tight tabular-nums">
                    {money(
                      g.kind === "payoff"
                        ? g.targetCents - g.currentCents
                        : g.currentCents,
                      { whole: true }
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {g.kind === "payoff" ? "paid of " : "of "}
                    {money(g.targetCents, { whole: true })}
                  </span>
                </div>
                <Meter
                  label={`${g.name} progress`}
                  value={g.progress}
                  tone={g.progress >= 1 ? "positive" : "default"}
                />
                <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                  <span>
                    {percent(g.progress)}{" "}
                    {g.kind === "payoff" ? "paid off" : "saved"}
                  </span>
                  <span>
                    {g.progress >= 1
                      ? "Done"
                      : g.projectedDate
                        ? `Projected ${fullDate(g.projectedDate)}`
                        : g.targetDate
                          ? `Target ${fullDate(g.targetDate)}`
                          : "No recent progress"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </PageGrid>
      ) : (
        <EmptyState
          title="No goals yet"
          action={
            <Button
              size="sm"
              render={<Link to="/goals/new" />}
              nativeButton={false}
            >
              Create a goal
            </Button>
          }
        >
          Track saving toward an amount or paying down a debt.
        </EmptyState>
      )}
    </Page>
  )
}
