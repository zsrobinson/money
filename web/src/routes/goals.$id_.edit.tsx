import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { GoalForm } from "@/components/goals"
import { Loading } from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import { goalQuery, goalsQuery } from "@/lib/queries"

export const Route = createFileRoute("/goals/$id_/edit")({
  staticData: { crumbs: [{ label: "Goals", to: "/goals" }] },
  component: EditGoal,
})

function EditGoal() {
  const { id } = Route.useParams()
  const q = useQuery(goalQuery(id))
  // Other goals' allocations feed the overlap warning.
  const all = useQuery(goalsQuery)
  usePageTitle(q.data ? `Edit ${q.data.name}` : "Edit goal", true)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Edit goal</PageTitle>
      </PageHeader>
      {q.isError ? (
        <QueryError
          title="This goal failed to load"
          error={q.error}
          onRetry={() => q.refetch()}
        />
      ) : !q.data || !all.data ? (
        <Loading rows={6} />
      ) : (
        <GoalForm key={q.data.id} goal={q.data} />
      )}
    </Page>
  )
}
