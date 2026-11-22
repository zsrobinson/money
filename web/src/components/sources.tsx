import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import { ArrowRightIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import { Loading } from "@/components/money"
import { errorMessage, send } from "@/lib/api"
import { pluralize, syncLabel } from "@/lib/format"
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

/** What the owner does when a connection keeps failing. */
export const RECONNECT_GUIDANCE =
  "Reconnect from the server with the link helper in update mode."

/** Each connection with its sync state, and what to do when one fails. */
export function SourceList() {
  const meta = useQuery(metaQuery)
  if (!meta.data) return <Loading rows={3} className="px-5 pb-5" />
  return (
    <ul className="flex flex-col divide-y divide-border/70 border-t">
      {meta.data.sources.map((s) => (
        <SourceRow key={s.id} source={s} />
      ))}
    </ul>
  )
}

function SourceRow({ source: s }: { source: Source }) {
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
      {/* On a phone the status drops below the full name. */}
      <span className="flex min-w-0 flex-1 basis-full flex-col sm:basis-auto">
        <span className="text-sm font-medium">{s.institution}</span>
        <span className="text-xs text-muted-foreground">
          {pluralize(s.accounts, "account")} ·{" "}
          {s.lastSuccessAt
            ? `last synced ${when(s.lastSuccessAt)}`
            : "never synced"}
          {s.syncRequestedAt
            ? ` · sync requested ${when(s.syncRequestedAt)}`
            : ""}
        </span>
        {s.status === "error" ? (
          <span className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            {RECONNECT_GUIDANCE}
          </span>
        ) : null}
      </span>
      <Badge variant={VARIANT[s.status] ?? "destructive"}>
        {syncLabel(s.status)}
      </Badge>
    </li>
  )
}

/**
 * Ask for an early sync of every connection. The sync service picks the
 * request up on its next one-minute check; requests are rate limited.
 */
export function SyncNow() {
  const client = useQueryClient()
  const sync = useMutation({
    mutationFn: () => send<{ requestedAt: string }>("POST", "/api/sync"),
    onSettled: () => client.invalidateQueries({ queryKey: ["money", "meta"] }),
  })
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2">
      <span
        role="status"
        className={
          sync.isError
            ? "mr-auto text-sm text-destructive"
            : "mr-auto text-sm text-muted-foreground"
        }
      >
        {sync.isSuccess
          ? "Requested · runs within a minute"
          : sync.isError
            ? errorMessage(sync.error)
            : null}
      </span>
      <Button
        variant="outline"
        disabled={sync.isPending}
        onClick={() => sync.mutate()}
      >
        <RefreshCwIcon
          data-icon="inline-start"
          className={sync.isPending ? "animate-spin" : undefined}
        />
        Sync now
      </Button>
    </div>
  )
}

/** One line for pages that only need to know whether a connection needs attention. */
export function ConnectionStatusLine() {
  const meta = useQuery(metaQuery)
  const failing = (meta.data?.sources ?? []).filter(
    (s) => s.status === "stale" || s.status === "error"
  )
  if (!failing.length) return null
  return (
    <Link
      to="/settings"
      hash="connections"
      className="flex w-fit items-center gap-1.5 rounded-xl text-sm text-destructive underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <TriangleAlertIcon className="size-4 shrink-0" />
      {failing.length === 1
        ? "1 connection needs attention"
        : `${failing.length} connections need attention`}
      <ArrowRightIcon className="size-4 shrink-0" />
    </Link>
  )
}
