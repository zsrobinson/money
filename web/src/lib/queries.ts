import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import type { AppLink } from "@zsrobinson/shell"
import { getJson, query, type Params } from "./api"
import type {
  Account,
  AccountListItem,
  BudgetRow,
  Category,
  Goal,
  Holding,
  Meta,
  MonthFlow,
  Range,
  Recurring,
  Rule,
  Settings,
  Summary,
  Tag,
  Txn,
  TxnDetail,
  TxnPage,
} from "./types"

const q = <T>(key: unknown[], url: string, extra: object = {}) =>
  queryOptions<T>({
    queryKey: key,
    queryFn: ({ signal }) => getJson<T>(url, signal),
    ...extra,
  })

export const sessionQuery = q<{ email: string; services: AppLink[] }>(
  ["session"],
  "/api/session",
  {
    retry: false,
    staleTime: Infinity,
  }
)
export const metaQuery = q<Meta>(["money", "meta"], "/api/meta", {
  staleTime: 30_000,
})
export const categoriesQuery = q<Category[]>(
  ["money", "categories"],
  "/api/categories",
  { staleTime: 60_000 }
)
export const tagsQuery = q<Tag[]>(["money", "tags"], "/api/tags", {
  staleTime: 60_000,
})
export const summaryQuery = (range?: Range) =>
  q<Summary>(["money", "summary", range], `/api/summary${query({ range })}`, {
    placeholderData: keepPreviousData,
  })
export const accountsQuery = q<AccountListItem[]>(
  ["money", "accounts"],
  "/api/accounts"
)
export const accountQuery = (id: string, range?: Range) =>
  q<{
    account: Account
    range: Range
    series: { date: string; cents: number | null }[]
    estimated: boolean
    flows: MonthFlow[]
    transactions: number
    recent: Txn[]
    holdings: number
  }>(
    ["money", "account", id, range],
    `/api/accounts/${encodeURIComponent(id)}${query({ range })}`,
    {
      placeholderData: keepPreviousData,
    }
  )
export const transactionsQuery = (params: Params) =>
  q<TxnPage>(
    ["money", "transactions", params],
    `/api/transactions${query(params)}`,
    {
      placeholderData: keepPreviousData,
    }
  )
export const transactionQuery = (id: string) =>
  q<TxnDetail>(
    ["money", "transaction", id],
    `/api/transactions/${encodeURIComponent(id)}`
  )
export const rulesQuery = q<Rule[]>(["money", "rules"], "/api/rules")
export const ruleQuery = (id: string) =>
  q<Rule>(["money", "rule", id], `/api/rules/${encodeURIComponent(id)}`)
export const cashflowQuery = (months: number, month?: string) =>
  q<{
    months: MonthFlow[]
    selected: string
    incomeSources: { key: string; name: string; cents: number; count: number }[]
    income: {
      code: string
      label: string
      parent: string | null
      cents: number
      count: number
    }[]
    spending: {
      code: string
      label: string
      parent: string | null
      cents: number
      count: number
    }[]
  }>(
    ["money", "cashflow", months, month],
    `/api/cashflow${query({ months, month })}`,
    {
      placeholderData: keepPreviousData,
    }
  )
export type CategoryReport = {
  range: Range
  from: string
  to: string
  months: string[]
  totalCents: number
  rows: {
    code: string
    label: string
    parent: string | null
    cents: number
    count: number
    previousCents: number
    monthly: (number | null)[]
  }[]
}
export const categoryReportQuery = (range: Range) =>
  q<CategoryReport>(
    ["money", "reports", "categories", range],
    `/api/reports/categories${query({ range })}`,
    {
      placeholderData: keepPreviousData,
    }
  )
export const categoryDetailQuery = (code: string) =>
  q<{
    category: {
      code: string
      label: string
      group: string
      parent: string | null
      custom: boolean
    }
    monthly: { month: string; cents: number }[]
    averageCents: number
    totalCents: number
    merchants: { key: string; name: string; cents: number; count: number }[]
    children: { code: string; label: string; cents: number }[]
  }>(
    ["money", "reports", "category", code],
    `/api/reports/categories/${encodeURIComponent(code)}`
  )
export const merchantReportQuery = (range: Range) =>
  q<{
    range: Range
    from: string
    rows: {
      key: string
      name: string
      cents: number
      count: number
      last: string
      category: string
      categoryLabel: string
      averageCents: number
    }[]
  }>(
    ["money", "reports", "merchants", range],
    `/api/reports/merchants${query({ range })}`,
    {
      placeholderData: keepPreviousData,
    }
  )
export const merchantDetailQuery = (key: string) =>
  q<{
    key: string
    name: string
    category: string
    categoryLabel: string
    totalCents: number
    count: number
    first: string
    last: string
    monthly: { month: string; cents: number; count: number }[]
    recurring: {
      cadence: string
      amountCents: number
      nextDate: string
      status: string
    } | null
    transactions: Txn[]
  }>(
    ["money", "reports", "merchant", key],
    `/api/reports/merchants/${encodeURIComponent(key)}`
  )
export const trendsQuery = (months: number) =>
  q<{
    months: string[]
    categories: { code: string; label: string }[]
    rows: Record<string, number | string>[]
  }>(
    ["money", "reports", "trends", months],
    `/api/reports/trends${query({ months })}`,
    {
      placeholderData: keepPreviousData,
    }
  )
export const budgetsQuery = (month?: string) =>
  q<{
    month: string
    current: string
    elapsed: number
    incomeCents: number
    rows: BudgetRow[]
  }>(["money", "budgets", month], `/api/budgets${query({ month })}`, {
    placeholderData: keepPreviousData,
  })
export const recurringQuery = q<{
  today: string
  monthlyExpenseCents: number
  monthlyIncomeCents: number
  items: Recurring[]
}>(["money", "recurring"], "/api/recurring")
export const investmentsQuery = (range: Range) =>
  q<{
    range: Range
    totalCents: number
    costBasisCents: number
    gainCents: number
    allocation: { type: string; cents: number }[]
    series: { date: string; cents: number }[]
    accounts: (Account & { holdingsCents: number })[]
    holdings: Holding[]
  }>(["money", "investments", range], `/api/investments${query({ range })}`, {
    placeholderData: keepPreviousData,
  })
export const goalsQuery = q<Goal[]>(["money", "goals"], "/api/goals")
export const goalQuery = (id: string) =>
  q<Goal>(["money", "goal", id], `/api/goals/${encodeURIComponent(id)}`)
export const settingsQuery = q<Settings>(["money", "settings"], "/api/settings")
export const searchQuery = (term: string) =>
  q<{
    accounts: { id: string; name: string; institution: string }[]
    merchants: { key: string; name: string; count: number }[]
    categories: { code: string; label: string }[]
  }>(["money", "search", term], `/api/search${query({ q: term })}`, {
    enabled: term.trim().length > 1,
    staleTime: 30_000,
  })
