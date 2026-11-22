import { useEffect, useState, type ReactNode } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { cn, FormStack, PageGrid } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@zsrobinson/shell/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { Toggle } from "@zsrobinson/shell/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@zsrobinson/shell/ui/toggle-group"
import { PlusIcon, XIcon } from "lucide-react"
import {
  CardLink,
  EmptyState,
  InfoTip,
  Loading,
  SectionCard,
} from "@/components/money"
import { Choice, DatePicker } from "@/components/pickers"
import {
  CategorySelect,
  TxnRows,
  useCategoryLabels,
} from "@/components/transactions"
import { send } from "@/lib/api"
import { fullDate, money, pluralize } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import {
  accountsQuery,
  categoriesQuery,
  metaQuery,
  tagsQuery,
} from "@/lib/queries"
import type {
  Rule,
  RuleAction,
  RuleCondition,
  RuleMatch,
  Txn,
} from "@/lib/types"

/** How rules combine, behind an info icon beside the page title. */
export function RulesHelp() {
  return (
    <InfoTip label="How rules apply">
      Rules apply in order. For each field the first matching rule wins, and
      your own edits to a transaction always win.
    </InfoTip>
  )
}

const FLOW_LABEL = {
  activity: "Purchases",
  bank_transfer: "Transfers",
  peer_payment: "Peer payments",
} as const

/** One condition object in words: "merchant contains “x” and money out". */
function conditionWords(
  m: RuleCondition,
  label: (code: string) => string,
  accountName?: (id: string) => string
) {
  const when: string[] = []
  if (m.merchant_contains)
    when.push(`merchant contains “${m.merchant_contains}”`)
  if (m.merchant_equals) when.push(`merchant is “${m.merchant_equals}”`)
  if (m.merchant_starts_with)
    when.push(`merchant starts with “${m.merchant_starts_with}”`)
  if (m.description_contains)
    when.push(`description contains “${m.description_contains}”`)
  if (m.flow_kind) when.push(`kind is ${FLOW_LABEL[m.flow_kind].toLowerCase()}`)
  if (m.category) when.push(`bank’s category is ${label(m.category)}`)
  if (m.account_id)
    when.push(`account is ${accountName?.(m.account_id) ?? "one account"}`)
  if (m.direction) when.push(m.direction === "in" ? "money in" : "money out")
  if (m.amount_min_cents != null && m.amount_max_cents != null)
    when.push(
      `amount ${money(m.amount_min_cents)}–${money(m.amount_max_cents)}`
    )
  else if (m.amount_min_cents != null)
    when.push(`amount at least ${money(m.amount_min_cents)}`)
  else if (m.amount_max_cents != null)
    when.push(`amount up to ${money(m.amount_max_cents)}`)
  if (m.date_from && m.date_to)
    when.push(`dated ${fullDate(m.date_from)}–${fullDate(m.date_to)}`)
  else if (m.date_from) when.push(`dated from ${fullDate(m.date_from)}`)
  else if (m.date_to) when.push(`dated until ${fullDate(m.date_to)}`)
  return when
}

export function describeRule(
  r: Pick<Rule, "match" | "action">,
  label: (code: string) => string,
  accountName?: (id: string) => string
) {
  const { when, then } = ruleParts(r, label, accountName)
  return `${when}, ${then.charAt(0).toLowerCase()}${then.slice(1)}`
}

