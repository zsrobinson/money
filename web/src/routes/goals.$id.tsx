import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageGrid,
  PageHeader,
  PageMeta,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { Loading, Meter, SectionCard, Stat, StatRow } from "@/components/money"
import { GoalForm } from "@/components/goals"
import { usePageTitle } from "@/lib/crumb"
import { epoch, epochFullDate, fullDate, money, percent } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { goalQuery } from "@/lib/queries"
import { GoalStatus } from "./goals.index"

export const Route = createFileRoute("/goals/$id")({
  staticData: { crumbs: [{ label: "Goals", to: "/goals" }] },
  component: GoalPage,
})

function GoalPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const q = useQuery(goalQuery(id))
  usePageTitle(q.data?.name, true)
  const remove = useSend("DELETE", `/api/goals/${id}`, {
    success: "Goal deleted",
    onSuccess: () => void navigate({ to: "/goals" }),
  })
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
  if (!g)
    return (
      <Page>
        <Loading rows={6} />
      </Page>
    )
  const remaining =
    g.kind === "payoff"
      ? g.currentCents
      : Math.max(0, g.targetCents - g.currentCents)
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 flex-col">
          <PageTitle className="truncate">{g.name}</PageTitle>
          <PageMeta>
            <span>{g.kind === "payoff" ? "Paying off debt" : "Saving up"}</span>
            <span>{g.accountNames.join(", ")}</span>
            <GoalStatus goal={g} />
          </PageMeta>
        </div>
      </PageHeader>
      <PageGrid layout="wide">
        <PageStack>
          <SectionCard title="Progress">
            <StatRow className="mb-4">
              <Stat label={g.kind === "payoff" ? "Paid off" : "Saved"}>
                {money(
                  g.kind === "payoff"
                    ? g.targetCents - g.currentCents
                    : g.currentCents,
                  { whole: true }
                )}
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
              label={`${g.name}, last 12 months`}
              baseline="data"
              data={g.series.map((p) => ({
                time: epoch(p.date),
                value: p.cents / 100,
              }))}
              config={{
                value: {
                  label: g.kind === "payoff" ? "Owed" : "Saved",
                  color: "var(--chart-1)",
                },
              }}
              format={(v) => money(Math.round(v * 100), { whole: true })}
              formatTime={epochFullDate}
              className="mt-4 h-52"
            />
          </SectionCard>
          <SectionCard title="Pace">
            <DetailList>
              <DetailRow label="Monthly change">
                <span
                  className={
                    (g.kind === "payoff"
                      ? -g.monthlyChangeCents
                      : g.monthlyChangeCents) > 0
                      ? "text-positive"
                      : ""
                  }
                >
                  {money(Math.abs(g.monthlyChangeCents), { whole: true })}{" "}
                  {g.kind === "payoff"
                    ? g.monthlyChangeCents <= 0
                      ? "paid"
                      : "added"
                    : g.monthlyChangeCents >= 0
                      ? "saved"
                      : "withdrawn"}
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
              <DetailRow label="Target date">
                {g.targetDate ? (
                  fullDate(g.targetDate)
                ) : (
                  <Unavailable>None</Unavailable>
                )}
              </DetailRow>
            </DetailList>
          </SectionCard>
        </PageStack>
        <PageStack>
          <GoalForm key={`${g.id}-${g.targetCents}-${g.name}`} goal={g} />
          <ConfirmAction
            trigger={
              <Button variant="ghost" className="self-start text-destructive">
                Delete goal
              </Button>
            }
            title={`Delete ${g.name}?`}
            confirmLabel="Delete goal"
            destructive
            onConfirm={() => remove.mutateAsync()}
          >
            Your accounts and transactions are unchanged.
          </ConfirmAction>
        </PageStack>
      </PageGrid>
    </Page>
  )
}
