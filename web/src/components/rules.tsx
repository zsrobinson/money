import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { FormStack, PageGrid, PageStack } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@zsrobinson/shell/ui/native-select"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { Toggle } from "@zsrobinson/shell/ui/toggle"
import { EmptyState, Loading, SectionCard } from "@/components/money"
import {
  CategorySelect,
  TxnRows,
  useCategoryLabels,
} from "@/components/transactions"
import { send } from "@/lib/api"
import { money, pluralize } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { accountsQuery, categoriesQuery, tagsQuery } from "@/lib/queries"
import type { Rule, RuleAction, RuleMatch, Txn } from "@/lib/types"

export function describeRule(
  r: Pick<Rule, "match" | "action">,
  label: (code: string) => string,
  accountName?: (id: string) => string
) {
  const when: string[] = []
  const m = r.match
  if (m.merchant_contains)
    when.push(`merchant contains “${m.merchant_contains}”`)
  if (m.merchant_equals) when.push(`merchant is “${m.merchant_equals}”`)
  if (m.category) when.push(`category is ${label(m.category)}`)
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
  const then: string[] = []
  const a = r.action
  if (a.category) then.push(`set category to ${label(a.category)}`)
  if (a.merchant) then.push(`rename to “${a.merchant}”`)
  if (a.tags?.length) then.push(`add ${pluralize(a.tags.length, "tag")}`)
  if (a.mark_reviewed) then.push("mark reviewed")
  if (a.hide) then.push("hide")
  return `When ${when.join(" and ")}, ${then.join(", ")}`
}

type Form = {
  merchantMode: "contains" | "equals"
  merchant: string
  account: string
  category: string
  direction: "" | "in" | "out"
  min: string
  max: string
  setCategory: string
  rename: string
  tags: string[]
  review: boolean
  hide: boolean
  enabled: boolean
}

const dollars = (cents?: number) => (cents == null ? "" : String(cents / 100))
const toCents = (s: string) =>
  s.trim() === "" || Number.isNaN(Number(s))
    ? undefined
    : Math.round(Math.abs(Number(s)) * 100)

export function formFromRule(
  r?: Partial<Rule>,
  seed: { merchant?: string; category?: string; account?: string } = {}
): Form {
  const m = r?.match ?? {}
  const a = r?.action ?? {}
  return {
    merchantMode: m.merchant_equals ? "equals" : "contains",
    merchant: m.merchant_equals ?? m.merchant_contains ?? seed.merchant ?? "",
    account: m.account_id ?? seed.account ?? "",
    category: m.category ?? "",
    direction: m.direction ?? "",
    min: dollars(m.amount_min_cents),
    max: dollars(m.amount_max_cents),
    setCategory: a.category ?? seed.category ?? "",
    rename: a.merchant ?? "",
    tags: a.tags ?? [],
    review: a.mark_reviewed ?? false,
    hide: a.hide ?? false,
    enabled: r?.enabled ?? true,
  }
}

function toRule(f: Form): { match: RuleMatch; action: RuleAction } {
  const match: RuleMatch = {}
  if (f.merchant.trim())
    match[
      f.merchantMode === "equals" ? "merchant_equals" : "merchant_contains"
    ] = f.merchant.trim()
  if (f.account) match.account_id = f.account
  if (f.category) match.category = f.category
  if (f.direction) match.direction = f.direction
  const min = toCents(f.min)
  const max = toCents(f.max)
  if (min != null) match.amount_min_cents = min
  if (max != null) match.amount_max_cents = max
  const action: RuleAction = {}
  if (f.setCategory) action.category = f.setCategory
  if (f.rename.trim()) action.merchant = f.rename.trim()
  if (f.tags.length) action.tags = f.tags
  if (f.review) action.mark_reviewed = true
  if (f.hide) action.hide = true
  return { match, action }
}

