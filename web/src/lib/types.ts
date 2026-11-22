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
  /** Transactions on or after this day count for review. */
  reviewSince: string | null
  budgetMode: "category" | "flex"
  budgetRollover: Record<string, string>
  syncRequests: Record<string, string>
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
  manualAccounts: number
}
export type BudgetKind = "fixed" | "flexible" | "non_monthly"
export type Category = {
  code: string
  label: string
  /** The built-in name before shortening or renaming. */
  fullLabel: string
  group: Group
  parent: string | null
  custom: boolean
  hidden: boolean
  icon: string
  color: string
  budgetKind: BudgetKind
  mergedInto: string | null
  children: number
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
  manual: boolean
  manualType: ManualType | null
}
export type ManualType =
  "cash" | "credit" | "loan" | "investment" | "property" | "vehicle" | "other"
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
  /** In the review queue: not reviewed and on or after the review start. */
  needsReview: boolean
  note: string | null
  tags: string[]
  split: boolean
  flowKind: string
  transferPairId: string | null
  manual: boolean
}
export type Split = {
  idx: number
  amountCents: number
  category: string
  note: string | null
}
export type RuleCondition = {
  merchant_contains?: string
  merchant_equals?: string
  merchant_starts_with?: string
  description_contains?: string
  account_id?: string
  category?: string
  flow_kind?: "activity" | "bank_transfer" | "peer_payment"
  direction?: "in" | "out"
  amount_min_cents?: number
  amount_max_cents?: number
  date_from?: string
  date_to?: string
}
export type RuleMatch = RuleCondition & { any?: RuleCondition[] }
export type RuleAction = {
  category?: string
  merchant?: string
  hide?: boolean
  mark_reviewed?: boolean
  tags?: string[]
  /** Percent in basis points (100% = 10000). */
  split?: { category: string; percent: number }[]
  mark_recurring?: boolean
}
export type Rule = {
  id: string
  position: number
  enabled: boolean
  match: RuleMatch
  action: RuleAction
  /** Only transactions dated on or after this; null for all history. */
  appliesFrom: string | null
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
  ruleSplit: boolean
  rules: { id: string; match: RuleMatch; action: RuleAction }[]
  pair: Txn | null
  similar: Txn[]
  merchantCount: number
  /** Same merchant in another category: "apply to all" candidates. */
  merchantOtherCategory: number
  recurringStatus: "active" | "ignored" | "cancelled" | null
}
export type Neighbors = {
  index: number
  total: number
  previous: string | null
  next: string | null
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
  /** Added by hand rather than found by detection. */
  manual: boolean
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
  group: Group
  icon: string
  color: string
  kind: BudgetKind
  /** This category's own amount, the one you edit. */
  budgetCents: number | null
  /** "month": only this month; "plan": this month and later. */
  source: "month" | "plan" | null
  /** Own amount plus the categories inside it; null when none has one. */
  totalBudgetCents: number | null
  /** Its children have amounts, so its total is read-only. */
  hasChildBudgets: boolean
  rollover: boolean
  rolloverCents: number
  /** Includes the categories inside it. */
  spentCents: number
  /** This category alone, without its children. */
  ownSpentCents: number
  lastMonthCents: number
  averageCents: number
}
/** Over top-level categories only, so each dollar counts once. */
export type BudgetTotals = {
  budgetedCents: number
  /** Spent in categories that have a budget. */
  spentCents: number
  /** Spent in categories without one. */
  unbudgetedCents: number
  totalSpentCents: number
  incomeCents: number
  plannedIncomeCents: number | null
  plannedExpenseCents: number
  goalsCents: number
  leftToBudgetCents: number | null
}
export type FlexiblePool = {
  budgetCents: number | null
  source: "month" | "plan" | null
  spentCents: number
  rolloverCents: number
  rollover: boolean
  averageCents: number
}
export type Budgets = {
  month: string
  current: string
  elapsed: number
  mode: "category" | "flex"
  expenses: BudgetRow[]
  income: BudgetRow[]
  flexible: FlexiblePool | null
  goals: { id: string; name: string; monthlyCents: number }[]
  totals: BudgetTotals
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
    flexible: FlexiblePool | null
    rows: (BudgetRow & { children: BudgetRow[] })[]
  }
  upcoming: Recurring[]
  accounts: Account[]
  recent: Txn[]
  unreviewed: number
  review: Txn[]
  goals: Goal[]
}
export type MonthFlow = {
  month: string
  incomeCents: number
  spendingCents: number
  netCents: number
  byCategory: Record<string, number>
}
export type GoalAllocation = {
  accountId: string
  accountName: string
  mode: "all" | "amount" | "percent"
  /** Cents for an amount; basis points for a share. */
  value: number | null
  /** What this account adds to the goal now. */
  cents: number
}
export type Goal = {
  id: string
  name: string
  kind: "save" | "payoff"
  targetCents: number
  targetDate: string | null
  monthlyCents: number | null
  allocations: GoalAllocation[]
  accountIds: string[]
  accountNames: string[]
  currentCents: number
  progress: number
  monthlyChangeCents: number
  neededMonthlyCents: number | null
  projectedDate: string | null
  onTrack: boolean | null
  overlaps: { accountId: string; accountName: string; goals: string[] }[]
  series?: { date: string; cents: number }[]
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

export type Position = {
  securityId: string
  ticker: string | null
  name: string
  type: string
  quantity: number
  valueCents: number
  costBasisCents: number | null
  gainCents: number | null
  accounts: number
}
export type Performance = {
  from: string
  startCents: number
  endCents: number
  contributionsCents: number
  incomeCents: number
  feesCents: number
  marketCents: number
  returnRate: number | null
}
export type InvestmentTxn = {
  id: string
  accountId: string
  accountName: string
  securityId: string | null
  date: string
  type: string
  subtype: string | null
  quantity: number
  price: number | null
  amountCents: number
  feesCents: number
}
export type Liability = {
  accountId: string
  kind: string
  lastStatementBalanceCents: number | null
  lastStatementDate: string | null
  minimumPaymentCents: number | null
  nextPaymentDueDate: string | null
  lastPaymentCents: number | null
  lastPaymentDate: string | null
  aprPercent: number | null
  isOverdue: boolean
}
export type CardBill = {
  accountId: string
  accountName: string
  kind: string
  dueDate: string
  statementCents: number | null
  minimumCents: number | null
  lastPaymentCents: number | null
  lastPaymentDate: string | null
  overdue: boolean
  paid: boolean
}
export type Occurrence = {
  date: string
  state: "paid" | "due" | "missed"
  amountCents: number
  txnId: string | null
  key: string
  merchant: string
  kind: "expense" | "income"
  category: string
}
export type RecurringList = {
  today: string
  month: string
  monthlyExpenseCents: number
  monthlyIncomeCents: number
  monthPaidCents: number
  monthDueCents: number
  calendar: Occurrence[]
  bills: CardBill[]
  items: Recurring[]
}
export type RecurringDetail = Recurring & {
  averageCents: number
  yearCents: number
  monthlyCents: number
  /** A hand edit exists; deleting it returns the item to detection. */
  edited: boolean
  missed: number
  upcoming: { date: string; amountCents: number }[]
  transactions: Txn[]
}
export type NetWorthGroup =
  "cash" | "investments" | "property" | "other" | "credit" | "loans"
export type NetWorthByType = {
  range: Range
  groups: NetWorthGroup[]
  series: (Record<NetWorthGroup, number> & { date: string; net: number })[]
  change: Partial<Record<NetWorthGroup, number>>
}
export type Measure = "spending" | "income" | "net"
export type GroupBy =
  "category" | "group" | "merchant" | "tag" | "account" | "none"
export type Interval = "week" | "month" | "quarter" | "year" | "total"
export type ReportSeries = {
  key: string
  label: string
  color: string | null
  icon: string | null
  parent: string | null
  totalCents: number
  count: number
  values: number[]
}
export type BuiltReport = {
  measure: Measure
  by: GroupBy
  interval: Interval
  from: string
  to: string
  buckets: { key: string; from: string; to: string }[]
  series: ReportSeries[]
  totalCents: number | null
  compare: {
    from: string
    to: string
    totalCents: number
    byKey: Record<string, number>
  } | null
}
export type CashFlowRow = {
  key: string
  label: string
  color: string | null
  icon: string | null
  parent: string | null
  cents: number
  count: number
}
export type CashFlowPeriod = {
  kind: "month" | "quarter" | "year" | "custom"
  key: string
  from: string
  to: string
  previous: string | null
  next: string | null
}
export type SankeyData = {
  nodes: { id: string; label: string; color: string | null; column: number }[]
  links: { source: string; target: string; value: number }[]
  incomeCents: number
  spendingCents: number
}
export type CashFlow = {
  months: MonthFlow[]
  period: CashFlowPeriod
  by: "category" | "group" | "merchant"
  incomeCents: number
  spendingCents: number
  netCents: number
  income: CashFlowRow[]
  spending: CashFlowRow[]
  sankey: SankeyData
}
export type SavedView = {
  id: string
  name: string
  search: Record<string, string>
}
export type SearchResults = {
  accounts: { id: string; name: string; institution: string }[]
  merchants: { key: string; name: string; count: number }[]
  categories: { code: string; label: string }[]
  transactions: Txn[]
}
