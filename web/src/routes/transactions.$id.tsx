import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  Page,
  PageActions,
  PageGrid,
  PageHeader,
  PageMeta,
  PageStack,
  PageTitle,
} from "@zsrobinson/shell"
import {
  DetailList,
  DetailRow,
  Unavailable,
} from "@zsrobinson/shell/blocks/detail-list"
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
import { Textarea } from "@zsrobinson/shell/ui/textarea"
import { Toggle } from "@zsrobinson/shell/ui/toggle"
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  ListFilterIcon,
  PlusIcon,
  SplitIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react"
import {
  Amount,
  CardLink,
  Loading,
  MerchantMark,
  SectionCard,
} from "@/components/money"
import { DatePicker } from "@/components/pickers"
import { describeRule } from "@/components/rules"
import {
  CategorySelect,
  TxnRows,
  txnName,
  useCategoryLabels,
} from "@/components/transactions"
import { usePageTitle } from "@/lib/crumb"
import { longDate, money, sentenceCase, shortDate } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { categoriesQuery, tagsQuery, transactionQuery } from "@/lib/queries"
import type { Split, TxnDetail } from "@/lib/types"

export const Route = createFileRoute("/transactions/$id")({
  staticData: { crumbs: [{ label: "Transactions", to: "/transactions" }] },
  component: TransactionPage,
})

function TransactionPage() {
  const { id } = Route.useParams()
  const txn = useQuery(transactionQuery(id))
  usePageTitle(txn.data ? txnName(txn.data) : undefined, true)
  if (txn.isError)
    return (
      <Page>
        <QueryError
          title="This transaction failed to load"
          error={txn.error}
          onRetry={() => txn.refetch()}
        />
      </Page>
    )
  if (!txn.data)
    return (
      <Page>
        <Loading rows={8} />
      </Page>
    )
  return <TransactionView key={txn.data.id} t={txn.data} />
}

/** What this transaction is, in words a person would use. */
function kindOf(t: TxnDetail) {
  if (t.flowKind === "bank_transfer") return "Transfer between accounts"
  if (t.flowKind === "peer_payment")
    return t.amountCents > 0 ? "Payment received" : "Payment sent"
  if (t.amountCents > 0)
    return t.original.category === "income" ? "Income" : "Refund or credit"
  return t.paymentChannel === "online"
    ? "Online purchase"
    : t.paymentChannel === "in store"
      ? "In-store purchase"
      : "Purchase"
}

function SaveState({
  pending,
  saved,
  failed,
}: {
  pending: boolean
  saved: boolean
  failed: boolean
}) {
  return (
    <span
      role="status"
      className={
        failed ? "text-xs text-negative" : "text-xs text-muted-foreground"
      }
    >
      {pending ? "Saving…" : failed ? "Not saved" : saved ? "Saved" : null}
    </span>
  )
}

