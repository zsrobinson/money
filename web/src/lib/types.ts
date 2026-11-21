export type Range = "1m" | "3m" | "6m" | "ytd" | "1y" | "all"
export type Group = "income" | "expense" | "transfer"

export type Source = {
  id: string
  institution: string
  kind: string
  status: string
  lastSuccessAt: string | null
  dataKinds: string[]
  accounts: number
  syncRequestedAt: string | null
}
export type Settings = {
  defaultRange: Range
  weekStartsOn: "sunday" | "monday"
  showPending: boolean
  reviewNewTransactions: boolean
  budgetRollover: Record<string, string>
}
export type Meta = {
  today: string
  earliest: string
  generatedAt: string | null
  schemaVersion: number
  stale: boolean
  sources: Source[]
  settings: Settings
  unreviewed: number
}
export type Category = {
  code: string
  label: string
  group: Group
  parent: string | null
  custom: boolean
  hidden: boolean
  transactions: number
}
export type Tag = {
  id: string
  name: string
  hue: string | null
  transactions: number
}

export type Account = {
  id: string
  name: string
  label: string
  officialName: string | null
  institution: string
  sourceId: string
  sourceStatus: string
  type: string
  subtype: string | null
  mask: string | null
  currency: string
  balanceCents: number | null
  availableCents: number | null
  limitCents: number | null
  liability: boolean
  availability: string
  scope: string
  hidden: boolean
  excludeNetWorth: boolean
}
export type AccountListItem = Account & {
  spark: (number | null)[]
  changeCents: number | null
}

export type Txn = {
  id: string
  date: string
  amountCents: number
  currency: string
  merchant: string | null
  description: string | null
  category: string
  accountId: string
  accountName: string
  pending: boolean
  hidden: boolean
  reviewed: boolean
  note: string | null
  tags: string[]
  split: boolean
  flowKind: string
  transferPairId: string | null
}
export type Split = {
  idx: number
  amountCents: number
  category: string
  note: string | null
}
export type RuleMatch = {
  merchant_contains?: string
  merchant_equals?: string
  account_id?: string
  category?: string
  direction?: "in" | "out"
  amount_min_cents?: number
  amount_max_cents?: number
}
export type RuleAction = {
  category?: string
  merchant?: string
  hide?: boolean
  mark_reviewed?: boolean
  tags?: string[]
}
export type Rule = {
  id: string
  position: number
  enabled: boolean
  match: RuleMatch
  action: RuleAction
  createdAt: string
  matches?: number
}
export type TxnDetail = Txn & {
  authorizedDate: string | null
  paymentChannel: string | null
  website: string | null
  merchantKey: string
  original: {
    date: string
    category: string
    merchant: string | null
    detailedCategory: string | null
  }
  overridden: {
    category: boolean
    merchant: boolean
    hidden: boolean
    reviewed: boolean
    date: boolean
  }
  splits: Split[]
  rules: { id: string; match: RuleMatch; action: RuleAction }[]
  pair: Txn | null
  similar: Txn[]
}
export type TxnPage = {
  total: number
  inflowCents: number
  outflowCents: number
  offset: number
  items: Txn[]
  dayTotals: Record<string, number>
}
export type NetPoint = {
  date: string
  assets: number
  liabilities: number
  net: number
}
export type Recurring = {
  key: string
  merchant: string
  kind: "expense" | "income"
  cadence: string
  cadenceSource: "detected" | "provider" | "manual"
  amountCents: number
  lastDate: string
  nextDate: string
  count: number
  status: "active" | "inactive" | "ignored" | "cancelled"
  accountId: string
  category: string
  categoryLabel?: string
  accountName?: string
  history?: { date: string; amountCents: number; id: string }[]
}
export type BudgetRow = {
  code: string
  label: string
  parent: string | null
  custom: boolean
  /** This category's own amount, the one you edit. */
  budgetCents: number | null
  /** Own amount plus the categories inside it; null when none has one. */
  totalBudgetCents: number | null
  source: "month" | "default" | null
  defaultCents: number | null
  rollover: boolean
  rolloverCents: number
  spentCents: number
  lastMonthCents: number
  averageCents: number
}
/** Over top-level categories only, so each dollar counts once. */
export type BudgetTotals = {
  budgetedCents: number
  spentCents: number
  unbudgetedCents: number
}
export type Summary = {
  range: Range
  netWorth: {
    cents: number
    assetsCents: number
    liabilitiesCents: number
    changeCents: number
    series: NetPoint[]
  }
  month: {
    month: string
    incomeCents: number
    spendingCents: number
    lastMonthSpendingCents: number
    lastMonthSameDayCents: number
    pace: { day: number; thisMonth: number | null; lastMonth: number | null }[]
    top: { code: string; label: string; cents: number }[]
  }
  budget: BudgetTotals & {
    month: string
    over: number
    rows: (BudgetRow & { children: BudgetRow[] })[]
  }
  upcoming: Recurring[]
  accounts: Account[]
  recent: Txn[]
  unreviewed: number
}
export type MonthFlow = {
  month: string
  incomeCents: number
  spendingCents: number
  netCents: number
  byCategory: Record<string, number>
}
export type Goal = {
  id: string
  name: string
  kind: "save" | "payoff"
  targetCents: number
  targetDate: string | null
  accountIds: string[]
  accountNames: string[]
  currentCents: number
  progress: number
  monthlyChangeCents: number
  projectedDate: string | null
  onTrack: boolean | null
  series: { date: string; cents: number }[]
  createdAt: string
}
export type Holding = {
  accountId: string
  accountName: string
  securityId: string
  ticker: string | null
  name: string
  type: string
  quantity: number
  price: number | null
  valueCents: number
  costBasisCents: number | null
  gainCents: number | null
}
