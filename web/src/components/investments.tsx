import { Fragment, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { cn } from "@zsrobinson/shell"
import { Amount } from "@/components/money"
import { assetType, money, percentChange, titleCase } from "@/lib/format"
import type { InvestmentTxn } from "@/lib/types"

export type HoldingRow = {
  securityId: string
  ticker: string | null
  name: string
  type: string
  quantity: number
  valueCents: number
  costBasisCents: number | null
  gainCents: number | null
  /** Accounts holding it, for combined positions. */
  accounts?: number
  price?: number | null
}

export const isCash = (h: { type: string }) => h.type.toLowerCase() === "cash"

export const quantity = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 3 })

/** Gain on cost with its percentage, signed and coloured. */
export function Gain({
  gainCents,
  costBasisCents,
  className,
}: {
  gainCents: number | null
  costBasisCents: number | null
  className?: string
}) {
  if (gainCents == null || !costBasisCents)
    return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn("flex flex-col items-end", className)}>
      <Amount cents={gainCents} tone="signed" whole />
      <span className="text-xs text-muted-foreground tabular-nums">
        {percentChange(gainCents / costBasisCents, 1)}
      </span>
    </span>
  )
}

const COLUMNS =
  "grid-cols-[minmax(0,1fr)_6rem_5.5rem] @xl:grid-cols-[minmax(0,1fr)_6rem_7rem_6.5rem] @3xl:grid-cols-[minmax(0,1fr)_6rem_6rem_7rem_6.5rem]"

/**
 * Holdings as rows that open each security's page: name, quantity and price
 * as room allows, then value and gain. Optional group headers (an account
 * with its total) sit between runs of rows.
 */
export function HoldingRows({
  groups,
}: {
  groups: { key: string; heading?: ReactNode; rows: HoldingRow[] }[]
}) {
  return (
    <div className="@container border-t">
      <div
        className={cn(
          "grid items-center gap-x-3 border-b px-4 py-1.5 text-xs font-medium text-muted-foreground sm:px-5",
          COLUMNS
        )}
      >
        <span>Holding</span>
        <span className="hidden text-right @xl:block">Quantity</span>
        <span className="hidden text-right @3xl:block">Price</span>
        <span className="text-right">Value</span>
        <span className="text-right">Gain</span>
      </div>
      <ul className="flex flex-col">
        {groups.map((g) => (
          <Fragment key={g.key}>
            {g.heading ? (
              <li className="flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground sm:px-5">
                {g.heading}
              </li>
            ) : null}
            {g.rows.map((h) => {
              const cash = isCash(h)
              const price =
                h.price ?? (h.quantity ? h.valueCents / 100 / h.quantity : null)
              return (
                <li
                  key={`${g.key}-${h.securityId}`}
                  className="border-b border-border/70 last:border-b-0"
                >
                  <Link
                    to="/investments/$security"
                    params={{ security: h.securityId }}
                    className={cn(
                      "grid min-h-13 items-center gap-x-3 px-4 py-2 outline-none hover:bg-muted/60 focus-visible:bg-muted sm:px-5",
                      COLUMNS
                    )}
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {h.ticker ?? h.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {h.ticker ? h.name : assetType(h.type)}
                        {h.accounts && h.accounts > 1
                          ? ` · ${h.accounts} accounts`
                          : ""}
                      </span>
                    </span>
                    <span className="hidden text-right text-sm tabular-nums @xl:block">
                      {cash ? "—" : quantity(h.quantity)}
                    </span>
                    <span className="hidden text-right text-sm tabular-nums @3xl:block">
                      {cash || price == null
                        ? "—"
                        : money(Math.round(price * 100))}
                    </span>
                    <span className="text-right text-sm font-medium tabular-nums">
                      {money(h.valueCents, { whole: true })}
                    </span>
                    <span className="text-right text-sm">
                      {cash ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Gain
                          gainCents={h.gainCents}
                          costBasisCents={h.costBasisCents}
                        />
                      )}
                    </span>
                  </Link>
                </li>
              )
            })}
          </Fragment>
        ))}
      </ul>
    </div>
  )
}

const SUBTYPE: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
  "qualified dividend": "Dividend",
  "non-qualified dividend": "Dividend",
  interest: "Interest",
  contribution: "Contribution",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  fee: "Fee",
  "management fee": "Fee",
  reinvestment: "Reinvested",
  "dividend reinvestment": "Reinvested",
  split: "Split",
  transfer: "Transfer",
}

/** "Buy", "Dividend", "Reinvested" from the bank's type and subtype. */
export const investmentTxnLabel = (
  t: Pick<InvestmentTxn, "type" | "subtype">
) =>
  SUBTYPE[(t.subtype ?? "").toLowerCase()] ??
  SUBTYPE[t.type.toLowerCase()] ??
  titleCase(t.subtype ?? t.type)
