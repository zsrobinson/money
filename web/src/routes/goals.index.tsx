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
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@zsrobinson/shell/ui/card"
import { PlusIcon, TriangleAlertIcon } from "lucide-react"
import { allocationLabel, goalDone, GoalStatus } from "@/components/goals"
import { EmptyState, Loading, Meter, Stat, StatRow } from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import { fullDate, money, percent } from "@/lib/format"
import { goalsQuery } from "@/lib/queries"
import type { Goal } from "@/lib/types"

export const Route = createFileRoute("/goals/")({
  staticData: { crumbs: [{ label: "Goals", to: "/goals" }] },
  component: Goals,
})

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
        <>
          <StatRow>
            <Stat label="Saved">
              {money(
                q.data
                  .filter((g) => g.kind === "save")
                  .reduce(
                    (s, g) => s + Math.min(g.currentCents, g.targetCents),
                    0
                  ),
                { whole: true }
              )}
            </Stat>
            <Stat label="Debt left">
              {money(
                q.data
                  .filter((g) => g.kind === "payoff")
                  .reduce((s, g) => s + g.currentCents, 0),
                { whole: true }
              )}
            </Stat>
            <Stat label="On track">
              {q.data.filter((g) => g.progress >= 1 || g.onTrack).length} of{" "}
              {q.data.length}
            </Stat>
          </StatRow>
          <PageGrid className="sm:grid-cols-2 lg:grid-cols-3">
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
                      {money(goalDone(g), { whole: true })}
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
                  <GoalFacts goal={g} />
                </CardContent>
              </Card>
            ))}
          </PageGrid>
        </>
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

/** Where the money is, the monthly plan against what it takes, and overlaps. */
function GoalFacts({ goal: g }: { goal: Goal }) {
  const needed = g.progress >= 1 ? null : g.neededMonthlyCents
  return (
    <dl className="flex flex-col gap-1.5 border-t pt-3 text-xs">
      {g.allocations.map((a) => (
        <div key={a.accountId} className="flex justify-between gap-3">
          <dt className="min-w-0 text-muted-foreground">{a.accountName}</dt>
          <dd className="shrink-0 text-right tabular-nums">
            {allocationLabel(a)}
          </dd>
        </div>
      ))}
      {g.monthlyCents || needed != null ? (
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Planned / needed a month</dt>
          <dd className="shrink-0 text-right tabular-nums">
            {g.monthlyCents ? money(g.monthlyCents, { whole: true }) : "—"} /{" "}
            {needed != null ? money(needed, { whole: true }) : "—"}
          </dd>
        </div>
      ) : null}
      {g.overlaps.length ? (
        <div className="flex items-start gap-1.5 text-muted-foreground">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          <span>
            Shares{" "}
            {g.overlaps
              .map((o) => `${o.accountName} with ${o.goals.join(", ")}`)
              .join("; ")}
          </span>
        </div>
      ) : null}
    </dl>
  )
}