export function RuleForm({ initial, rule }: { initial: Form; rule?: Rule }) {
  const navigate = useNavigate()
  const [f, setF] = useState(initial)
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setF((prev) => ({ ...prev, [key]: value }))
  const categories = useQuery(categoriesQuery)
  const accounts = useQuery(accountsQuery)
  const tags = useQuery(tagsQuery)
  const label = useCategoryLabels()
  const body = toRule(f)
  const hasMatch = Object.keys(body.match).length > 0
  const hasAction = Object.keys(body.action).length > 0
  const preview = useMutation({
    mutationFn: (b: {
      match: RuleMatch
      action: RuleAction
      ruleId?: string
    }) =>
      send<{ total: number; changes: number; items: Txn[] }>(
        "POST",
        "/api/rules/preview",
        b
      ),
  })
  const key = JSON.stringify(body)
  useEffect(() => {
    if (!hasMatch) return
    const id = setTimeout(
      () =>
        preview.mutate({
          ...body,
          action: hasAction ? body.action : undefined,
          ruleId: rule?.id,
        } as never),
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
    const payload = { ...body, enabled: f.enabled }
    if (rule) update.mutate(payload)
    else create.mutate(payload)
  }
  return (
    <PageGrid layout="wide">
      <FormStack>
        <SectionCard title="When a transaction matches">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="rule-merchant">Merchant</FieldLabel>
              <div className="flex gap-2">
                <NativeSelect
                  aria-label="Merchant match"
                  className="w-32 shrink-0"
                  value={f.merchantMode}
                  onChange={(e) =>
                    set("merchantMode", e.target.value as Form["merchantMode"])
                  }
                >
                  <NativeSelectOption value="contains">
                    Contains
                  </NativeSelectOption>
                  <NativeSelectOption value="equals">
                    Is exactly
                  </NativeSelectOption>
                </NativeSelect>
                <Input
                  id="rule-merchant"
                  placeholder="Any merchant"
                  value={f.merchant}
                  onChange={(e) => set("merchant", e.target.value)}
                />
              </div>
              <FieldDescription>
                Matching ignores case, accents and extra spaces, and uses the
                bank’s merchant name.
              </FieldDescription>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rule-account">Account</FieldLabel>
                <NativeSelect
                  id="rule-account"
                  className="w-full"
                  value={f.account}
                  onChange={(e) => set("account", e.target.value)}
                >
                  <NativeSelectOption value="">Any account</NativeSelectOption>
                  {(accounts.data ?? []).map((a) => (
                    <NativeSelectOption key={a.id} value={a.id}>
                      {a.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-category">Bank category</FieldLabel>
                <CategorySelect
                  id="rule-category"
                  categories={(categories.data ?? []).filter((c) => !c.custom)}
                  value={f.category}
                  placeholder="Any category"
                  onChange={(v) => set("category", v)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-direction">Direction</FieldLabel>
                <NativeSelect
                  id="rule-direction"
                  className="w-full"
                  value={f.direction}
                  onChange={(e) =>
                    set("direction", e.target.value as Form["direction"])
                  }
                >
                  <NativeSelectOption value="">
                    Money in or out
                  </NativeSelectOption>
                  <NativeSelectOption value="out">Money out</NativeSelectOption>
                  <NativeSelectOption value="in">Money in</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-min">Amount</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="rule-min"
                    inputMode="decimal"
                    placeholder="Min"
                    value={f.min}
                    onChange={(e) => set("min", e.target.value)}
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    aria-label="Maximum amount"
                    inputMode="decimal"
                    placeholder="Max"
                    value={f.max}
                    onChange={(e) => set("max", e.target.value)}
                  />
                </div>
              </Field>
            </div>
          </FieldGroup>
        </SectionCard>
        <SectionCard title="Then">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rule-set-category">
                  Set category
                </FieldLabel>
                <CategorySelect
                  id="rule-set-category"
                  categories={categories.data ?? []}
                  value={f.setCategory}
                  placeholder="Keep category"
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
            <Field orientation="horizontal">
              <Switch
                id="rule-review"
                checked={f.review}
                onCheckedChange={(v) => set("review", v)}
              />
              <FieldLabel htmlFor="rule-review">Mark reviewed</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="rule-hide"
                checked={f.hide}
                onCheckedChange={(v) => set("hide", v)}
              />
              <FieldLabel htmlFor="rule-hide">Hide from totals</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="rule-enabled"
                checked={f.enabled}
                onCheckedChange={(v) => set("enabled", v)}
              />
              <FieldLabel htmlFor="rule-enabled">Rule is on</FieldLabel>
            </Field>
          </FieldGroup>
        </SectionCard>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {rule ? (
            <ConfirmAction
              trigger={
                <Button variant="ghost" className="mr-auto text-destructive">
                  Delete rule
                </Button>
              }
              title="Delete this rule?"
              confirmLabel="Delete rule"
              destructive
              onConfirm={() => remove.mutateAsync()}
            >
              Transactions it changed go back to their bank values unless you
              edited them yourself.
            </ConfirmAction>
          ) : null}
          <Button
            variant="outline"
            onClick={() => void navigate({ to: "/rules" })}
          >
            Cancel
          </Button>
          <Button disabled={!hasMatch || !hasAction || saving} onClick={submit}>
            {rule ? "Save rule" : "Create rule"}
          </Button>
        </div>
      </FormStack>
      <PageStack className="lg:sticky lg:top-16">
        <SectionCard title="Matches" flush>
          {!hasMatch ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              Add a condition to see which transactions this rule changes.
            </p>
          ) : !preview.data ? (
            <Loading rows={4} className="px-5 pb-5" />
          ) : preview.data.total ? (
            <>
              <p className="px-5 pb-2 text-sm text-muted-foreground">
                {pluralize(preview.data.total, "transaction")} match
                {body.action.category
                  ? `, ${preview.data.changes} would move to ${label(body.action.category)}`
                  : ""}
                .
              </p>
              <TxnRows
                items={preview.data.items.slice(0, 8)}
                showAccount={false}
              />
            </>
          ) : (
            <EmptyState title="Nothing matches yet">
              The rule still applies to future transactions.
            </EmptyState>
          )}
        </SectionCard>
        {rule ? (
          <p className="px-1 text-xs text-muted-foreground">
            Rules run in order. For each field, the first matching rule wins,
            and your own edits to a transaction always win.
          </p>
        ) : null}
      </PageStack>
    </PageGrid>
  )
}