/** A rule as "When …" and "Then …", for showing the action on its own line. */
export function ruleParts(
  r: Pick<Rule, "match" | "action">,
  label: (code: string) => string,
  accountName?: (id: string) => string
) {
  const { any, ...all } = r.match
  const when = conditionWords(all, label, accountName)
  if (any?.length)
    when.push(
      any.length === 1
        ? conditionWords(any[0], label, accountName).join(" and ")
        : `any of ${any
            .map((c) => conditionWords(c, label, accountName).join(" and "))
            .join("; ")}`
    )
  const then: string[] = []
  const a = r.action
  if (a.category) then.push(`set category to ${label(a.category)}`)
  if (a.split?.length)
    then.push(
      `split ${a.split
        .map((p) => `${p.percent / 100}% ${label(p.category)}`)
        .join(", ")}`
    )
  if (a.merchant) then.push(`rename to “${a.merchant}”`)
  if (a.tags?.length) then.push(`add ${pluralize(a.tags.length, "tag")}`)
  if (a.mark_recurring) then.push("mark recurring")
  if (a.mark_reviewed) then.push("mark reviewed")
  if (a.hide) then.push("hide")
  const action = then.join(", ")
  return {
    when: `When ${when.join(" and ")}`,
    then: action.charAt(0).toUpperCase() + action.slice(1),
  }
}

// ---- Form model ------------------------------------------------------------

type Kind =
  | "merchant"
  | "description"
  | "flow"
  | "category"
  | "account"
  | "direction"
  | "amount"
  | "date"
type MerchantOp = "contains" | "equals" | "starts"
type Cond = {
  id: number
  kind: Kind
  op: MerchantOp
  value: string
  /** Amount minimum, or the first date. */
  from: string
  /** Amount maximum, or the last date. */
  to: string
}
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "merchant", label: "Merchant or description" },
  { kind: "description", label: "Description contains" },
  { kind: "flow", label: "Kind" },
  { kind: "category", label: "Bank’s category" },
  { kind: "account", label: "Account" },
  { kind: "direction", label: "Direction" },
  { kind: "amount", label: "Amount" },
  { kind: "date", label: "Date" },
]
const kindLabel = (k: Kind) => KINDS.find((x) => x.kind === k)!.label

let nextId = 1
const cond = (kind: Kind, extra: Partial<Cond> = {}): Cond => ({
  id: nextId++,
  kind,
  op: "contains",
  value: "",
  from: "",
  to: "",
  ...extra,
})

type Part = { id: number; category: string; percent: string }
type Form = {
  all: Cond[]
  /** null: no "any of" group. */
  any: Cond[] | null
  setCategory: string
  rename: string
  tags: string[]
  splitOn: boolean
  split: Part[]
  recurring: boolean
  review: boolean
  hide: boolean
  enabled: boolean
  /** "all": past transactions too; otherwise the first day it applies to. */
  scope: "all" | "new"
  appliesFrom: string | null
}

const dollars = (cents?: number) => (cents == null ? "" : String(cents / 100))
const toCents = (s: string) =>
  s.trim() === "" || Number.isNaN(Number(s.replace(/[,$]/g, "")))
    ? undefined
    : Math.round(Math.abs(Number(s.replace(/[,$]/g, ""))) * 100)

/** Rows for one stored condition object. */
function condsFrom(m: RuleCondition): Cond[] {
  const out: Cond[] = []
  if (m.merchant_contains)
    out.push(cond("merchant", { op: "contains", value: m.merchant_contains }))
  if (m.merchant_equals)
    out.push(cond("merchant", { op: "equals", value: m.merchant_equals }))
  if (m.merchant_starts_with)
    out.push(cond("merchant", { op: "starts", value: m.merchant_starts_with }))
  if (m.description_contains)
    out.push(cond("description", { value: m.description_contains }))
  if (m.flow_kind) out.push(cond("flow", { value: m.flow_kind }))
  if (m.category) out.push(cond("category", { value: m.category }))
  if (m.account_id) out.push(cond("account", { value: m.account_id }))
  if (m.direction) out.push(cond("direction", { value: m.direction }))
  if (m.amount_min_cents != null || m.amount_max_cents != null)
    out.push(
      cond("amount", {
        from: dollars(m.amount_min_cents),
        to: dollars(m.amount_max_cents),
      })
    )
  if (m.date_from || m.date_to)
    out.push(cond("date", { from: m.date_from ?? "", to: m.date_to ?? "" }))
  return out
}

