import { keepPreviousData, queryOptions } from "@tanstack/react-query"
import type { AppLink } from "@zsrobinson/shell"
import { getJson, query, type Params } from "./api"
import type {
  Account,
  AccountListItem,
  BuiltReport,
  Budgets,
  CashFlow,
  Category,
  Goal,
  Holding,
  InvestmentTxn,
  Liability,
  Meta,
  MonthFlow,
  Neighbors,
  NetWorthByType,
  Performance,
  Position,
  Range,
  RecurringDetail,
  RecurringList,
  Rule,
  SavedView,
  SearchResults,
  Settings,
  Source,
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
    flows: (MonthFlow & { transferInCents: number; transferOutCents: number })[]
    transactions: number
    recent: Txn[]
    holdings: number
    balances: { date: string; cents: number }[]
    closedAt: string | null
    liability: Liability | null
    source: Source | null
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
export const cashflowQuery = (params: Params) =>
  q<CashFlow>(["money", "cashflow", params], `/api/cashflow${query(params)}`, {
    placeholderData: keepPreviousData,
  })
export const reportBuildQuery = (params: Params) =>
  q<BuiltReport>(
    ["money", "reports", "build", params],
    `/api/reports/build${query(params)}`,
    { placeholderData: keepPreviousData }
  )
export const networthQuery = (range?: Range) =>
  q<NetWorthByType>(
    ["money", "networth", range],
    `/api/networth${query({ range })}`,
    { placeholderData: keepPreviousData }
  )
export const neighborsQuery = (id: string, params: Params) =>
  q<Neighbors>(
    ["money", "neighbors", id, params],
    `/api/transactions/${encodeURIComponent(id)}/neighbors${query(params)}`
  )
export const viewsQuery = q<SavedView[]>(["money", "views"], "/api/views", {
  staleTime: 60_000,
})
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
    monthly: number[]
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
    to: string
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
export const budgetsQuery = (month?: string) =>
  q<Budgets>(["money", "budgets", month], `/api/budgets${query({ month })}`, {
    placeholderData: keepPreviousData,
  })
export const recurringQuery = (month?: string) =>
  q<RecurringList>(
    ["money", "recurring", month],
    `/api/recurring${query({ month })}`,
    { placeholderData: keepPreviousData }
  )
export const recurringDetailQuery = (key: string) =>
  q<RecurringDetail>(
    ["money", "recurring-item", key],
    `/api/recurring/${encodeURIComponent(key)}`
  )
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
    positions: Position[]
    performance: Performance | null
  }>(["money", "investments", range], `/api/investments${query({ range })}`, {
    placeholderData: keepPreviousData,
  })
export const holdingQuery = (security: string) =>
  q<{
    securityId: string
    ticker: string | null
    name: string
    type: string
    price: number | null
    quantity: number
    valueCents: number
    costBasisCents: number | null
    gainCents: number | null
    accounts: {
      accountId: string
      accountName: string
      quantity: number
      valueCents: number
      costBasisCents: number | null
    }[]
    series: { date: string; cents: number }[]
    transactions: InvestmentTxn[]
  }>(
    ["money", "holding", security],
    `/api/investments/holdings/${encodeURIComponent(security)}`
  )
export const goalsQuery = q<Goal[]>(["money", "goals"], "/api/goals")
export const goalQuery = (id: string) =>
  q<Goal>(["money", "goal", id], `/api/goals/${encodeURIComponent(id)}`)
export const settingsQuery = q<Settings>(["money", "settings"], "/api/settings")
export const searchQuery = (term: string) =>
  q<SearchResults>(
    ["money", "search", term],
    `/api/search${query({ q: term })}`,
    {
      enabled: term.trim().length > 1,
      staleTime: 30_000,
    }
  )
