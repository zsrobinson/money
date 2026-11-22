import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Page, PageHeader, PageTitle } from "@zsrobinson/shell"
import { Button } from "@zsrobinson/shell/ui/button"
import { Card, CardContent, CardFooter } from "@zsrobinson/shell/ui/card"
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
import { Textarea } from "@zsrobinson/shell/ui/textarea"
import { z } from "zod"
import { CategoryPicker } from "@/components/category-picker"
import { EmptyState, Loading, Segmented } from "@/components/money"
import { TagEditor } from "@/components/tag-editor"
import { Choice, DatePicker } from "@/components/pickers"
import { usePageTitle } from "@/lib/crumb"
import { useSend } from "@/lib/mutations"
import { accountsQuery, categoriesQuery, metaQuery } from "@/lib/queries"

export const Route = createFileRoute("/transactions/new")({
  validateSearch: z.object({ account: z.string().optional() }),
  staticData: {
    crumbs: [
      { label: "Transactions", to: "/transactions" },
      { label: "Add transaction", to: "/transactions/new" },
    ],
  },
  component: NewTransaction,
})

/** A transaction typed in by hand, for cash or an account with no feed. */
function NewTransaction() {
  usePageTitle("Add transaction")
  const s = Route.useSearch()
  const navigate = useNavigate()
  const meta = useQuery(metaQuery)
  const accounts = useQuery(accountsQuery)
  const categories = useQuery(categoriesQuery)
  const manual = (accounts.data ?? []).filter(
    (a) => a.manual && a.availability === "available"
  )
  const [account, setAccount] = useState(s.account ?? "")
  const [direction, setDirection] = useState<"out" | "in">("out")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState("")
  const [merchant, setMerchant] = useState("")
  const [category, setCategory] = useState("")
  const [note, setNote] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [tried, setTried] = useState(false)
  const create = useSend<Record<string, unknown>, { id: string }>(
    "POST",
    "/api/transactions",
    {
      success: "Transaction added",
      onSuccess: (r) =>
        void navigate({ to: "/transactions/$id", params: { id: r.id } }),
    }
  )
  const chosen = account || (manual.length === 1 ? manual[0].id : "")
  const cents = Math.round(Number(amount.replace(/[^0-9.]/g, "")) * 100)
  const errors = {
    account: !chosen ? "Choose an account" : null,
    amount: !cents ? "Enter an amount" : null,
    category: !category ? "Choose a category" : null,
  }
  const valid = !Object.values(errors).some(Boolean)
  const submit = () => {
    setTried(true)
    if (!valid) return
    create.mutate({
      accountId: chosen,
      date: date || meta.data?.today,
      amountCents: direction === "out" ? -cents : cents,
      merchant: merchant.trim() || null,
      category,
      note: note.trim() || null,
      tags,
    })
  }
  return (
    <Page>
      <PageHeader>
        <PageTitle>Add transaction</PageTitle>
      </PageHeader>
      {!accounts.data ? (
        <Loading rows={5} />
      ) : !manual.length ? (
        <Card>
          <EmptyState
            title="Add a manual account first"
            action={
              <Button render={<Link to="/accounts/new" />} nativeButton={false}>
                Add account
              </Button>
            }
          >
            Linked accounts bring in their own transactions. Keep cash or an
            account without a connection as a manual account, then add its
            transactions here.
          </EmptyState>
        </Card>
      ) : (
        <form
          className="max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Card>
            <CardContent>
              <FieldGroup className="@container">
                <Field data-invalid={tried && Boolean(errors.amount)}>
                  <FieldLabel htmlFor="new-amount">Amount</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Segmented
                      label="Money out or in"
                      value={direction}
                      onChange={setDirection}
                      options={[
                        { value: "out", label: "Spent" },
                        { value: "in", label: "Received" },
                      ]}
                    />
                    <InputGroup className="flex-1">
                      <InputGroupAddon>$</InputGroupAddon>
                      <InputGroupInput
                        id="new-amount"
                        autoFocus
                        inputMode="decimal"
                        placeholder="0.00"
                        className="text-right tabular-nums"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </InputGroup>
                  </div>
                  {tried && errors.amount ? (
                    <FieldError>{errors.amount}</FieldError>
                  ) : null}
                </Field>
                <div className="grid gap-4 @lg:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="new-merchant">Merchant</FieldLabel>
                    <Input
                      id="new-merchant"
                      placeholder="Where or who"
                      value={merchant}
                      onChange={(e) => setMerchant(e.target.value)}
                    />
                  </Field>
                  <Field data-invalid={tried && Boolean(errors.category)}>
                    <FieldLabel htmlFor="new-category">Category</FieldLabel>
                    <CategoryPicker
                      id="new-category"
                      label="Category"
                      categories={categories.data ?? []}
                      value={category}
                      onChange={setCategory}
                    />
                    {tried && errors.category ? (
                      <FieldError>{errors.category}</FieldError>
                    ) : null}
                  </Field>
                </div>
                <div className="grid gap-4 @lg:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="new-date">Date</FieldLabel>
                    <DatePicker
                      id="new-date"
                      value={date || meta.data?.today || ""}
                      clearable={false}
                      onChange={setDate}
                    />
                  </Field>
                  <Field data-invalid={tried && Boolean(errors.account)}>
                    <FieldLabel htmlFor="new-account">Account</FieldLabel>
                    <Choice
                      id="new-account"
                      value={chosen}
                      placeholder={
                        manual.length > 1 ? "Choose an account" : undefined
                      }
                      onChange={setAccount}
                      options={manual.map((a) => ({
                        value: a.id,
                        label: a.name,
                      }))}
                      className="w-full"
                    />
                    {tried && errors.account ? (
                      <FieldError>{errors.account}</FieldError>
                    ) : null}
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="new-note">Note</FieldLabel>
                  <Textarea
                    id="new-note"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel>Tags</FieldLabel>
                  <TagEditor value={tags} onChange={setTags} />
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-wrap justify-end gap-2 border-t">
              <Button
                type="button"
                variant="outline"
                render={<Link to="/transactions" />}
                nativeButton={false}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                Add transaction
              </Button>
            </CardFooter>
          </Card>
        </form>
      )}
    </Page>
  )
}
