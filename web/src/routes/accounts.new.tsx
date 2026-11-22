import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { FormStack, Page, PageHeader, PageTitle } from "@zsrobinson/shell"
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
import { isDebt, MANUAL_TYPES, parseCents } from "@/components/accounts"
import { SectionCard } from "@/components/money"
import { Choice, DatePicker } from "@/components/pickers"
import { usePageTitle } from "@/lib/crumb"
import { useSend } from "@/lib/mutations"
import { metaQuery } from "@/lib/queries"
import type { ManualType } from "@/lib/types"

export const Route = createFileRoute("/accounts/new")({
  staticData: { crumbs: [{ label: "Accounts", to: "/accounts" }] },
  component: NewAccount,
})

type Body = {
  name: string
  type: ManualType
  balanceCents?: number
  date?: string
}

function NewAccount() {
  usePageTitle("Add account", true)
  const navigate = useNavigate()
  const today = useQuery(metaQuery).data?.today ?? ""
  const [name, setName] = useState("")
  const [type, setType] = useState<ManualType>("cash")
  const [balance, setBalance] = useState("")
  const [date, setDate] = useState("")
  const [tried, setTried] = useState(false)
  const create = useSend<Body, { id: string }>("POST", "/api/accounts", {
    success: (_, v) => `Added ${v.name}`,
    onSuccess: (r) =>
      void navigate({ to: "/accounts/$id", params: { id: r.id } }),
  })
  const cents = parseCents(balance)
  const errors = {
    name: !name.trim() ? "Name the account" : null,
    balance:
      balance.trim() && cents == null ? "Enter an amount, such as 1250" : null,
  }
  const debt = isDebt(type)
  const submit = () => {
    setTried(true)
    if (errors.name || errors.balance) return
    create.mutate({
      name: name.trim(),
      type,
      ...(cents != null
        ? { balanceCents: debt ? Math.abs(cents) : cents, date: date || today }
        : {}),
    })
  }
  return (
    <Page>
      <PageHeader>
        <PageTitle>Add account</PageTitle>
      </PageHeader>
      <FormStack>
        <SectionCard
          title="Manual account"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => void navigate({ to: "/accounts" })}
              >
                Cancel
              </Button>
              <Button disabled={create.isPending} onClick={submit}>
                Add account
              </Button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <FieldGroup className="@container">
              <div className="grid gap-4 @lg:grid-cols-2">
                <Field data-invalid={tried && !!errors.name}>
                  <FieldLabel htmlFor="account-name">Name</FieldLabel>
                  <Input
                    id="account-name"
                    autoFocus
                    value={name}
                    maxLength={60}
                    placeholder="Home, car, cash on hand"
                    aria-invalid={tried && !!errors.name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {tried && errors.name ? (
                    <FieldError>{errors.name}</FieldError>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="account-type">Type</FieldLabel>
                  <Choice
                    id="account-type"
                    className="w-full"
                    value={type}
                    onChange={(v) => setType(v as ManualType)}
                    options={MANUAL_TYPES}
                  />
                </Field>
                <Field data-invalid={tried && !!errors.balance}>
                  <FieldLabel htmlFor="account-balance">
                    {debt ? "Amount owed" : "Starting balance"}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>$</InputGroupAddon>
                    <InputGroupInput
                      id="account-balance"
                      inputMode="decimal"
                      placeholder="0"
                      value={balance}
                      aria-invalid={tried && !!errors.balance}
                      onChange={(e) => setBalance(e.target.value)}
                    />
                  </InputGroup>
                  {tried && errors.balance ? (
                    <FieldError>{errors.balance}</FieldError>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="account-date">As of</FieldLabel>
                  <DatePicker
                    id="account-date"
                    value={date || today}
                    clearable={false}
                    onChange={setDate}
                  />
                </Field>
              </div>
            </FieldGroup>
            <button type="submit" hidden />
          </form>
        </SectionCard>
      </FormStack>
    </Page>
  )
}
