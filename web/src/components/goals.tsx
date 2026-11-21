import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { FormStack } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
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
import { InfoTip, SectionCard } from "@/components/money"
import { DatePicker } from "@/components/pickers"
import { money } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { accountsQuery } from "@/lib/queries"
import type { Goal } from "@/lib/types"

type Body = {
  name: string
  kind: "save" | "payoff"
  targetCents: number
  targetDate: string | null
  accountIds: string[]
}

export function GoalForm({ goal }: { goal?: Goal }) {
  const navigate = useNavigate()
  const accounts = useQuery(accountsQuery)
  const [name, setName] = useState(goal?.name ?? "")
  const [kind, setKind] = useState<"save" | "payoff">(goal?.kind ?? "save")
  const [target, setTarget] = useState(
    goal ? (goal.targetCents / 100).toLocaleString() : ""
  )
  const [date, setDate] = useState(goal?.targetDate ?? "")
  const [ids, setIds] = useState<string[]>(goal?.accountIds ?? [])
  const [tried, setTried] = useState(false)
  const done = (id?: string) =>
    void navigate(id ? { to: "/goals/$id", params: { id } } : { to: "/goals" })
  const create = useSend<Body, { id: string }>("POST", "/api/goals", {
    success: "Goal created",
    onSuccess: (r) => done(r.id),
  })
  const update = useSend<Body>("PUT", `/api/goals/${goal?.id}`, {
    success: "Goal saved",
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
  const cents = Math.round(Number(target.replace(/[^0-9.]/g, "")) * 100)
  const chosen = ids.filter((id) => eligible.some((a) => a.id === id))
  const errors = {
    name: !name.trim() ? "Name the goal" : null,
    target: !(cents > 0) ? "Enter an amount above zero" : null,
    accounts: !chosen.length ? "Choose at least one account" : null,
  }
  const submit = () => {
    setTried(true)
    if (Object.values(errors).some(Boolean)) return
    const body = {
      name: name.trim(),
      kind,
      targetCents: cents,
      targetDate: date || null,
      accountIds: chosen,
    }
    if (goal) update.mutate(body)
    else create.mutate(body)
  }
  const current = eligible
    .filter((a) => chosen.includes(a.id))
    .reduce((s, a) => s + Math.abs(a.balanceCents ?? 0), 0)
  return (
    <FormStack>
      <SectionCard
        title={goal ? "Edit goal" : "Details"}
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
            ) : (
              <Button variant="outline" onClick={() => done()}>
                Cancel
              </Button>
            )}
            <Button
              disabled={create.isPending || update.isPending}
              onClick={submit}
            >
              {goal ? "Save goal" : "Create goal"}
            </Button>
          </>
        }
      >
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
              onValueChange={(v) => v[0] && setKind(v[0] as "save" | "payoff")}
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
          <FieldSet data-invalid={tried && !!errors.accounts}>
            <FieldLegend variant="label">
              {kind === "payoff"
                ? "Debts to pay off"
                : "Accounts that hold this money"}
            </FieldLegend>
            <div className="flex flex-col divide-y divide-border/70 rounded-xl border">
              {eligible.map((a) => (
                <label
                  key={a.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm"
                >
                  <Checkbox
                    checked={chosen.includes(a.id)}
                    onCheckedChange={(on) =>
                      setIds((prev) =>
                        on ? [...prev, a.id] : prev.filter((x) => x !== a.id)
                      )
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {money(Math.abs(a.balanceCents ?? 0), { whole: true })}
                  </span>
                </label>
              ))}
              {!eligible.length ? (
                <p className="px-3 py-2.5 text-sm text-muted-foreground">
                  No{" "}
                  {kind === "payoff" ? "credit or loan" : "cash or investment"}{" "}
                  accounts yet.
                </p>
              ) : null}
            </div>
            {tried && errors.accounts ? (
              <FieldError>{errors.accounts}</FieldError>
            ) : null}
            {chosen.length ? (
              <FieldDescription>
                {kind === "payoff" ? "Owed now" : "Saved now"}:{" "}
                {money(current, { whole: true })}
              </FieldDescription>
            ) : null}
          </FieldSet>
        </FieldGroup>
      </SectionCard>
    </FormStack>
  )
}
