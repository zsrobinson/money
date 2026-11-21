import { useQuery } from "@tanstack/react-query"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { RefreshCwIcon } from "lucide-react"
import { Loading } from "@/components/money"
import { pluralize, syncLabel } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { metaQuery } from "@/lib/queries"
import type { Source } from "@/lib/types"

const VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  healthy: "secondary",
  stale: "destructive",
  error: "destructive",
  disabled: "outline",
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

/** Each connection with its sync state; behind or failing ones can ask for an early sync. */
export function SourceList() {
  const meta = useQuery(metaQuery)
  if (!meta.data) return <Loading rows={3} className="px-5 pb-5" />
  return (
    <ul className="flex flex-col divide-y divide-border/70">
      {meta.data.sources.map((s) => (
        <SourceRow key={s.id} source={s} />
      ))}
    </ul>
  )
}

function SourceRow({ source: s }: { source: Source }) {
  const sync = useSend("POST", `/api/sources/${s.id}/sync`, {
    success: `Sync requested for ${s.institution}`,
  })
  const needsSync = s.status === "stale" || s.status === "error"
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2">
      {/* On a phone the status and action drop below the full name. */}
      <span className="flex min-w-0 flex-1 basis-full flex-col sm:basis-auto">
        <span className="text-sm font-medium">{s.institution}</span>
        {/* Wraps on a phone so "last synced" is never cut off. */}
        <span className="text-xs text-muted-foreground">
          {pluralize(s.accounts, "account")} ·{" "}
          {s.lastSuccessAt
            ? `last synced ${when(s.lastSuccessAt)}`
            : "never synced"}
          {s.syncRequestedAt
            ? ` · sync requested ${when(s.syncRequestedAt)}`
            : ""}
        </span>
      </span>
      <Badge variant={VARIANT[s.status] ?? "destructive"}>
        {syncLabel(s.status)}
      </Badge>
      {needsSync ? (
        <Button
          size="sm"
          variant="outline"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Sync now
        </Button>
      ) : null}
    </li>
  )
}
