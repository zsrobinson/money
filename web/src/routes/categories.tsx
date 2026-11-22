import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageHeader,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Button } from "@zsrobinson/shell/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@zsrobinson/shell/ui/tabs"
import { PlusIcon } from "lucide-react"
import { z } from "zod"
import {
  CategoryGroupCard,
  categoryTree,
  GROUPS,
  MergedCard,
  NewCategoryForm,
  type RowMode,
} from "@/components/categories"
import { Loading } from "@/components/money"
import { TagsCard } from "@/components/tags"
import { usePageTitle } from "@/lib/crumb"
import { categoriesQuery } from "@/lib/queries"
import type { Group } from "@/lib/types"

export const Route = createFileRoute("/categories")({
  validateSearch: z.object({ tab: z.enum(["categories", "tags"]).optional() }),
  staticData: { crumbs: [{ label: "Categories", to: "/categories" }] },
  component: CategoriesPage,
})

function CategoriesPage() {
  const { tab = "categories" } = Route.useSearch()
  const navigate = useNavigate({ from: "/categories" })
  usePageTitle(tab === "tags" ? "Tags" : "Categories")
  const categories = useQuery(categoriesQuery)
  const [creating, setCreating] = useState<{
    kind: "group" | "category"
    group?: Group
  } | null>(null)
  const [addingTag, setAddingTag] = useState(false)
  const [mode, setMode] = useState<RowMode>(null)
  const tree = categoryTree(categories.data ?? [])
  const start = (kind: "group" | "category", group?: Group) => {
    setMode(null)
    setCreating({ kind, group })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  return (
    <Page>
      <PageHeader>
        <PageTitle>Categories</PageTitle>
        <PageActions>
          {tab === "tags" ? (
            <Button size="sm" onClick={() => setAddingTag(true)}>
              <PlusIcon data-icon="inline-start" />
              New tag
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => start("group")}
              >
                <PlusIcon data-icon="inline-start" />
                New group
              </Button>
              <Button size="sm" onClick={() => start("category")}>
                <PlusIcon data-icon="inline-start" />
                New category
              </Button>
            </>
          )}
        </PageActions>
      </PageHeader>
      <Tabs
        value={tab}
        onValueChange={(v) =>
          void navigate({
            search: { tab: v === "tags" ? "tags" : undefined },
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "tags" ? (
        <TagsCard adding={addingTag} setAdding={setAddingTag} />
      ) : categories.isError ? (
        <QueryError
          title="Categories failed to load"
          error={categories.error}
          onRetry={() => categories.refetch()}
        />
      ) : !categories.data ? (
        <Loading rows={10} />
      ) : (
        <PageStack>
          {creating ? (
            <NewCategoryForm
              key={`${creating.kind}-${creating.group}`}
              kind={creating.kind}
              group={creating.group}
              tree={tree}
              onDone={() => setCreating(null)}
            />
          ) : null}
          {GROUPS.map((g) => (
            <CategoryGroupCard
              key={g.group}
              group={g.group}
              tree={tree}
              mode={mode}
              setMode={setMode}
              onNewGroup={() => start("group", g.group)}
            />
          ))}
          <MergedCard tree={tree} />
        </PageStack>
      )}
    </Page>
  )
}