function TransactionView({ t }: { t: TxnDetail }) {
  const categories = useQuery(categoriesQuery)
  const tags = useQuery(tagsQuery)
  const label = useCategoryLabels()
  const patch = useSend<Record<string, unknown>>(
    "PATCH",
    `/api/transactions/${t.id}`
  )
  const [splitting, setSplitting] = useState(false)
  const [merchant, setMerchant] = useState(t.merchant ?? "")
  const [note, setNote] = useState(t.note ?? "")
  const saveMerchant = () => {
    const next = merchant.trim()
    if (next === (t.merchant ?? "")) return
    patch.mutate({
      merchant: next && next !== t.original.merchant ? next : null,
    })
  }
  return (
    <Page>
      <PageHeader>
        <div className="flex min-w-0 items-center gap-3">
          <MerchantMark
            name={txnName(t)}
            className="size-10 bg-card text-sm ring-1 ring-foreground/10"
          />
          <div className="flex min-w-0 flex-col">
            <PageTitle className="truncate">{txnName(t)}</PageTitle>
            <PageMeta>
              <span>{longDate(t.date)}</span>
              <Link
                to="/accounts/$id"
                params={{ id: t.accountId }}
                className="underline-offset-4 hover:underline"
              >
                {t.accountName}
              </Link>
              {t.pending ? <Badge variant="outline">Pending</Badge> : null}
              {t.hidden ? <Badge variant="secondary">Hidden</Badge> : null}
            </PageMeta>
          </div>
        </div>
        <PageActions>
          <Button
            size="sm"
            variant={t.reviewed ? "outline" : "default"}
            disabled={patch.isPending}
            onClick={() => patch.mutate({ reviewed: !t.reviewed })}
          >
            {t.reviewed ? (
              <UndoIcon data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            {t.reviewed ? "Mark not reviewed" : "Mark reviewed"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={patch.isPending}
            onClick={() => patch.mutate({ hidden: !t.hidden })}
          >
            {t.hidden ? (
              <EyeIcon data-icon="inline-start" />
            ) : (
              <EyeOffIcon data-icon="inline-start" />
            )}
            {t.hidden ? "Show in totals" : "Hide from totals"}
          </Button>
        </PageActions>
      </PageHeader>
      <PageGrid layout="wide">
        <PageStack>
          <SectionCard
            title="Details"
            action={
              <SaveState
                pending={patch.isPending}
                saved={patch.isSuccess}
                failed={patch.isError}
              />
            }
          >
            <Amount
              cents={t.amountCents}
              currency={t.currency}
              className="mb-5 block text-3xl font-semibold tracking-tight"
            />
            <FieldGroup className="@container">
              <Field>
                <FieldLabel htmlFor="txn-category">Category</FieldLabel>
                {t.splits.length ? (
                  <a
                    href="#split"
                    className="flex h-8 items-center gap-2 rounded-2xl bg-input/50 px-3 text-sm underline-offset-4 hover:underline"
                  >
                    <SplitIcon className="size-4 text-muted-foreground" />
                    Split · {t.splits.length} categories
                  </a>
                ) : (
                  <div className="flex gap-2">
                    <CategorySelect
                      id="txn-category"
                      categories={categories.data ?? []}
                      value={t.category}
                      disabled={patch.isPending}
                      onChange={(code) =>
                        patch.mutate({
                          category:
                            code === t.original.category &&
                            !t.rules.some((r) => r.action.category)
                              ? null
                              : code,
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setSplitting(true)}
                    >
                      <SplitIcon data-icon="inline-start" />
                      Split
                    </Button>
                  </div>
                )}
                {!t.splits.length && t.overridden.category ? (
                  <FieldDescription>
                    Originally {label(t.original.category)}.{" "}
                    <button
                      type="button"
                      className="underline underline-offset-4"
                      onClick={() => patch.mutate({ category: null })}
                    >
                      Restore
                    </button>
                  </FieldDescription>
                ) : null}
              </Field>
              <div className="grid gap-4 @lg:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="txn-merchant">Merchant</FieldLabel>
                  <Input
                    id="txn-merchant"
                    value={merchant}
                    placeholder={t.description ?? "Merchant name"}
                    onChange={(e) => setMerchant(e.target.value)}
                    onBlur={saveMerchant}
                    onKeyDown={(e) =>
                      e.key === "Enter" && e.currentTarget.blur()
                    }
                  />
                  {t.overridden.merchant && t.original.merchant ? (
                    <FieldDescription>
                      Originally {t.original.merchant}.
                    </FieldDescription>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="txn-date">Date</FieldLabel>
                  <DatePicker
                    id="txn-date"
                    value={t.date}
                    clearable={false}
                    onChange={(date) =>
                      date &&
                      patch.mutate({
                        date: date === t.original.date ? null : date,
                      })
                    }
                  />
                  {t.overridden.date ? (
                    <FieldDescription>
                      Bank date {shortDate(t.original.date)}.{" "}
                      <button
                        type="button"
                        className="underline underline-offset-4"
                        onClick={() => patch.mutate({ date: null })}
                      >
                        Restore
                      </button>
                    </FieldDescription>
                  ) : null}
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="txn-note">Note</FieldLabel>
                <Textarea
                  id="txn-note"
                  value={note}
                  rows={2}
                  placeholder="Add a note"
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={() =>
                    note.trim() !== (t.note ?? "") &&
                    patch.mutate({ note: note.trim() || null })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>Tags</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {(tags.data ?? []).map((tag) => (
                    <Toggle
                      key={tag.id}
                      size="sm"
                      variant="outline"
                      pressed={t.tags.includes(tag.id)}
                      onPressedChange={(next) =>
                        patch.mutate({
                          tags: next
                            ? [...t.tags, tag.id]
                            : t.tags.filter((x) => x !== tag.id),
                        })
                      }
                    >
                      {tag.name}
                    </Toggle>
                  ))}
                  {!tags.data?.length ? (
                    <span className="text-sm text-muted-foreground">
                      No tags yet.{" "}
                      <Link
                        to="/settings"
                        hash="tags"
                        className="underline underline-offset-4"
                      >
                        Create tags
                      </Link>
                    </span>
                  ) : null}
                </div>
              </Field>
            </FieldGroup>
          </SectionCard>
        </PageStack>
        <PageStack>
          <SectionCard title="From the bank">
            <DetailList>
              <DetailRow label="Posted">{shortDate(t.original.date)}</DetailRow>
              <DetailRow label="Authorized">
                {t.authorizedDate ? (
                  shortDate(t.authorizedDate)
                ) : (
                  <Unavailable />
                )}
              </DetailRow>
              <DetailRow label="Description">
                <span className="truncate">
                  {t.description ?? <Unavailable />}
                </span>
              </DetailRow>
              <DetailRow label="Category">
                {label(t.original.category)}
              </DetailRow>
              <DetailRow label="Channel">
                {t.paymentChannel ? (
                  sentenceCase(t.paymentChannel)
                ) : (
                  <Unavailable />
                )}
              </DetailRow>
              <DetailRow label="Type">{kindOf(t)}</DetailRow>
            </DetailList>
          </SectionCard>
          {t.splits.length || splitting ? (
            <SplitEditor
              t={t}
              editing={splitting}
              onEditingChange={setSplitting}
            />
          ) : null}
          {t.pair ? (
            <SectionCard title="Matching transfer" flush>
              <TxnRows items={[t.pair]} />
            </SectionCard>
          ) : null}
          <SectionCard
            title="Rules"
            action={
              <Button
                size="sm"
                variant="outline"
                render={
                  <Link
                    to="/rules/new"
                    search={{
                      merchant:
                        t.original.merchant ?? t.description ?? undefined,
                      category: t.category,
                      account: undefined,
                    }}
                  />
                }
                nativeButton={false}
              >
                <ListFilterIcon data-icon="inline-start" />
                Create rule
              </Button>
            }
          >
            {t.rules.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {t.rules.map((r) => (
                  <li key={r.id}>
                    <Link
                      to="/rules/$id"
                      params={{ id: r.id }}
                      className="underline-offset-4 hover:underline"
                    >
                      {describeRule(r, label)}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No rules apply.</p>
            )}
          </SectionCard>
        </PageStack>
      </PageGrid>
      {t.similar.length ? (
        <SectionCard
          title="Other transactions here"
          flush
          action={
            <CardLink
              to="/reports/merchants/$key"
              params={{ key: t.merchantKey }}
            >
              Merchant report
            </CardLink>
          }
        >
          <TxnRows items={t.similar} showAccount={false} />
        </SectionCard>
      ) : null}
    </Page>
  )
}

type Draft = { amount: string; category: string; note: string }

function SplitEditor({
  t,
  editing,
  onEditingChange: setEditing,
}: {
  t: TxnDetail
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const categories = useQuery(categoriesQuery)
  const sign = Math.sign(t.amountCents) || -1
  const fromSplits = (s: Split[]): Draft[] =>
    s.map((x) => ({
      amount: (Math.abs(x.amountCents) / 100).toFixed(2),
      category: x.category,
      note: x.note ?? "",
    }))
  const half = Math.floor(Math.abs(t.amountCents) / 2)
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    t.splits.length
      ? fromSplits(t.splits)
      : [
          {
            amount: ((Math.abs(t.amountCents) - half) / 100).toFixed(2),
            category: t.category,
            note: "",
          },
          { amount: (half / 100).toFixed(2), category: t.category, note: "" },
        ]
  )
  const save = useSend<{
    splits: { amountCents: number; category: string; note: string | null }[]
  }>("PUT", `/api/transactions/${t.id}/splits`, {
    success: (_, v) => (v.splits.length ? "Split saved" : "Split removed"),
    onSuccess: () => setEditing(false),
  })
  const cents = drafts.map((d) => Math.round(Number(d.amount || 0) * 100))
  const remaining = Math.abs(t.amountCents) - cents.reduce((a, b) => a + b, 0)
  const valid =
    drafts.length >= 2 &&
    remaining === 0 &&
    cents.every((c) => c > 0) &&
    drafts.every((d) => d.category)
  const start = () => {
    setDrafts(fromSplits(t.splits))
    setEditing(true)
  }
  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, j) => (i === j ? { ...d, ...patch } : d)))
  return (
    <div id="split" className="scroll-mt-16">
      {!editing ? (
        <SectionCard
          title="Split"
          action={
            <Button size="sm" variant="outline" onClick={start}>
              Edit split
            </Button>
          }
        >
          {t.splits.length ? (
            <DetailList>
              {t.splits.map((s) => (
                <DetailRow
                  key={s.idx}
                  label={
                    <span className="flex flex-col">
                      <span className="text-foreground">
                        {categories.data?.find((c) => c.code === s.category)
                          ?.label ?? s.category}
                      </span>
                      {s.note ? (
                        <span className="text-xs">{s.note}</span>
                      ) : null}
                    </span>
                  }
                >
                  <Amount cents={s.amountCents} />
                </DetailRow>
              ))}
            </DetailList>
          ) : null}
        </SectionCard>
      ) : (
        <SectionCard title="Split">
          <div className="flex flex-col gap-3">
            {drafts.map((d, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)_auto]"
              >
                <CategorySelect
                  aria-label={`Part ${i + 1} category`}
                  categories={categories.data ?? []}
                  value={d.category}
                  onChange={(category) => update(i, { category })}
                />
                <Input
                  aria-label={`Part ${i + 1} amount`}
                  inputMode="decimal"
                  value={d.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                  className="text-right tabular-nums"
                />
                <Input
                  aria-label={`Part ${i + 1} note`}
                  placeholder="Note"
                  value={d.note}
                  onChange={(e) => update(i, { note: e.target.value })}
                  className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove part ${i + 1}`}
                  disabled={drafts.length <= 2}
                  onClick={() =>
                    setDrafts((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDrafts((prev) => [
                    ...prev,
                    {
                      amount: (Math.max(0, remaining) / 100).toFixed(2),
                      category: t.category,
                      note: "",
                    },
                  ])
                }
              >
                <PlusIcon data-icon="inline-start" />
                Add part
              </Button>
              <span
                className={
                  remaining === 0 ? "text-muted-foreground" : "text-negative"
                }
              >
                {remaining === 0
                  ? "Parts add up"
                  : `${money(Math.abs(remaining))} ${remaining > 0 ? "left to assign" : "over"}`}
              </span>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {t.splits.length ? (
                <Button
                  variant="ghost"
                  className="mr-auto text-destructive"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ splits: [] })}
                >
                  Remove split
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                disabled={!valid || save.isPending}
                onClick={() =>
                  save.mutate({
                    splits: drafts.map((d, i) => ({
                      amountCents: sign * cents[i],
                      category: d.category,
                      note: d.note.trim() || null,
                    })),
                  })
                }
              >
                Save split
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  )
}
