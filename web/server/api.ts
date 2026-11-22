import { Hono } from "hono"
import { DetailUnavailable } from "./detail.ts"
import type { Model } from "./model.ts"
import { registerAccounts } from "./api/accounts.ts"
import { registerBudgets } from "./api/budgets.ts"
import { registerCategories } from "./api/categories.ts"
import { createContext, HttpError } from "./api/context.ts"
import { registerGoals } from "./api/goals.ts"
import { registerInvestments } from "./api/investments.ts"
import { registerMeta } from "./api/meta.ts"
import { registerRecurring } from "./api/recurring.ts"
import { registerReports } from "./api/reports.ts"
import { registerRules } from "./api/rules.ts"
import { registerSummary } from "./api/summary.ts"
import { registerTransactions } from "./api/transactions.ts"

export { HttpError }

/** JSON API mounted under /api on the Access-guarded shell server. */
export function createApi(model: Model) {
  const api = new Hono()
  const ctx = createContext(model)
  api.onError((error, c) => {
    if (error instanceof HttpError)
      return c.json({ error: error.message }, error.status)
    if (error instanceof DetailUnavailable)
      return c.json({ error: error.message }, 503)
    throw error
  })
  registerMeta(api, ctx)
  registerCategories(api, ctx)
  registerSummary(api, ctx)
  registerAccounts(api, ctx)
  registerTransactions(api, ctx)
  registerRules(api, ctx)
  registerReports(api, ctx)
  registerBudgets(api, ctx)
  registerRecurring(api, ctx)
  registerInvestments(api, ctx)
  registerGoals(api, ctx)
  return api
}
