import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { FormStack } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { Alert, AlertDescription, AlertTitle } from "@zsrobinson/shell/ui/alert"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { Checkbox } from "@zsrobinson/shell/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import { ToggleGroup, ToggleGroupItem } from "@zsrobinson/shell/ui/toggle-group"
import { TriangleAlertIcon } from "lucide-react"
import {
  CardLink,
  EmptyState,
  InfoTip,
  Meter,
  SectionCard,
} from "@/components/money"
import { DatePicker } from "@/components/pickers"
import { fullDate, money, parseDay, percent } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { accountsQuery, goalsQuery, metaQuery } from "@/lib/queries"
import type { AccountListItem, Goal, GoalAllocation } from "@/lib/types"

type Mode = GoalAllocation["mode"]

/** Reached, on track or behind; nothing when there is no target date. */
export function GoalStatus({ goal: g }: { goal: Goal }) {
  if (g.progress >= 1) return <Badge>Reached</Badge>
  if (g.onTrack === true) return <Badge variant="positive">On track</Badge>
  if (g.onTrack === false) return <Badge variant="destructive">Behind</Badge>
  return null
}

/** How much of an account a goal counts, in words. */
export function allocationLabel(a: Pick<GoalAllocation, "mode" | "value">) {
  if (a.mode === "amount")
    return `Up to ${money(a.value ?? 0, { whole: true })}`
  if (a.mode === "percent") return `${percent((a.value ?? 0) / 10000)} of it`
  return "All of it"
}

/** What a goal has so far: saved, or paid off for a debt. */
export const goalDone = (g: Goal) =>
  g.kind === "payoff" ? g.targetCents - g.currentCents : g.currentCents

/** Accounts another goal also counts beyond their balance. */
export function OverlapAlert({
  overlaps,
  className,
}: {
  overlaps: { accountName: string; goals: string[] }[]
  className?: string
}) {
  if (!overlaps.length) return null
  return (
    <Alert className={className}>
      <TriangleAlertIcon />
      <AlertTitle>Shared with other goals</AlertTitle>
      <AlertDescription>
        {overlaps.map((o) => (
          <p key={o.accountName} className="mb-0!">
            {o.goals.length ? names(o.goals) : "Other goals"} also{" "}
            {o.goals.length === 1 ? "counts" : "count"} {o.accountName}, so
            together they count more than its balance.
          </p>
        ))}
      </AlertDescription>
    </Alert>
  )
}

