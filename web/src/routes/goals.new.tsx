import { createFileRoute } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { GoalForm } from "@/components/goals"
import { usePageTitle } from "@/lib/crumb"

export const Route = createFileRoute("/goals/new")({
  staticData: { crumbs: [{ label: "Goals", to: "/goals" }] },
  component: NewGoal,
})

function NewGoal() {
  usePageTitle("New goal", true)
  return (
    <Page>
      <PageHeader>
        <PageTitle>New goal</PageTitle>
      </PageHeader>
      <GoalForm />
    </Page>
  )
}
