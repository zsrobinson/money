import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { cn, Page, PageHeader, PageStack, PageTitle } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@zsrobinson/shell/ui/field"
import { Switch } from "@zsrobinson/shell/ui/switch"
import { ChevronRightIcon } from "lucide-react"
import { Amount, Loading, SectionCard } from "@/components/money"
import { Choice } from "@/components/pickers"
import { SourceList, SyncNow } from "@/components/sources"
import { accountGroup } from "@/components/accounts"
import { usePageTitle } from "@/lib/crumb"
import { fullDate, pluralize, RANGE_OPTIONS } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import {
  accountsQuery,
  categoriesQuery,
  rulesQuery,
  settingsQuery,
  tagsQuery,
} from "@/lib/queries"
import type { Settings } from "@/lib/types"

export const Route = createFileRoute("/settings")({
  staticData: { crumbs: [{ label: "Settings", to: "/settings" }] },
  component: SettingsPage,
})

const SECTIONS = [
  { id: "connections", label: "Connections" },
  { id: "preferences", label: "Preferences" },
  { id: "accounts", label: "Accounts" },
  { id: "setup", label: "Categories and rules" },
]

function SettingsPage() {
  usePageTitle("Settings")
  return (
    <Page>
      <PageHeader>
        <PageTitle>Settings</PageTitle>
      </PageHeader>
      <div className="grid items-start gap-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <SectionNav />
        <PageStack>
          <Section id="connections">
            <SectionCard title="Connections" flush footer={<SyncNow />}>
              <SourceList />
            </SectionCard>
          </Section>
          <Section id="preferences">
            <Preferences />
          </Section>
          <Section id="accounts">
            <Accounts />
          </Section>
          <Section id="setup">
            <SetupLinks />
          </Section>
        </PageStack>
      </div>
    </Page>
  )
}

/** Sections as a list beside the page, a row of links, or a menu on a phone. */
function SectionNav() {
  const [current, setCurrent] = useState(SECTIONS[0].id)
  const go = (id: string) => {
    setCurrent(id)
    document.getElementById(id)?.scrollIntoView({ block: "start" })
    history.replaceState(null, "", `#${id}`)
  }
  return (
    <>
      <Choice
        aria-label="Settings section"
        className="w-full sm:hidden"
        value={current}
        onChange={go}
        options={SECTIONS.map((x) => ({ value: x.id, label: x.label }))}
      />
      <nav
        aria-label="Settings sections"
        className="hidden gap-1 sm:flex lg:sticky lg:top-16 lg:flex-col"
      >
        {SECTIONS.map((x) => (
          <Button
            key={x.id}
            variant="ghost"
            size="sm"
            className="justify-start text-muted-foreground"
            render={<a href={`#${x.id}`} />}
            nativeButton={false}
          >
            {x.label}
          </Button>
        ))}
      </nav>
    </>
  )
}

const Section = ({ id, children }: { id: string; children: ReactNode }) => (
  <section id={id} className="scroll-mt-16">
    {children}
  </section>
)

