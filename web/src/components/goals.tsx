import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { FormStack } from "@zsrobinson/shell"
import { Button } from "@zsrobinson/shell/ui/button"
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
import { SectionCard } from "@/components/money"
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
    goal ? String(goal.targetCents / 100) : ""
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
    onSuccess: () => done(goal?.id),
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
      <SectionCard title={goal ? "Goal" : "New goal"}>
        <FieldGroup>
          <Field data-invalid={tried && !!errors.name}>
            <FieldLabel htmlFor="goal-name">Name</FieldLabel>
            <Input
              id="goal-name"
              value={name}
              placeholder="Emergency fund"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={tried && !!errors.target}>
              <FieldLabel htmlFor="goal-target">
                {kind === "payoff"
                  ? "Starting balance to pay off"
                  : "Target amount"}
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>$</InputGroupAddon>
                <InputGroupInput
                  id="goal-target"
                  inputMode="decimal"
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
              <FieldLabel htmlFor="goal-date">Target date</FieldLabel>
              <Input
                id="goal-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <FieldDescription>
                Optional. Used to tell whether you are on track.
              </FieldDescription>
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
                  <input
                    type="checkbox"
                    className="size-4 accent-(--primary)"
                    checked={chosen.includes(a.id)}
                    onChange={(e) =>
                      setIds((prev) =>
                        e.target.checked
                          ? [...prev, a.id]
                          : prev.filter((x) => x !== a.id)
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
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => done(goal?.id)}>
          Cancel
        </Button>
        <Button
          disabled={create.isPending || update.isPending}
          onClick={submit}
        >
          {goal ? "Save goal" : "Create goal"}
        </Button>
      </div>
    </FormStack>
  )
}
