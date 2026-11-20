import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Loading } from "@/components/money"
import { formFromRule, RuleForm } from "@/components/rules"
import { usePageTitle } from "@/lib/crumb"
import { ruleQuery } from "@/lib/queries"

export const Route = createFileRoute("/rules/$id")({
  staticData: { crumbs: [{ label: "Rules", to: "/rules" }] },
  component: EditRule,
})

function EditRule() {
  const { id } = Route.useParams()
  const rule = useQuery(ruleQuery(id))
  usePageTitle("Edit rule", true)
  return (
    <Page>
      <PageHeader>
        <PageTitle>Edit rule</PageTitle>
      </PageHeader>
      {rule.isError ? (
        <QueryError
          title="This rule failed to load"
          error={rule.error}
          onRetry={() => rule.refetch()}
        />
      ) : null}
      {rule.data ? (
        <RuleForm
          key={rule.data.id}
          rule={rule.data}
          initial={formFromRule(rule.data)}
        />
      ) : !rule.isError ? (
        <Loading rows={6} />
      ) : null}
    </Page>
  )
}
