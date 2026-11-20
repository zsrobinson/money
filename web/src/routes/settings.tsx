import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Page, PageHeader, PageStack, PageTitle } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Loading, SectionCard } from "@/components/money"
import { Choice } from "@/components/pickers"
import { SourceList } from "@/components/sources"
import { usePageTitle } from "@/lib/crumb"
import { pluralize, RANGE_OPTIONS } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import {
  accountsQuery,
  categoriesQuery,
  settingsQuery,
  tagsQuery,
} from "@/lib/queries"
import type { Category, Settings, Tag } from "@/lib/types"

export const Route = createFileRoute("/settings")({
  staticData: { crumbs: [{ label: "Settings", to: "/settings" }] },
  component: SettingsPage,
})

const SECTIONS = [
  { id: "connections", label: "Connections" },
  { id: "preferences", label: "Preferences" },
  { id: "categories", label: "Categories" },
  { id: "tags", label: "Tags" },
  { id: "accounts", label: "Accounts" },
]

function SettingsPage() {
  usePageTitle("Settings")
  return (
    <Page>
      <PageHeader>
        <PageTitle>Settings</PageTitle>
      </PageHeader>
      <div className="grid items-start gap-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="flex gap-1 overflow-x-auto lg:sticky lg:top-16 lg:flex-col"
        >
          {SECTIONS.map((s) => (
            <Button
              key={s.id}
              variant="ghost"
              size="sm"
              className="justify-start text-muted-foreground"
              render={<a href={`#${s.id}`} />}
              nativeButton={false}
            >
              {s.label}
            </Button>
          ))}
        </nav>
        <PageStack className="max-w-3xl">
          <Section id="connections">
            <SectionCard title="Connections" flush>
              <SourceList />
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                Connections sync on a schedule. Sync now asks for an early
                refresh of existing connections; adding an institution happens
                on the server.
              </p>
            </SectionCard>
          </Section>
          <Section id="preferences">
            <Preferences />
          </Section>
          <Section id="categories">
            <Categories />
          </Section>
          <Section id="tags">
            <Tags />
          </Section>
          <Section id="accounts">
            <Accounts />
          </Section>
        </PageStack>
      </div>
    </Page>
  )
}

const Section = ({
  id,
  children,
}: {
  id: string
  children: React.ReactNode
}) => (
  <section id={id} className="scroll-mt-16">
    {children}
  </section>
)

function Preferences() {
  const settings = useQuery(settingsQuery)
  const save = useSend<Partial<Settings>>("PATCH", "/api/settings", {
    success: "Preferences saved",
  })
  const s = settings.data
  return (
    <SectionCard title="Preferences">
      {!s ? (
        <Loading rows={2} />
      ) : (
        <FieldGroup>
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="pref-range">Default chart range</FieldLabel>
            <Choice
              id="pref-range"
              className="w-40"
              align="end"
              value={s.defaultRange}
              onChange={(v) =>
                save.mutate({ defaultRange: v as Settings["defaultRange"] })
              }
              options={RANGE_OPTIONS.map((r) => ({
                value: r.value,
                label: r.label,
              }))}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="pref-review"
              checked={s.reviewNewTransactions}
              onCheckedChange={(v) => save.mutate({ reviewNewTransactions: v })}
            />
            <div className="flex flex-col">
              <FieldLabel htmlFor="pref-review">
                Count new transactions for review
              </FieldLabel>
              <FieldDescription>
                Shows the review count beside Transactions.
              </FieldDescription>
            </div>
          </Field>
        </FieldGroup>
      )}
    </SectionCard>
  )
}

const GROUP_LABEL = {
  income: "Income",
  expense: "Spending",
  transfer: "Transfer",
} as const

