import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { TrendChart } from "@zsrobinson/shell/blocks/chart-card"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@zsrobinson/shell/ui/input-group"
import { Switch } from "@zsrobinson/shell/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@zsrobinson/shell/ui/table"
import { Trash2Icon } from "lucide-react"
import {
  accountGroup,
  isDebt,
  MANUAL_TYPES,
  parseCents,
} from "@/components/accounts"
import { InfoTip, SectionCard } from "@/components/money"
import { Choice, DatePicker } from "@/components/pickers"
import {
  daysBetween,
  epochMonthYear,
  fullDate,
  money,
  moneyTick,
  monthEpoch,
  monthShortYear,
  relativeDay,
  sentenceCase,
} from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { metaQuery } from "@/lib/queries"
import type { Account, Liability, ManualType, MonthFlow } from "@/lib/types"

const whole = (d: number) => money(Math.round(d * 100), { whole: true })

type Flow = MonthFlow & { transferInCents: number; transferOutCents: number }

/**
 * Income and spending as bars; transfers (card payments, savings moves) are
 * movement rather than earning or spending, so they sit in a table beneath.
 */
export function MoneyInOut({ a, flows }: { a: Account; flows: Flow[] }) {
  const config = {
    ...(flows.some((f) => f.incomeCents)
      ? { income: { label: "Income", color: "var(--chart-positive)" } }
      : {}),
    ...(flows.some((f) => f.spendingCents)
      ? { spending: { label: "Spending", color: "var(--chart-negative)" } }
      : {}),
  }
  const moved = flows.filter((f) => f.transferInCents || f.transferOutCents)
  const hasIn = moved.some((f) => f.transferInCents)
  const hasOut = moved.some((f) => f.transferOutCents)
  if (!Object.keys(config).length && !moved.length) return null
  return (
    <SectionCard title="Money in and out" flush={!Object.keys(config).length}>
      {Object.keys(config).length ? (
        <TrendChart
          kind="bar"
          label={`${a.name} income and spending by month`}
          data={flows.map((f) => ({
            time: monthEpoch(f.month),
            ...("income" in config ? { income: f.incomeCents / 100 } : {}),
            ...("spending" in config
              ? { spending: f.spendingCents / 100 }
              : {}),
          }))}
          config={config}
          legend
          format={whole}
          formatTick={moneyTick}
          formatTime={epochMonthYear}
          className="h-52"
        />
      ) : null}
      {moved.length ? (
        <Table className={Object.keys(config).length ? "mt-4" : undefined}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-0">Transfers</TableHead>
              {hasIn ? (
                <TableHead className="text-right">
                  {a.liability ? "Payments" : "In"}
                </TableHead>
              ) : null}
              {hasOut ? (
                <TableHead className="pr-0 text-right">Out</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {moved.toReversed().map((f) => (
              <TableRow key={f.month}>
                <TableCell className="pl-0">
                  {monthShortYear(f.month)}
                </TableCell>
                {hasIn ? (
                  <TableCell className="text-right tabular-nums">
                    {f.transferInCents ? money(f.transferInCents) : "—"}
                  </TableCell>
                ) : null}
                {hasOut ? (
                  <TableCell className="pr-0 text-right tabular-nums">
                    {f.transferOutCents ? money(f.transferOutCents) : "—"}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </SectionCard>
  )
}

/** The card's last statement, from the bank's liability data. */
export function StatementCard({ l, today }: { l: Liability; today?: string }) {
  return (
    <SectionCard
      title="Statement"
      action={
        l.isOverdue ? <Badge variant="destructive">Overdue</Badge> : undefined
      }
    >
      <DetailList>
        <DetailRow label="Statement balance">
          {l.lastStatementBalanceCents != null ? (
            money(l.lastStatementBalanceCents)
          ) : (
            <Unavailable />
          )}
        </DetailRow>
        {l.lastStatementDate ? (
          <DetailRow label="Statement date">
            {fullDate(l.lastStatementDate)}
          </DetailRow>
        ) : null}
        <DetailRow label="Minimum payment">
          {l.minimumPaymentCents != null ? (
            money(l.minimumPaymentCents)
          ) : (
            <Unavailable />
          )}
        </DetailRow>
        <DetailRow label="Due">
          {l.nextPaymentDueDate ? (
            <span>
              {fullDate(l.nextPaymentDueDate)}
              {today &&
              Math.abs(daysBetween(today, l.nextPaymentDueDate)) < 7 ? (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {relativeDay(l.nextPaymentDueDate, today)}
                </span>
              ) : null}
            </span>
          ) : (
            <Unavailable />
          )}
        </DetailRow>
        <DetailRow label="Last payment">
          {l.lastPaymentCents != null ? (
            <span>
              {money(l.lastPaymentCents)}
              {l.lastPaymentDate ? (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {fullDate(l.lastPaymentDate)}
                </span>
              ) : null}
            </span>
          ) : (
            <Unavailable />
          )}
        </DetailRow>
        <DetailRow label="APR">
          {l.aprPercent != null ? `${l.aprPercent}%` : <Unavailable />}
        </DetailRow>
      </DetailList>
    </SectionCard>
  )
}

/** A manual account's stated balances, newest first, with a way to add one. */
export function BalanceUpdates({
  a,
  balances,
}: {
  a: Account
  balances: { date: string; cents: number }[]
}) {
  const today = useQuery(metaQuery).data?.today ?? ""
  const debt = isDebt(a.manualType)
  const [date, setDate] = useState("")
  const [amount, setAmount] = useState("")
  const [tried, setTried] = useState(false)
  const put = useSend<{ date: string; cents: number }>(
    "PUT",
    (v) => `/api/accounts/${a.id}/balances/${v.date}`,
    {
      body: (v) => ({ cents: v.cents }),
      success: "Balance updated",
      onSuccess: () => {
        setAmount("")
        setTried(false)
      },
    }
  )
  const remove = useSend<string>(
    "DELETE",
    (d) => `/api/accounts/${a.id}/balances/${d}`,
    { success: "Balance removed" }
  )
  const cents = parseCents(amount)
  const error = cents == null ? "Enter an amount" : null
  const submit = () => {
    setTried(true)
    if (cents == null) return
    put.mutate({ date: date || today, cents: debt ? Math.abs(cents) : cents })
  }
  return (
    <SectionCard title="Balance updates" flush>
      <form
        className="flex flex-wrap items-start gap-2 px-5 pb-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field className="min-w-36 flex-1 basis-36">
          <FieldLabel htmlFor="balance-date">Date</FieldLabel>
          <DatePicker
            id="balance-date"
            value={date || today}
            clearable={false}
            onChange={setDate}
          />
        </Field>
        <Field
          className="min-w-36 flex-1 basis-36"
          data-invalid={tried && !!error}
        >
          <FieldLabel htmlFor="balance-amount">
            {debt ? "Amount owed" : "Balance"}
          </FieldLabel>
          <InputGroup>
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput
              id="balance-amount"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              aria-invalid={tried && !!error}
              onChange={(e) => setAmount(e.target.value)}
            />
          </InputGroup>
          {tried && error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button type="submit" className="mt-6" disabled={put.isPending}>
          Update balance
        </Button>
      </form>
      {balances.length ? (
        <ul className="flex flex-col divide-y divide-border/70 border-t">
          {balances.map((b) => (
            <li
              key={b.date}
              className="flex min-h-12 items-center gap-3 py-1.5 pr-3 pl-5"
            >
              <span className="flex-1 text-sm">{fullDate(b.date)}</span>
              <span className="text-sm font-medium tabular-nums">
                {money(b.cents)}
              </span>
              <ConfirmAction
                trigger={
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground"
                    aria-label={`Remove the balance on ${fullDate(b.date)}`}
                  >
                    <Trash2Icon />
                  </Button>
                }
                title="Remove this balance?"
                confirmLabel="Remove"
                destructive
                onConfirm={() => remove.mutateAsync(b.date)}
              >
                The {money(b.cents)} balance on {fullDate(b.date)} is removed;
                the balance before it carries forward.
              </ConfirmAction>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          No balances yet.
        </p>
      )}
    </SectionCard>
  )
}

/** Name, type and visibility; a manual account can also close or be deleted. */
export function AccountSettings({
  a,
  closedAt,
}: {
  a: Account
  closedAt: string | null
}) {
  const navigate = useNavigate()
  const save = useSend<Record<string, unknown>>(
    "PATCH",
    `/api/accounts/${a.id}`,
    { success: "Account updated" }
  )
  const remove = useSend("DELETE", `/api/accounts/${a.id}`, {
    success: `Deleted ${a.name}`,
    onSuccess: () => void navigate({ to: "/accounts" }),
  })
  // A linked account's name is a display name over the bank's; a manual
  // account's name is its own.
  const shown = a.manual ? a.name : a.name === a.label ? "" : a.name
  const [name, setName] = useState(shown)
  return (
    <SectionCard
      title="Settings"
      footer={
        a.manual ? (
          <>
            <ConfirmAction
              trigger={
                <Button variant="ghost" className="mr-auto text-destructive">
                  Delete account
                </Button>
              }
              title={`Delete ${a.name}?`}
              confirmLabel="Delete account"
              destructive
              onConfirm={() => remove.mutateAsync()}
            >
              Its balances and every transaction in it are removed. This can’t
              be undone.
            </ConfirmAction>
            {closedAt ? (
              <Button
                variant="outline"
                onClick={() => save.mutate({ closed: false })}
              >
                Reopen account
              </Button>
            ) : (
              <ConfirmAction
                trigger={<Button variant="outline">Close account</Button>}
                title={`Close ${a.name}?`}
                confirmLabel="Close account"
                onConfirm={() => save.mutateAsync({ closed: true })}
              >
                It keeps its history and stays at its last balance. You can
                reopen it later.
              </ConfirmAction>
            )}
          </>
        ) : undefined
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="account-name">
            {a.manual ? "Name" : "Display name"}
          </FieldLabel>
          <Input
            id="account-name"
            value={name}
            maxLength={60}
            placeholder={a.label}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = name.trim()
              if (next === shown) return
              if (a.manual && !next) return setName(shown)
              save.mutate({ displayName: next || null })
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </Field>
        {a.manual ? (
          <Field>
            <FieldLabel htmlFor="account-type">Type</FieldLabel>
            <Choice
              id="account-type"
              className="w-full"
              value={a.manualType ?? "other"}
              onChange={(v) => save.mutate({ type: v as ManualType })}
              options={MANUAL_TYPES}
            />
          </Field>
        ) : null}
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="account-networth">Count in net worth</FieldLabel>
          <Switch
            id="account-networth"
            checked={!a.excludeNetWorth}
            onCheckedChange={(on) => save.mutate({ excludeNetWorth: !on })}
          />
        </Field>
        <Field orientation="horizontal" className="justify-between">
          <span className="flex items-center gap-0.5">
            <FieldLabel htmlFor="account-hidden">Hide from lists</FieldLabel>
            <InfoTip label="About hiding">
              Its balance and transactions still count everywhere.
            </InfoTip>
          </span>
          <Switch
            id="account-hidden"
            checked={a.hidden}
            onCheckedChange={(on) => save.mutate({ hidden: on })}
          />
        </Field>
      </FieldGroup>
    </SectionCard>
  )
}

/** Facts about the account; a manual one shows its kind and state instead of bank fields. */
export function AccountDetails({
  a,
  holdings,
  closedAt,
}: {
  a: Account
  holdings: number
  closedAt: string | null
}) {
  const kind = a.manual
    ? (MANUAL_TYPES.find((t) => t.value === a.manualType)?.label ?? "Other")
    : accountGroup(a).label
  return (
    <SectionCard title="Details" fill>
      <DetailList>
        <DetailRow label="Institution">
          {a.manual ? "Added by hand" : a.institution}
        </DetailRow>
        <DetailRow label="Type">
          {a.manual ? kind : sentenceCase(a.subtype ?? a.type)}
        </DetailRow>
        {a.manual ? null : (
          <>
            <DetailRow label="Bank name">
              {a.officialName ?? <Unavailable />}
            </DetailRow>
            <DetailRow label="Number">
              {a.mask ? `••${a.mask}` : <Unavailable />}
            </DetailRow>
          </>
        )}
        <DetailRow label="Currency">{a.currency}</DetailRow>
        {a.limitCents != null ? (
          <DetailRow label="Credit limit">{money(a.limitCents)}</DetailRow>
        ) : null}
        <DetailRow label="In net worth">
          {a.excludeNetWorth ? "No" : "Yes"}
        </DetailRow>
        {closedAt ? (
          <DetailRow label="Closed">{fullDate(closedAt)}</DetailRow>
        ) : null}
        {holdings ? <DetailRow label="Holdings">{holdings}</DetailRow> : null}
      </DetailList>
    </SectionCard>
  )
}