const names = (xs: string[]) =>
  xs.length < 3
    ? xs.join(" and ")
    : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`

/** Up to three goals with their progress, for the dashboard. */
export function GoalsCard({ goals }: { goals: Goal[] }) {
  return (
    <SectionCard
      title="Goals"
      flush
      action={<CardLink to="/goals">All goals</CardLink>}
    >
      {goals.length ? (
        <ul className="flex flex-col border-t">
          {goals.slice(0, 3).map((g) => (
            <li
              key={g.id}
              className="border-b border-border/70 last:border-b-0"
            >
              <Link
                to="/goals/$id"
                params={{ id: g.id }}
                className="flex flex-col gap-2 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:px-5"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium">{g.name}</span>
                  <GoalStatus goal={g} />
                </span>
                <Meter
                  label={`${g.name} progress`}
                  value={g.progress}
                  tone={g.progress >= 1 ? "positive" : "default"}
                />
                <span className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                  <span>
                    <span className="font-medium text-foreground">
                      {money(goalDone(g), { whole: true })}
                    </span>{" "}
                    of {money(g.targetCents, { whole: true })}
                  </span>
                  <span>{percent(g.progress)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No goals yet"
          action={<CardLink to="/goals/new">New goal</CardLink>}
        />
      )}
    </SectionCard>
  )
}

type Draft = { mode: Mode; text: string }

const parseNumber = (text: string) => Number(text.replace(/[^0-9.]/g, ""))
/** A draft allocation's stored value: cents, or basis points for a share. */
function draftValue(d: Draft) {
  if (d.mode === "all") return null
  const n = parseNumber(d.text)
  // Dollars to cents, or a percent to basis points: both scale by 100.
  return n > 0 ? Math.round(n * 100) : 0
}
/** What part of a balance an allocation counts, as the server works it out. */
function counted(mode: Mode, value: number | null, balance: number) {
  const base = Math.max(0, balance)
  if (mode === "amount") return Math.min(value ?? 0, base)
  if (mode === "percent") return Math.round((base * (value ?? 0)) / 10000)
  return base
}
function claimed(mode: Mode, value: number | null, balance: number) {
  if (mode === "all") return balance
  if (mode === "percent") return (balance * (value ?? 0)) / 10000
  return value ?? 0
}

type Body = {
  name: string
  kind: "save" | "payoff"
  targetCents: number
  targetDate: string | null
  monthlyCents: number | null
  allocations: { accountId: string; mode: Mode; value: number | null }[]
}

const MONTH_MS = 30.44 * 86_400_000

/** Create or edit a goal: target, date, monthly plan and how much of each account counts. */
export function GoalForm({ goal }: { goal?: Goal }) {
  const navigate = useNavigate()
  const accounts = useQuery(accountsQuery)
  const others = (useQuery(goalsQuery).data ?? []).filter(
    (g) => g.id !== goal?.id
  )
  const today = useQuery(metaQuery).data?.today
  const [name, setName] = useState(goal?.name ?? "")
  const [kind, setKind] = useState<"save" | "payoff">(goal?.kind ?? "save")
  const [target, setTarget] = useState(
    goal ? (goal.targetCents / 100).toLocaleString() : ""
  )
  const [date, setDate] = useState(goal?.targetDate ?? "")
  const [monthly, setMonthly] = useState(
    goal?.monthlyCents ? (goal.monthlyCents / 100).toLocaleString() : ""
  )
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      (goal?.allocations ?? []).map((a) => [
        a.accountId,
        {
          mode: a.mode,
          text:
            a.mode === "all" || a.value == null
              ? ""
              : a.mode === "amount"
                ? (a.value / 100).toLocaleString()
                : String(a.value / 100),
        },
      ])
    )
  )
  const [tried, setTried] = useState(false)
  const done = (id?: string) =>
    void navigate(id ? { to: "/goals/$id", params: { id } } : { to: "/goals" })
  const create = useSend<Body, { id: string }>("POST", "/api/goals", {
    success: "Goal created",
    onSuccess: (r) => done(r.id),
  })
  const update = useSend<Body>("PUT", `/api/goals/${goal?.id}`, {
    success: "Goal saved",
    onSuccess: () => done(goal?.id),
  })
  const remove = useSend("DELETE", `/api/goals/${goal?.id}`, {
    success: "Goal deleted",
    onSuccess: () => done(),
  })
  const eligible = (accounts.data ?? []).filter(
    (a) =>
      a.availability === "available" &&
      (kind === "payoff" ? a.liability : !a.liability && a.type !== "other")
  )
  // Debts count what is owed, so every balance reads as a positive amount.
  const balance = (a: AccountListItem) => Math.abs(a.balanceCents ?? 0)
  const chosen = eligible.filter((a) => drafts[a.id])
  const cents = Math.round(parseNumber(target) * 100)
  const monthlyCents = monthly.trim()
    ? Math.round(parseNumber(monthly) * 100)
    : null
  const badValue = chosen.find((a) => {
    const d = drafts[a.id]
    const v = draftValue(d)
    return d.mode !== "all" && (!v || (d.mode === "percent" && v > 10000))
  })
  const errors = {
    name: !name.trim() ? "Name the goal" : null,
    target: !(cents > 0) ? "Enter an amount above zero" : null,
    accounts: !chosen.length
      ? "Choose at least one account"
      : badValue
        ? drafts[badValue.id].mode === "percent"
          ? `Enter a share from 1% to 100% for ${badValue.name}`
          : `Enter an amount for ${badValue.name}`
        : null,
  }
  const submit = () => {
    setTried(true)
    if (Object.values(errors).some(Boolean)) return
    const body: Body = {
      name: name.trim(),
      kind,
      targetCents: cents,
      targetDate: date || null,
      monthlyCents,
      allocations: chosen.map((a) => ({
        accountId: a.id,
        mode: drafts[a.id].mode,
        value: draftValue(drafts[a.id]),
      })),
    }
    if (goal) update.mutate(body)
    else create.mutate(body)
  }
  const current = chosen.reduce(
    (s, a) =>
      s + counted(drafts[a.id].mode, draftValue(drafts[a.id]), balance(a)),
    0
  )
  // Live: accounts this goal and others together count beyond the balance.
  const overlaps = chosen.flatMap((a) => {
    const theirs = others.flatMap((g) =>
      g.allocations
        .filter((x) => x.accountId === a.id)
        .map((x) => ({ goal: g.name, ...x }))
    )
    if (!theirs.length) return []
    const total =
      claimed(drafts[a.id].mode, draftValue(drafts[a.id]), balance(a)) +
      theirs.reduce((s, x) => s + claimed(x.mode, x.value, balance(a)), 0)
    return total > balance(a) + 1
      ? [{ accountName: a.name, goals: theirs.map((x) => x.goal) }]
      : []
  })
  const remaining = kind === "payoff" ? current : Math.max(0, cents - current)
  const monthsLeft =
    date && today
      ? Math.max(
          1,
          (parseDay(date).getTime() - parseDay(today).getTime()) / MONTH_MS
        )
      : null
  const needed =
    monthsLeft && remaining > 0 && chosen.length
      ? Math.ceil(remaining / monthsLeft)
      : null
  const setDraft = (id: string, next: Partial<Draft> | null) =>
    setDrafts((prev) => {
      const copy = { ...prev }
      if (next === null) delete copy[id]
      else copy[id] = { ...(prev[id] ?? { mode: "all", text: "" }), ...next }
      return copy
    })
  return (
    <FormStack>
      <SectionCard title="Goal">
        <FieldGroup className="@container">
          <Field data-invalid={tried && !!errors.name}>
            <FieldLabel htmlFor="goal-name">Name</FieldLabel>
            <Input
              id="goal-name"
              value={name}
              placeholder="What are you saving for?"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={tried && !!errors.name}
            />
            {tried && errors.name ? (
              <FieldError>{errors.name}</FieldError>
            ) : null}
          </Field>
          <FieldSet>
            <FieldLegend variant="label">Kind</FieldLegend>
            <ToggleGroup
              variant="outline"
              value={[kind]}
              onValueChange={(v) => {
                if (!v[0] || v[0] === kind) return
                setKind(v[0] as "save" | "payoff")
                setDrafts({})
              }}
            >
              <ToggleGroupItem value="save">Save up</ToggleGroupItem>
              <ToggleGroupItem value="payoff">Pay off debt</ToggleGroupItem>
            </ToggleGroup>
          </FieldSet>
          <div className="grid gap-4 @lg:grid-cols-2">
            <Field data-invalid={tried && !!errors.target}>
              <FieldLabel htmlFor="goal-target">
                {kind === "payoff" ? "Balance to pay off" : "Target amount"}
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>$</InputGroupAddon>
                <InputGroupInput
                  id="goal-target"
                  inputMode="decimal"
                  placeholder="0"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  aria-invalid={tried && !!errors.target}
                />
              </InputGroup>
              {tried && errors.target ? (
                <FieldError>{errors.target}</FieldError>
              ) : null}
            </Field>
            <Field>
              <span className="flex items-center gap-0.5">
                <FieldLabel htmlFor="goal-date">Target date</FieldLabel>
                <InfoTip label="About the target date">
                  Optional. It decides whether the goal is on track.
                </InfoTip>
              </span>
              <DatePicker
                id="goal-date"
                value={date}
                placeholder="No date"
                onChange={setDate}
              />
            </Field>
          </div>
          <Field>
            <span className="flex items-center gap-0.5">
              <FieldLabel htmlFor="goal-monthly">
                {kind === "payoff" ? "Planned payment" : "Planned saving"}
              </FieldLabel>
              <InfoTip label="About the planned amount">
                Optional. It shows in Budgets as money set aside each month.
              </InfoTip>
            </span>
            <InputGroup className="@lg:max-w-[calc(50%-0.5rem)]">
              <InputGroupAddon>$</InputGroupAddon>
              <InputGroupInput
                id="goal-monthly"
                inputMode="decimal"
                placeholder="0"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
              <InputGroupAddon align="inline-end">/ month</InputGroupAddon>
            </InputGroup>
            {needed != null ? (
              <FieldDescription>
                {money(needed, { whole: true })} / month reaches it by{" "}
                {fullDate(date)}
                {monthlyCents != null && monthlyCents > 0
                  ? monthlyCents >= needed
                    ? ", so this plan covers it."
                    : `, ${money(needed - monthlyCents, { whole: true })} more than planned.`
                  : "."}
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
      </SectionCard>
      <SectionCard
        title={kind === "payoff" ? "Debts" : "Accounts"}
        info={
          kind === "payoff"
            ? "Choose the debts this goal pays off."
            : "Choose where this money is kept, and how much of each account counts toward the goal."
        }
        footer={
          <>
            {goal ? (
              <ConfirmAction
                trigger={
                  <Button variant="ghost" className="mr-auto text-destructive">
                    Delete goal
                  </Button>
                }
                title={`Delete ${goal.name}?`}
                confirmLabel="Delete goal"
                destructive
                onConfirm={() => remove.mutateAsync()}
              >
                Your accounts and transactions are unchanged.
              </ConfirmAction>
            ) : null}
            <Button variant="outline" onClick={() => done(goal?.id)}>
              Cancel
            </Button>
            <Button
              disabled={create.isPending || update.isPending}
              onClick={submit}
            >
              {goal ? "Save goal" : "Create goal"}
            </Button>
          </>
        }
      >
        <FieldSet data-invalid={tried && !!errors.accounts}>
          <FieldLegend className="sr-only">
            {kind === "payoff" ? "Debts to pay off" : "Accounts for this goal"}
          </FieldLegend>
          <div className="flex flex-col divide-y divide-border/70 rounded-xl border">
            {eligible.map((a) => {
              const d = drafts[a.id]
              const on = Boolean(d)
              return (
                <div key={a.id} className="flex flex-col gap-3 px-3 py-2.5">
                  <label className="flex min-h-8 cursor-pointer items-center gap-3 text-sm">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) =>
                        setDraft(a.id, v ? { mode: "all", text: "" } : null)
                      }
                    />
                    <span className="min-w-0 flex-1 font-medium">{a.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {money(balance(a), { whole: true })}
                    </span>
                  </label>
                  {d && kind === "save" ? (
                    <div className="flex flex-wrap items-center gap-2 pl-7">
                      <ToggleGroup
                        variant="outline"
                        spacing={0}
                        aria-label={`How much of ${a.name} counts`}
                        value={[d.mode]}
                        onValueChange={(v) =>
                          v[0] && setDraft(a.id, { mode: v[0] as Mode })
                        }
                      >
                        <ToggleGroupItem value="all">All of it</ToggleGroupItem>
                        <ToggleGroupItem value="amount">Amount</ToggleGroupItem>
                        <ToggleGroupItem value="percent">Share</ToggleGroupItem>
                      </ToggleGroup>
                      {d.mode !== "all" ? (
                        <InputGroup className="w-32">
                          {d.mode === "amount" ? (
                            <InputGroupAddon>$</InputGroupAddon>
                          ) : null}
                          <InputGroupInput
                            aria-label={
                              d.mode === "amount"
                                ? `Amount of ${a.name}`
                                : `Share of ${a.name}`
                            }
                            inputMode="decimal"
                            placeholder="0"
                            value={d.text}
                            onChange={(e) =>
                              setDraft(a.id, { text: e.target.value })
                            }
                          />
                          {d.mode === "percent" ? (
                            <InputGroupAddon align="inline-end">
                              %
                            </InputGroupAddon>
                          ) : null}
                        </InputGroup>
                      ) : null}
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        Counts{" "}
                        {money(counted(d.mode, draftValue(d), balance(a)), {
                          whole: true,
                        })}
                      </span>
                    </div>
                  ) : null}
                </div>
              )
            })}
            {!eligible.length ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">
                No {kind === "payoff" ? "credit or loan" : "cash or investment"}{" "}
                accounts yet.
              </p>
            ) : null}
          </div>
          {tried && errors.accounts ? (
            <FieldError>{errors.accounts}</FieldError>
          ) : null}
          {chosen.length ? (
            <FieldDescription>
              {kind === "payoff" ? "Owed now" : "Counts now"}:{" "}
              {money(current, { whole: true })}
            </FieldDescription>
          ) : null}
        </FieldSet>
        <OverlapAlert overlaps={overlaps} className="mt-4" />
      </SectionCard>
    </FormStack>
  )
}