function Categories() {
  const categories = useQuery(categoriesQuery)
  const [label, setLabel] = useState("")
  const [parent, setParent] = useState("food")
  const [error, setError] = useState<string | null>(null)
  const create = useSend<{ label: string; parent: string }>(
    "POST",
    "/api/categories",
    {
      success: (_, v) => `Added ${v.label}`,
      onSuccess: () => setLabel(""),
    }
  )
  const list = categories.data ?? []
  const tops = list.filter((c) => !c.parent && c.group !== "transfer")
  const add = () => {
    if (!label.trim()) return setError("Name the category")
    setError(null)
    create.mutate({ label: label.trim(), parent })
  }
  return (
    <SectionCard title="Categories" flush>
      <div className="flex flex-wrap items-start gap-2 px-5 pb-4">
        <Field className="min-w-40 flex-1" data-invalid={!!error}>
          <FieldLabel htmlFor="new-category">New category</FieldLabel>
          <Input
            id="new-category"
            placeholder="Name"
            value={label}
            aria-invalid={!!error}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="new-category-parent">Inside</FieldLabel>
          <Choice
            id="new-category-parent"
            className="w-44"
            value={parent}
            onChange={setParent}
            options={tops.map((c) => ({ value: c.code, label: c.label }))}
          />
        </Field>
        <Button className="mt-6" disabled={create.isPending} onClick={add}>
          <PlusIcon data-icon="inline-start" />
          Add category
        </Button>
      </div>
      <ul className="flex flex-col divide-y divide-border/70 border-t">
        {list
          .filter((c) => !c.parent)
          .flatMap((c) => [c, ...list.filter((x) => x.parent === c.code)])
          .map((c) => (
            <CategoryRow key={c.code} category={c} />
          ))}
      </ul>
    </SectionCard>
  )
}

