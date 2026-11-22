import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageMeta,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { PencilIcon } from "lucide-react"
import {
  allocationLabel,
  goalDone,
  GoalStatus,
  OverlapAlert,
} from "@/components/goals"
import { Loading, Meter, SectionCard, Stat, StatRow } from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import {
  epoch,
  epochFullDate,
  fullDate,
  money,
  moneyTick,
  percent,
} from "@/lib/format"
import { goalQuery, metaQuery } from "@/lib/queries"
import type { Goal } from "@/lib/types"

export const Route = createFileRoute("/goals/$id")({
  staticData: { crumbs: [{ label: "Goals", to: "/goals" }] },
  component: GoalPage,
})

const MONTH_MS = 30.44 * 86_400_000

/** History, then a dashed projection at the recent pace toward the target. */
function goalPoints(g: Goal, today: string) {
  type Point = { time: number; value: number | null; projection: number | null }
  const history: Point[] = (g.series ?? []).map((p) => ({
    time: epoch(p.date),
    value: p.cents / 100,
    projection: null,
  }))
  if (g.progress >= 1 || !g.projectedDate || !history.length) return history
  const last = history.at(-1)!
  last.projection = last.value
  const from = last.value ?? 0
  const end = epoch(g.projectedDate)
  const start = epoch(today)
  const steps = Math.min(24, Math.max(2, Math.round((end - start) / MONTH_MS)))
  const goalValue = g.kind === "payoff" ? 0 : g.targetCents / 100
  for (let i = 1; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps
    history.push({
      time: t,
      value: null,
      projection: from + ((goalValue - from) * i) / steps,
    })
  }
  return history
}

function GoalPage() {
  const { id } = Route.useParams()
  const q = useQuery(goalQuery(id))
  const today = useQuery(metaQuery).data?.today
  usePageTitle(q.data?.name, true)
  const g = q.data
  if (q.isError)
    return (
      <Page>
        <QueryError
          title="This goal failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      </Page>
    )
  if (!g || !today)
    return (
      <Page>
        <Loading rows={6} />
      </Page>
    )
  const remaining =
    g.kind === "payoff"
      ? g.currentCents
      : Math.max(0, g.targetCents - g.currentCents)
  const points = goalPoints(g, today)
  const pace =
    g.kind === "payoff" ? -g.monthlyChangeCents : g.monthlyChangeCents
  const needed = g.progress >= 1 ? null : g.neededMonthlyCents
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle>{g.name}</PageTitle>
          <PageMeta>
            <span>{g.kind === "payoff" ? "Paying off debt" : "Saving up"}</span>
            {g.targetDate ? <span>By {fullDate(g.targetDate)}</span> : null}
            <GoalStatus goal={g} />
          </PageMeta>
        </div>
        <PageActions>
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/goals/$id/edit" params={{ id: g.id }} />}
            nativeButton={false}
          >
            <PencilIcon data-icon="inline-start" />
            Edit goal
          </Button>
        </PageActions>
      </PageHeader>
      <OverlapAlert overlaps={g.overlaps} />
      <PageGrid layout="wide">
        <SectionCard title="Progress">
          <StatRow className="mb-4">
            <Stat label={g.kind === "payoff" ? "Paid off" : "Saved"}>
              {money(goalDone(g), { whole: true })}
            </Stat>
            <Stat label={g.kind === "payoff" ? "Still owed" : "To go"}>
              {money(remaining, { whole: true })}
            </Stat>
            <Stat label="Complete">{percent(g.progress)}</Stat>
          </StatRow>
          <Meter
            label={`${g.name} progress`}
            value={g.progress}
            tone={g.progress >= 1 ? "positive" : "default"}
          />
          <TrendChart
            label={`${g.name}: last 12 months and projection`}
            baseline="data"
            curve="linear"
            data={points}
            config={{
              value: {
                label: g.kind === "payoff" ? "Owed" : "Saved",
                color: "var(--chart-1)",
              },
              projection: {
                label: "At current pace",
                color: "var(--chart-neutral)",
              },
            }}
            dashed={["projection"]}
            // A payoff's target is the $0 baseline, which needs no line.
            references={
              g.kind === "payoff"
                ? []
                : [
                    {
                      value: g.targetCents / 100,
                      label: `Target ${money(g.targetCents, { whole: true })}`,
                      side: "left",
                    },
                  ]
            }
            markers={
              g.targetDate
                ? [{ time: epoch(g.targetDate), label: "Target date" }]
                : []
            }
            format={(v) => money(Math.round(v * 100), { whole: true })}
            formatTick={moneyTick}
            formatTime={epochFullDate}
            utc
            className="mt-4 h-56"
          />
        </SectionCard>
        <PageStack>
          <SectionCard title="Each month">
            <DetailList>
              <DetailRow label="Planned">
                {g.monthlyCents ? (
                  money(g.monthlyCents, { whole: true })
                ) : (
                  <Unavailable>Not set</Unavailable>
                )}
              </DetailRow>
              <DetailRow label="Needed">
                {g.progress >= 1 ? (
                  "Nothing"
                ) : needed != null ? (
                  <span className="flex items-center gap-2">
                    {g.monthlyCents && needed > g.monthlyCents ? (
                      <Badge variant="outline" className="font-normal">
                        {money(needed - g.monthlyCents, { whole: true })} short
                      </Badge>
                    ) : null}
                    {money(needed, { whole: true })}
                  </span>
                ) : (
                  <Unavailable>Set a target date</Unavailable>
                )}
              </DetailRow>
              <DetailRow label="Recent pace">
                <span
                  className={
                    pace > 0 ? "text-positive" : pace < 0 ? "text-negative" : ""
                  }
                >
                  {money(Math.abs(pace), { whole: true })}
                  {pace >= 0
                    ? g.kind === "payoff"
                      ? " paid"
                      : " saved"
                    : g.kind === "payoff"
                      ? " added"
                      : " withdrawn"}
                </span>
              </DetailRow>
              <DetailRow label="Projected finish">
                {g.progress >= 1 ? (
                  "Reached"
                ) : g.projectedDate ? (
                  fullDate(g.projectedDate)
                ) : (
                  <Unavailable>Not at the current pace</Unavailable>
                )}
              </DetailRow>
            </DetailList>
          </SectionCard>
          <SectionCard title={g.kind === "payoff" ? "Debts" : "Accounts"} flush>
            <ul className="flex flex-col border-t">
              {g.allocations.map((a) => (
                <li
                  key={a.accountId}
                  className="border-b border-border/70 last:border-b-0"
                >
                  <Link
                    to="/accounts/$id"
                    params={{ id: a.accountId }}
                    className="flex min-h-13 items-center gap-3 px-4 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:px-5"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {a.accountName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {allocationLabel(a)}
                      </span>
                    </span>
                    <span className="text-sm font-medium tabular-nums">
                      {money(a.cents, { whole: true })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </SectionCard>
        </PageStack>
      </PageGrid>
    </Page>
  )
}
