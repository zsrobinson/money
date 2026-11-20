import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { FormStack, Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { QueryError } from "@zsrobinson/shell/blocks/query-error"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@zsrobinson/shell/ui/native-select"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Loading, SectionCard } from "@/components/money"
import { usePageTitle } from "@/lib/crumb"
import { pluralize, RANGE_OPTIONS } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import {
  accountsQuery,
  categoriesQuery,
  metaQuery,
  settingsQuery,
  tagsQuery,
} from "@/lib/queries"
import type { Category, Settings, Tag } from "@/lib/types"

export const Route = createFileRoute("/settings")({
  staticData: { crumbs: [{ label: "Settings", to: "/settings" }] },
  component: SettingsPage,
})

function SettingsPage() {
  usePageTitle("Settings")
  return (
    <Page>
      <PageHeader>
        <PageTitle>Settings</PageTitle>
      </PageHeader>
      <FormStack>
        <Sources />
        <Preferences />
        <Categories />
        <Tags />
        <Accounts />
      </FormStack>
    </Page>
  )
}

const STATUS: Record<
  string,
  { label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  healthy: { label: "Up to date", variant: "secondary" },
  stale: { label: "Behind", variant: "destructive" },
  error: { label: "Failing", variant: "destructive" },
  disabled: { label: "Paused", variant: "outline" },
}

function Sources() {
  const meta = useQuery(metaQuery)
  return (
    <SectionCard title="Connections" flush>
      {meta.isError ? (
        <QueryError title="Connections failed to load" error={meta.error} />
      ) : null}
      {!meta.data ? (
        <Loading rows={3} className="px-5 pb-5" />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border/70">
            {meta.data.sources.map((s) => {
              const status = STATUS[s.status] ?? STATUS.error
              return (
                <li
                  key={s.id}
                  className="flex min-h-14 items-center gap-3 px-5 py-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {s.institution}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {pluralize(s.accounts, "account")}
                      {s.lastSuccessAt
                        ? ` · last synced ${new Date(s.lastSuccessAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                        : " · never synced"}
                    </span>
                  </span>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </li>
              )
            })}
          </ul>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            Connections sync on a schedule on the server. Adding or reconnecting
            an institution happens there, not here.
          </p>
        </>
      )}
    </SectionCard>
  )
}

function Preferences() {
  const settings = useQuery(settingsQuery)
  const save = useSend<Partial<Settings>>("PATCH", "/api/settings", {
    success: "Preferences saved",
  })
  const s = settings.data
  return (
    <SectionCard title="Preferences">
      {!s ? (
        <Loading rows={3} />
      ) : (
        <FieldGroup>
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="pref-range">Default chart range</FieldLabel>
            <NativeSelect
              id="pref-range"
              value={s.defaultRange}
              onChange={(e) =>
                save.mutate({
                  defaultRange: e.target.value as Settings["defaultRange"],
                })
              }
            >
              {RANGE_OPTIONS.map((r) => (
                <NativeSelectOption key={r.value} value={r.value}>
                  {r.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
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

function Categories() {
  const categories = useQuery(categoriesQuery)
  const [label, setLabel] = useState("")
  const [parent, setParent] = useState("food")
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
  return (
    <SectionCard title="Categories" flush>
      <div className="flex flex-wrap items-end gap-2 px-5 pb-4">
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="new-category">New category</FieldLabel>
          <Input
            id="new-category"
            placeholder="Coffee shops"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="new-category-parent">Inside</FieldLabel>
          <NativeSelect
            id="new-category-parent"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            {tops.map((c) => (
              <NativeSelectOption key={c.code} value={c.code}>
                {c.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button
          disabled={!label.trim() || create.isPending}
          onClick={() => create.mutate({ label: label.trim(), parent })}
        >
          <PlusIcon data-icon="inline-start" />
          Add
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
    { success: "Category saved" }
  )
  const remove = useSend("DELETE", `/api/categories/${c.code}`, {
    success: `Deleted ${c.label}`,
  })
  return (
    <li
      className={`flex min-h-12 items-center gap-2 py-1.5 pr-3 ${c.parent ? "pl-9" : "pl-5"} ${c.hidden ? "opacity-60" : ""}`}
    >
      <Input
        aria-label={`Name for ${c.label}`}
        className="h-8 max-w-64 border-transparent bg-transparent px-2 font-medium shadow-none hover:bg-muted/60 focus-visible:bg-background"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() =>
          label.trim() &&
          label.trim() !== c.label &&
          patch.mutate({ label: label.trim() })
        }
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {c.group === "income"
          ? "Income"
          : c.group === "transfer"
            ? "Transfer"
            : ""}
      </span>
      <Link
        to="/reports/categories/$code"
        params={{ code: c.code }}
        className="ml-auto text-xs whitespace-nowrap text-muted-foreground tabular-nums underline-offset-4 hover:underline"
      >
        {pluralize(c.transactions, "transaction")}
      </Link>
      <Button
        size="icon-sm"
        variant="ghost"
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
        <span className="size-7" aria-hidden />
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

function Tags() {
  const tags = useQuery(tagsQuery)
  const [name, setName] = useState("")
  const create = useSend<{ name: string }>("POST", "/api/tags", {
    success: (_, v) => `Added ${v.name}`,
    onSuccess: () => setName(""),
  })
  return (
    <SectionCard title="Tags" flush>
      <div id="tags" className="flex items-end gap-2 px-5 pb-4">
        <Field className="flex-1">
          <FieldLabel htmlFor="new-tag">New tag</FieldLabel>
          <Input
            id="new-tag"
            placeholder="Tax deductible"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              name.trim() &&
              create.mutate({ name: name.trim() })
            }
          />
        </Field>
        <Button
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate({ name: name.trim() })}
        >
          <PlusIcon data-icon="inline-start" />
          Add
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
        className="h-8 max-w-64 border-transparent bg-transparent px-2 font-medium shadow-none hover:bg-muted/60 focus-visible:bg-background"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() =>
          name.trim() &&
          name.trim() !== t.name &&
          patch.mutate({ name: name.trim() })
        }
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <NativeSelect
        size="sm"
        aria-label={`Colour for ${t.name}`}
        className="ml-auto w-32 shrink-0"
        value={t.hue ?? ""}
        onChange={(e) => patch.mutate({ hue: e.target.value || null })}
      >
        <NativeSelectOption value="">No colour</NativeSelectOption>
        {HUES.map(([value, label]) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Link
        to="/transactions"
        search={{ tag: t.id }}
        className="text-xs whitespace-nowrap text-muted-foreground tabular-nums underline-offset-4 hover:underline"
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
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b px-5 pb-2 text-xs text-muted-foreground">
        <span>Account</span>
        <span className="w-16 text-center">Net worth</span>
        <span className="w-16 text-center">Shown</span>
      </div>
      <ul className="flex flex-col divide-y divide-border/70">
        {(accounts.data ?? []).map((a) => (
          <li
            key={a.id}
            className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 px-5 py-1.5"
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
            <span className="flex w-16 justify-center">
              <Switch
                aria-label={`Count ${a.name} in net worth`}
                checked={!a.excludeNetWorth}
                onCheckedChange={(on) =>
                  save.mutate({ id: a.id, patch: { excludeNetWorth: !on } })
                }
              />
            </span>
            <span className="flex w-16 justify-center">
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
