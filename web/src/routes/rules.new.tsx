import { createFileRoute } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { z } from "zod"
import { formFromRule, RuleForm } from "@/components/rules"
import { usePageTitle } from "@/lib/crumb"

export const Route = createFileRoute("/rules/new")({
  validateSearch: z.object({
    merchant: z.string().optional(),
    category: z.string().optional(),
    account: z.string().optional(),
  }),
  staticData: { crumbs: [{ label: "Rules", to: "/rules" }] },
  component: NewRule,
})

function NewRule() {
  usePageTitle("New rule", true)
  const seed = Route.useSearch()
  return (
    <Page>
      <PageHeader>
        <PageTitle>New rule</PageTitle>
      </PageHeader>
      <RuleForm initial={formFromRule(undefined, seed)} />
    </Page>
  )
}