/** Merge rows into one condition object; empty rows add nothing. */
function conditionOf(rows: Cond[]): RuleCondition {
  const m: RuleCondition = {}
  for (const c of rows) {
    const v = c.value.trim()
    if (c.kind === "merchant" && v)
      m[
        c.op === "equals"
          ? "merchant_equals"
          : c.op === "starts"
            ? "merchant_starts_with"
            : "merchant_contains"
      ] = v
    if (c.kind === "description" && v) m.description_contains = v
    if (c.kind === "flow" && v) m.flow_kind = v as RuleCondition["flow_kind"]
    if (c.kind === "category" && v) m.category = v
    if (c.kind === "account" && v) m.account_id = v
    if (c.kind === "direction" && v)
      m.direction = v as RuleCondition["direction"]
    if (c.kind === "amount") {
      const min = toCents(c.from)
      const max = toCents(c.to)
      if (min != null) m.amount_min_cents = min
      if (max != null) m.amount_max_cents = max
    }
    if (c.kind === "date") {
      if (c.from) m.date_from = c.from
      if (c.to) m.date_to = c.to
    }
  }
  return m
}

export function formFromRule(
  r?: Partial<Rule>,
  seed: {
    merchant?: string
    category?: string
    account?: string
    flow?: RuleCondition["flow_kind"]
  } = {}
): Form {
  const m = r?.match ?? {}
  const a = r?.action ?? {}
  const { any, ...all } = m
  let rows = condsFrom(all)
  if (!r) {
    rows = [
      ...(seed.flow ? [cond("flow", { value: seed.flow })] : []),
      ...(seed.merchant !== undefined || !seed.flow
        ? [cond("merchant", { value: seed.merchant ?? "" })]
        : []),
      ...(seed.account ? [cond("account", { value: seed.account })] : []),
    ]
  }
  return {
    all: rows,
    any: any?.length ? any.flatMap(condsFrom) : null,
    setCategory: a.category ?? seed.category ?? "",
    rename: a.merchant ?? "",
    tags: a.tags ?? [],
    splitOn: Boolean(a.split?.length),
    split: a.split?.length
      ? a.split.map((p) => ({
          id: nextId++,
          category: p.category,
          percent: String(p.percent / 100),
        }))
      : [
          { id: nextId++, category: "", percent: "50" },
          { id: nextId++, category: "", percent: "50" },
        ],
    recurring: a.mark_recurring ?? false,
    review: a.mark_reviewed ?? false,
    hide: a.hide ?? false,
    enabled: r?.enabled ?? true,
    scope: r?.appliesFrom ? "new" : "all",
    appliesFrom: r?.appliesFrom ?? null,
  }
}

/** Basis points from "33.33"; NaN when it is not a number. */
const basisPoints = (s: string) => Math.round(Number(s) * 100)

function toRule(f: Form, today: string) {
  const match: RuleMatch = conditionOf(f.all)
  // Each row in "any of" is its own alternative.
  const any = (f.any ?? [])
    .map((c) => conditionOf([c]))
    .filter((c) => Object.keys(c).length)
  if (any.length) match.any = any
  const action: RuleAction = {}
  if (f.splitOn) {
    action.split = f.split.map((p) => ({
      category: p.category,
      percent: basisPoints(p.percent),
    }))
  } else if (f.setCategory) action.category = f.setCategory
  if (f.rename.trim()) action.merchant = f.rename.trim()
  if (f.tags.length) action.tags = f.tags
  if (f.recurring) action.mark_recurring = true
  if (f.review) action.mark_reviewed = true
  if (f.hide) action.hide = true
  const appliesFrom =
    f.scope === "all" ? null : (f.appliesFrom ?? (today || null))
  return { match, action, appliesFrom }
}

function splitProblem(f: Form) {
  if (!f.splitOn) return null
  if (f.split.some((p) => !p.category)) return "Choose a category for each part"
  const parts = f.split.map((p) => basisPoints(p.percent))
  if (parts.some((p) => !(p >= 1 && p <= 10000)))
    return "Give each part a share above 0%"
  const total = parts.reduce((s, p) => s + p, 0)
  if (total !== 10000) return `Shares add up to ${total / 100}%, not 100%`
  return null
}