function Preferences() {
  const settings = useQuery(settingsQuery)
  const save = useSend<Partial<Settings>>("PATCH", "/api/settings", {
    success: "Preferences saved",
  })
  const start = useSend("POST", "/api/review/start", {
    body: () => ({}),
    success: "Review now starts today",
  })
  const s = settings.data
  return (
    <SectionCard title="Preferences">
      {!s ? (
        <Loading rows={4} />
      ) : (
        <FieldGroup className="gap-5">
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="pref-range">Default chart range</FieldLabel>
            <Choice
              id="pref-range"
              className="w-40"
              align="end"
              value={s.defaultRange}
              onChange={(v) =>
                save.mutate({ defaultRange: v as Settings["defaultRange"] })
              }
              options={RANGE_OPTIONS.map((r) => ({
                value: r.value,
                label: r.label,
              }))}
            />
          </Field>
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="pref-week">Week starts on</FieldLabel>
            <Choice
              id="pref-week"
              className="w-40"
              align="end"
              value={s.weekStartsOn}
              onChange={(v) =>
                save.mutate({ weekStartsOn: v as Settings["weekStartsOn"] })
              }
              options={[
                { value: "monday", label: "Monday" },
                { value: "sunday", label: "Sunday" },
              ]}
            />
          </Field>
          <Field orientation="horizontal" className="justify-between">
            <FieldLabel htmlFor="pref-pending">
              Show pending transactions
            </FieldLabel>
            <Switch
              id="pref-pending"
              checked={s.showPending}
              onCheckedChange={(v) => save.mutate({ showPending: v })}
            />
          </Field>
          <FieldSeparator />
          <Field orientation="horizontal" className="justify-between">
            <FieldContent>
              <FieldLabel htmlFor="pref-review">
                Count new transactions for review
              </FieldLabel>
              {s.reviewNewTransactions && s.reviewSince ? (
                <FieldDescription>
                  Counting from {fullDate(s.reviewSince)}
                </FieldDescription>
              ) : null}
            </FieldContent>
            <Switch
              id="pref-review"
              checked={s.reviewNewTransactions}
              onCheckedChange={(v) => save.mutate({ reviewNewTransactions: v })}
            />
          </Field>
          {s.reviewNewTransactions ? (
            <div>
              <ConfirmAction
                trigger={
                  <Button variant="outline">Start review from today</Button>
                }
                title="Start review from today?"
                confirmLabel="Start from today"
                onConfirm={() => start.mutateAsync()}
              >
                Everything before today will stop counting as needing review.
              </ConfirmAction>
            </div>
          ) : null}
        </FieldGroup>
      )}
    </SectionCard>
  )
}

/** Read-only: each account's own page holds its settings. */
function Accounts() {
  const accounts = useQuery(accountsQuery)
  const list = accounts.data ?? []
  return (
    <SectionCard
      title="Accounts"
      flush
      action={
        <span className="text-sm text-muted-foreground tabular-nums">
          {pluralize(list.length, "account")}
        </span>
      }
    >
      {!accounts.data ? (
        <Loading rows={4} className="px-5 pb-5" />
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 border-t">
          {list.map((a) => (
            <li key={a.id}>
              <LinkRow
                to="/accounts/$id"
                params={{ id: a.id }}
                title={a.name}
                detail={[
                  a.manual ? "Manual" : a.institution,
                  accountGroup(a).label,
                  a.excludeNetWorth ? "Not in net worth" : null,
                  a.hidden ? "Hidden" : null,
                  a.availability !== "available" ? "Closed" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                value={
                  <Amount
                    cents={a.balanceCents}
                    currency={a.currency}
                    tone="plain"
                    className={cn(
                      "text-sm",
                      a.availability !== "available" && "text-muted-foreground"
                    )}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

function SetupLinks() {
  const categories = useQuery(categoriesQuery)
  const tags = useQuery(tagsQuery)
  const rules = useQuery(rulesQuery)
  const custom = (categories.data ?? []).filter((c) => c.custom).length
  return (
    <SectionCard title="Categories and rules" flush>
      <ul className="flex flex-col divide-y divide-border/70 border-t">
        <li>
          <LinkRow
            to="/categories"
            title="Categories"
            detail={
              categories.data
                ? `${pluralize(categories.data.filter((c) => !c.mergedInto).length, "category", "categories")} · ${custom} of your own`
                : undefined
            }
          />
        </li>
        <li>
          <LinkRow
            to="/categories"
            search={{ tab: "tags" }}
            title="Tags"
            detail={tags.data ? pluralize(tags.data.length, "tag") : undefined}
          />
        </li>
        <li>
          <LinkRow
            to="/rules"
            title="Rules"
            detail={
              rules.data ? pluralize(rules.data.length, "rule") : undefined
            }
          />
        </li>
      </ul>
    </SectionCard>
  )
}

function LinkRow({
  to,
  params,
  search,
  title,
  detail,
  value,
}: {
  to: string
  params?: Record<string, string>
  search?: Record<string, string>
  title: string
  detail?: string
  value?: ReactNode
}) {
  return (
    <Link
      to={to}
      params={params as never}
      search={search as never}
      className="flex min-h-14 items-center gap-3 px-5 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium break-words">{title}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {value}
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