function CategoryRow({ category: c }: { category: Category }) {
  const [label, setLabel] = useState(c.label)
  const patch = useSend<{ label?: string; hidden?: boolean }>(
    "PATCH",
    `/api/categories/${c.code}`,
    {
      success: "Category saved",
    }
  )
  const remove = useSend("DELETE", `/api/categories/${c.code}`, {
    success: `Deleted ${c.label}`,
  })
  return (
    <li
      className={`flex min-h-12 items-center gap-2 py-1.5 pr-3 ${c.parent ? "pl-8" : "pl-3"} ${c.hidden ? "opacity-60" : ""}`}
    >
      <Input
        aria-label={`Name for ${c.label}`}
        className="h-8 min-w-0 flex-1 truncate border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/60 focus-visible:bg-background sm:max-w-64"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() =>
          label.trim() &&
          label.trim() !== c.label &&
          patch.mutate({ label: label.trim() })
        }
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {c.parent ? "" : GROUP_LABEL[c.group]}
      </span>
      <Link
        to="/reports/categories/$code"
        params={{ code: c.code }}
        className="ml-auto hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums underline-offset-4 hover:underline sm:inline"
      >
        {pluralize(c.transactions, "transaction")}
      </Link>
      <Button
        size="icon-sm"
        variant="ghost"
        className="max-sm:ml-auto"
        aria-label={c.hidden ? `Show ${c.label}` : `Hide ${c.label}`}
        onClick={() => patch.mutate({ hidden: !c.hidden })}
      >
        {c.hidden ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
      {c.custom ? (
        <ConfirmAction
          trigger={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${c.label}`}
            >
              <Trash2Icon />
            </Button>
          }
          title={`Delete ${c.label}?`}
          confirmLabel="Delete category"
          destructive
          onConfirm={() => remove.mutateAsync()}
        >
          Only unused categories can be deleted. Move its transactions and rules
          elsewhere first.
        </ConfirmAction>
      ) : (
        <span className="size-7 shrink-0" aria-hidden />
      )}
    </li>
  )
}

const HUES = [
  ["re", "Red"],
  ["or", "Orange"],
  ["ye", "Yellow"],
  ["gr", "Green"],
  ["cy", "Cyan"],
  ["bl", "Blue"],
  ["pu", "Purple"],
  ["ma", "Magenta"],
] as const
const hueName = (hue: string) =>
  ({
    re: "red",
    or: "orange",
    ye: "yellow",
    gr: "green",
    cy: "cyan",
    bl: "blue",
    pu: "purple",
    ma: "magenta",
  })[hue] ?? "yellow"

function Tags() {
  const tags = useQuery(tagsQuery)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const create = useSend<{ name: string }>("POST", "/api/tags", {
    success: (_, v) => `Added ${v.name}`,
    onSuccess: () => setName(""),
  })
  const add = () => {
    if (!name.trim()) return setError("Name the tag")
    setError(null)
    create.mutate({ name: name.trim() })
  }
  return (
    <SectionCard title="Tags" flush>
      <div className="flex flex-wrap items-start gap-2 px-5 pb-4">
        <Field className="min-w-40 flex-1" data-invalid={!!error}>
          <FieldLabel htmlFor="new-tag">New tag</FieldLabel>
          <Input
            id="new-tag"
            placeholder="Name"
            value={name}
            aria-invalid={!!error}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button className="mt-6" disabled={create.isPending} onClick={add}>
          <PlusIcon data-icon="inline-start" />
          Add tag
        </Button>
      </div>
      {tags.data?.length ? (
        <ul className="flex flex-col divide-y divide-border/70 border-t">
          {tags.data.map((t) => (
            <TagRow key={t.id} tag={t} />
          ))}
        </ul>
      ) : (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          Tags group transactions across categories, such as everything
          reimbursable.
        </p>
      )}
    </SectionCard>
  )
}

function TagRow({ tag: t }: { tag: Tag }) {
  const [name, setName] = useState(t.name)
  const patch = useSend<{ name?: string; hue?: string | null }>(
    "PATCH",
    `/api/tags/${t.id}`,
    { success: "Tag saved" }
  )
  const remove = useSend("DELETE", `/api/tags/${t.id}`, {
    success: `Deleted ${t.name}`,
  })
  return (
    <li className="flex min-h-12 items-center gap-2 py-1.5 pr-3 pl-5">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{
          background: t.hue
            ? `var(--flexoki-${hueName(t.hue)}-500)`
            : "var(--muted-foreground)",
        }}
      />
      <Input
        aria-label={`Name for ${t.name}`}
        className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/60 focus-visible:bg-background sm:max-w-64"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() =>
          name.trim() &&
          name.trim() !== t.name &&
          patch.mutate({ name: name.trim() })
        }
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <Choice
        aria-label={`Colour for ${t.name}`}
        size="sm"
        align="end"
        className="ml-auto w-28 shrink-0"
        value={t.hue ?? ""}
        placeholder="No colour"
        onChange={(v) => patch.mutate({ hue: v || null })}
        options={HUES.map(([value, label]) => ({ value, label }))}
      />
      <Link
        to="/transactions"
        search={{ tag: t.id }}
        className="hidden text-xs whitespace-nowrap text-muted-foreground tabular-nums underline-offset-4 hover:underline sm:inline"
      >
        {pluralize(t.transactions, "transaction")}
      </Link>
      <ConfirmAction
        trigger={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${t.name}`}
          >
            <Trash2Icon />
          </Button>
        }
        title={`Delete ${t.name}?`}
        confirmLabel="Delete tag"
        destructive
        onConfirm={() => remove.mutateAsync()}
      >
        The tag is removed from {pluralize(t.transactions, "transaction")}.
        Rules that add it stop adding it.
      </ConfirmAction>
    </li>
  )
}

function Accounts() {
  const accounts = useQuery(accountsQuery)
  const save = useSend<{ id: string; patch: Record<string, unknown> }>(
    "PATCH",
    (v) => `/api/accounts/${v.id}`,
    {
      body: (v) => v.patch,
      success: "Account updated",
    }
  )
  return (
    <SectionCard title="Accounts" flush>
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-3 border-b px-5 pb-2 text-xs text-muted-foreground">
        <span>Account</span>
        <span className="text-center">Net worth</span>
        <span className="text-center">Shown</span>
      </div>
      <ul className="flex flex-col divide-y divide-border/70">
        {(accounts.data ?? []).map((a) => (
          <li
            key={a.id}
            className="grid min-h-12 grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-3 px-5 py-1.5"
          >
            <Link
              to="/accounts/$id"
              params={{ id: a.id }}
              className="flex min-w-0 flex-col underline-offset-4 hover:underline"
            >
              <span className="truncate text-sm font-medium">{a.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {a.institution}
                {a.availability !== "available" ? " · Closed" : ""}
              </span>
            </Link>
            <span className="flex justify-center">
              <Switch
                aria-label={`Count ${a.name} in net worth`}
                checked={!a.excludeNetWorth}
                onCheckedChange={(on) =>
                  save.mutate({ id: a.id, patch: { excludeNetWorth: !on } })
                }
              />
            </span>
            <span className="flex justify-center">
              <Switch
                aria-label={`Show ${a.name} in lists`}
                checked={!a.hidden}
                onCheckedChange={(on) =>
                  save.mutate({ id: a.id, patch: { hidden: !on } })
                }
              />
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}