// ---- Form ------------------------------------------------------------------

export function RuleForm({ initial, rule }: { initial: Form; rule?: Rule }) {
  const navigate = useNavigate()
  const [f, setF] = useState(initial)
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setF((prev) => ({ ...prev, [key]: value }))
  const today = useQuery(metaQuery).data?.today ?? ""
  const categories = useQuery(categoriesQuery)
  const tags = useQuery(tagsQuery)
  const label = useCategoryLabels()
  const body = toRule(f, today)
  const hasMatch = Object.keys(body.match).length > 0
  const hasAction = Object.keys(body.action).length > 0
  const problem = splitProblem(f)
  const [tried, setTried] = useState(false)
  const preview = useMutation({
    mutationFn: (b: {
      match: RuleMatch
      action?: RuleAction
      ruleId?: string
      appliesFrom: string | null
    }) =>
      send<{ total: number; changes: number; items: Txn[] }>(
        "POST",
        "/api/rules/preview",
        b
      ),
  })
  const key = JSON.stringify({
    match: body.match,
    a: body.action.category,
    s: body.appliesFrom,
  })
  useEffect(() => {
    if (!hasMatch) return
    const id = setTimeout(
      () =>
        preview.mutate({
          match: body.match,
          action: body.action.category
            ? { category: body.action.category }
            : undefined,
          ruleId: rule?.id,
          appliesFrom: body.appliesFrom,
        }),
      300
    )
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const create = useSend<object, { id: string }>("POST", "/api/rules", {
    success: "Rule created",
    onSuccess: () => void navigate({ to: "/rules" }),
  })
  const update = useSend<object>("PATCH", `/api/rules/${rule?.id}`, {
    success: "Rule saved",
    onSuccess: () => void navigate({ to: "/rules" }),
  })
  const remove = useSend("DELETE", `/api/rules/${rule?.id}`, {
    success: "Rule deleted",
    onSuccess: () => void navigate({ to: "/rules" }),
  })
  const saving = create.isPending || update.isPending
  const submit = () => {
    setTried(true)
    if (problem) return
    const payload = { ...body, enabled: f.enabled }
    if (rule) update.mutate(payload)
    else create.mutate(payload)
  }
  const used = new Set(f.all.map((c) => c.kind))
  const addAll = (kind: Kind) => set("all", [...f.all, cond(kind)])
  return (
    // Form, then matches, then buttons: on a phone the preview comes before saving.
    <PageGrid layout="wide">
      <FormStack>
        <SectionCard title="When a transaction matches">
          <FieldGroup className="gap-4">
            {f.all.length ? (
              <ul className="flex flex-col gap-4">
                {f.all.map((c) => (
                  <li key={c.id}>
                    <ConditionRow
                      c={c}
                      onChange={(next) =>
                        set(
                          "all",
                          f.all.map((x) => (x.id === c.id ? next : x))
                        )
                      }
                      onRemove={() =>
                        set(
                          "all",
                          f.all.filter((x) => x.id !== c.id)
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            {f.any ? (
              <FieldSet className="rounded-2xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <FieldLegend variant="label" className="mb-0">
                    {f.all.length ? "And any of these" : "Any of these"}
                  </FieldLegend>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => set("any", null)}
                  >
                    Remove group
                  </Button>
                </div>
                <ul className="flex flex-col gap-4">
                  {f.any.map((c) => (
                    <li key={c.id}>
                      <ConditionRow
                        c={c}
                        onChange={(next) =>
                          set(
                            "any",
                            f.any!.map((x) => (x.id === c.id ? next : x))
                          )
                        }
                        onRemove={() =>
                          set(
                            "any",
                            f.any!.filter((x) => x.id !== c.id)
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
                <AddCondition
                  label="Add alternative"
                  onAdd={(kind) => set("any", [...f.any!, cond(kind)])}
                />
              </FieldSet>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <AddCondition onAdd={addAll} disabled={(k) => used.has(k)} />
              {f.any ? null : (
                <Button
                  variant="ghost"
                  onClick={() =>
                    set("any", [cond("merchant"), cond("merchant")])
                  }
                >
                  <PlusIcon data-icon="inline-start" />
                  Any of…
                </Button>
              )}
            </div>
            <FieldSeparator />
            <FieldSet>
              <FieldLegend variant="label">Applies to</FieldLegend>
              <ToggleGroup
                variant="outline"
                className="flex-wrap"
                value={[f.scope]}
                onValueChange={(v) =>
                  v[0] && set("scope", v[0] as Form["scope"])
                }
              >
                <ToggleGroupItem value="all">
                  Past transactions too
                </ToggleGroupItem>
                <ToggleGroupItem value="new">
                  Only new transactions
                </ToggleGroupItem>
              </ToggleGroup>
              {f.scope === "new" ? (
                <FieldDescription>
                  From {fullDate(f.appliesFrom ?? today)} on
                </FieldDescription>
              ) : null}
            </FieldSet>
          </FieldGroup>
        </SectionCard>
        <SectionCard
          title="Then"
          footer={
            <>
              {rule ? (
                <ConfirmAction
                  trigger={
                    <Button
                      variant="ghost"
                      className="mr-auto text-destructive"
                    >
                      Delete rule
                    </Button>
                  }
                  title="Delete this rule?"
                  confirmLabel="Delete rule"
                  destructive
                  onConfirm={() => remove.mutateAsync()}
                >
                  Transactions it changed go back to their bank values unless
                  you edited them yourself.
                </ConfirmAction>
              ) : null}
              <Button
                variant="outline"
                onClick={() => void navigate({ to: "/rules" })}
              >
                Cancel
              </Button>
              <Button
                disabled={!hasMatch || !hasAction || saving}
                onClick={submit}
              >
                {rule ? "Save rule" : "Create rule"}
              </Button>
            </>
          }
        >
          <FieldGroup className="@container">
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rule-set-category">
                  Set category
                </FieldLabel>
                <CategorySelect
                  id="rule-set-category"
                  categories={categories.data ?? []}
                  value={f.splitOn ? "" : f.setCategory}
                  disabled={f.splitOn}
                  placeholder={f.splitOn ? "Split below" : "Keep category"}
                  onChange={(v) => set("setCategory", v)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-rename">Rename merchant</FieldLabel>
                <Input
                  id="rule-rename"
                  placeholder="Keep name"
                  value={f.rename}
                  onChange={(e) => set("rename", e.target.value)}
                />
              </Field>
            </div>
            <Field orientation="horizontal" className="justify-between">
              <FieldLabel htmlFor="rule-split">Split by percentage</FieldLabel>
              <Switch
                id="rule-split"
                checked={f.splitOn}
                onCheckedChange={(v) => set("splitOn", v)}
              />
            </Field>
            {f.splitOn ? (
              <SplitEditor
                parts={f.split}
                problem={tried ? problem : null}
                onChange={(parts) => set("split", parts)}
              />
            ) : null}
            {tags.data?.length ? (
              <FieldSet>
                <FieldLegend variant="label">Add tags</FieldLegend>
                <div className="flex flex-wrap gap-1.5">
                  {tags.data.map((t) => (
                    <Toggle
                      key={t.id}
                      size="sm"
                      variant="outline"
                      pressed={f.tags.includes(t.id)}
                      onPressedChange={(on) =>
                        set(
                          "tags",
                          on
                            ? [...f.tags, t.id]
                            : f.tags.filter((x) => x !== t.id)
                        )
                      }
                    >
                      {t.name}
                    </Toggle>
                  ))}
                </div>
              </FieldSet>
            ) : null}
            <FieldSeparator />
            <SwitchRow
              id="rule-recurring"
              label="Mark as recurring"
              checked={f.recurring}
              onChange={(v) => set("recurring", v)}
            />
            <SwitchRow
              id="rule-review"
              label="Mark reviewed"
              checked={f.review}
              onChange={(v) => set("review", v)}
            />
            <SwitchRow
              id="rule-hide"
              label="Hide from totals"
              checked={f.hide}
              onChange={(v) => set("hide", v)}
            />
            <FieldSeparator />
            <SwitchRow
              id="rule-enabled"
              label="Rule is on"
              checked={f.enabled}
              onChange={(v) => set("enabled", v)}
            />
          </FieldGroup>
        </SectionCard>
      </FormStack>
      <SectionCard
        title="Matches"
        flush
        className="lg:sticky lg:top-16"
        action={
          hasMatch && preview.data?.total ? (
            <CardLink
              to="/transactions"
              search={{ match: JSON.stringify(body.match), status: "all" }}
            >
              View all
            </CardLink>
          ) : undefined
        }
      >
        {!hasMatch ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            Add a condition to see which transactions this rule changes.
          </p>
        ) : !preview.data ? (
          <Loading rows={4} className="px-5 pb-5" />
        ) : preview.data.total ? (
          <>
            <p className="px-5 pb-3 text-sm text-muted-foreground">
              {pluralize(preview.data.total, "transaction")} match
              {body.action.category
                ? `; ${preview.data.changes} would move to ${label(body.action.category)}`
                : ""}
              .
            </p>
            <TxnRows
              items={preview.data.items.slice(0, 8)}
              showAccount={false}
              className="border-t"
            />
          </>
        ) : (
          <EmptyState title="Nothing matches yet">
            {body.appliesFrom
              ? "New transactions that match will change as they arrive."
              : undefined}
          </EmptyState>
        )}
      </SectionCard>
    </PageGrid>
  )
}

function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Field orientation="horizontal" className="justify-between">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  )
}

function AddCondition({
  onAdd,
  disabled,
  label = "Add condition",
}: {
  onAdd: (kind: Kind) => void
  disabled?: (kind: Kind) => boolean
  label?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="w-fit" />}
      >
        <PlusIcon data-icon="inline-start" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {KINDS.map((k) => (
          <DropdownMenuItem
            key={k.kind}
            disabled={disabled?.(k.kind)}
            onClick={() => onAdd(k.kind)}
          >
            {k.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One condition: its name above, its value fields, and a remove button. */
function ConditionRow({
  c,
  onChange,
  onRemove,
}: {
  c: Cond
  onChange: (c: Cond) => void
  onRemove: () => void
}) {
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const id = `cond-${c.id}`
  const up = (patch: Partial<Cond>) => onChange({ ...c, ...patch })
  let control: ReactNode
  switch (c.kind) {
    case "merchant":
      control = (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Choice
            aria-label="How the merchant matches"
            className="w-full shrink-0 sm:w-36"
            value={c.op}
            onChange={(v) => up({ op: v as MerchantOp })}
            options={[
              { value: "contains", label: "Contains" },
              { value: "starts", label: "Starts with" },
              { value: "equals", label: "Is exactly" },
            ]}
          />
          <Input
            id={id}
            placeholder="Name as the bank shows it"
            value={c.value}
            onChange={(e) => up({ value: e.target.value })}
          />
        </div>
      )
      break
    case "description":
      control = (
        <Input
          id={id}
          placeholder="Text in the bank’s description"
          value={c.value}
          onChange={(e) => up({ value: e.target.value })}
        />
      )
      break
    case "flow":
      control = (
        <Choice
          id={id}
          className="w-full"
          value={c.value}
          placeholder="Choose a kind"
          onChange={(v) => up({ value: v })}
          options={Object.entries(FLOW_LABEL).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      )
      break
    case "category":
      control = (
        <CategorySelect
          id={id}
          categories={(categories.data ?? []).filter((x) => !x.custom)}
          value={c.value}
          placeholder="Choose the bank’s category"
          includeHidden
          onChange={(v) => up({ value: v })}
        />
      )
      break
    case "account":
      control = (
        <Choice
          id={id}
          className="w-full"
          value={c.value}
          placeholder="Choose an account"
          onChange={(v) => up({ value: v })}
          options={(accounts.data ?? []).map((a) => ({
            value: a.id,
            label: a.name,
          }))}
        />
      )
      break
    case "direction":
      control = (
        <Choice
          id={id}
          className="w-full"
          value={c.value}
          placeholder="Money in or out"
          onChange={(v) => up({ value: v })}
          options={[
            { value: "out", label: "Money out" },
            { value: "in", label: "Money in" },
          ]}
        />
      )
      break
    case "amount":
      control = (
        <div className="flex items-center gap-2">
          <InputGroup>
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput
              id={id}
              inputMode="decimal"
              placeholder="Min"
              value={c.from}
              onChange={(e) => up({ from: e.target.value })}
            />
          </InputGroup>
          <span className="text-sm text-muted-foreground">to</span>
          <InputGroup>
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput
              aria-label="Maximum amount"
              inputMode="decimal"
              placeholder="Max"
              value={c.to}
              onChange={(e) => up({ to: e.target.value })}
            />
          </InputGroup>
        </div>
      )
      break
    case "date":
      control = (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <DatePicker
            id={id}
            className="flex-1"
            value={c.from}
            placeholder="Any start"
            onChange={(v) => up({ from: v })}
          />
          <span className="text-sm text-muted-foreground max-sm:hidden">
            to
          </span>
          <DatePicker
            aria-label="Last date"
            className="flex-1"
            value={c.to}
            placeholder="Any end"
            onChange={(v) => up({ to: v })}
          />
        </div>
      )
      break
  }
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{kindLabel(c.kind)}</FieldLabel>
        <Button
          size="icon-sm"
          variant="ghost"
          className="-my-1 text-muted-foreground"
          aria-label={`Remove ${kindLabel(c.kind).toLowerCase()}`}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      {control}
    </Field>
  )
}

function SplitEditor({
  parts,
  problem,
  onChange,
}: {
  parts: Part[]
  problem: string | null
  onChange: (parts: Part[]) => void
}) {
  const categories = useQuery(categoriesQuery)
  const total = parts.reduce((s, p) => s + (basisPoints(p.percent) || 0), 0)
  return (
    <FieldSet data-invalid={!!problem}>
      <ul className="flex flex-col gap-2">
        {parts.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2">
            <CategorySelect
              aria-label={`Category for part ${i + 1}`}
              className="min-w-0 flex-1"
              categories={categories.data ?? []}
              value={p.category}
              placeholder="Choose a category"
              onChange={(v) =>
                onChange(
                  parts.map((x) => (x.id === p.id ? { ...x, category: v } : x))
                )
              }
            />
            <InputGroup className="w-24 shrink-0">
              <InputGroupInput
                aria-label={`Share for part ${i + 1}`}
                inputMode="decimal"
                value={p.percent}
                onChange={(e) =>
                  onChange(
                    parts.map((x) =>
                      x.id === p.id ? { ...x, percent: e.target.value } : x
                    )
                  )
                }
              />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={`Remove part ${i + 1}`}
              disabled={parts.length <= 2}
              onClick={() => onChange(parts.filter((x) => x.id !== p.id))}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={parts.length >= 10}
          onClick={() =>
            onChange([
              ...parts,
              {
                id: nextId++,
                category: "",
                percent: String(Math.max(0, (10000 - total) / 100)),
              },
            ])
          }
        >
          <PlusIcon data-icon="inline-start" />
          Add part
        </Button>
        <span
          className={cn(
            "text-sm tabular-nums",
            total === 10000 ? "text-muted-foreground" : "text-destructive"
          )}
        >
          Total {total / 100}%
        </span>
      </div>
      {problem ? <FieldError>{problem}</FieldError> : null}
    </FieldSet>
  )
}
