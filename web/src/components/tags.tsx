import { useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { cn } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { Button } from "@zsrobinson/shell/ui/button"
import { DropdownMenuItem } from "@zsrobinson/shell/ui/dropdown-menu"
import { Input } from "@zsrobinson/shell/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zsrobinson/shell/ui/popover"
import { BanIcon, PaletteIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { RowMenu } from "@/components/categories"
import { EmptyState, Loading, SectionCard } from "@/components/money"
import { pluralize } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { tagsQuery } from "@/lib/queries"
import type { Tag } from "@/lib/types"

const HUES = [
  ["re", "red"],
  ["or", "orange"],
  ["ye", "yellow"],
  ["gr", "green"],
  ["cy", "cyan"],
  ["bl", "blue"],
  ["pu", "purple"],
  ["ma", "magenta"],
] as const
export const tagColor = (hue: string | null) => {
  const name = HUES.find(([h]) => h === hue)?.[1]
  return name ? `var(--flexoki-${name}-500)` : "var(--muted-foreground)"
}

/** The eight hue chips plus none; the trigger is the tag's own dot. */
function HuePicker({
  hue,
  onChange,
  label,
  open,
  onOpenChange,
}: {
  hue: string | null
  onChange: (hue: string | null) => void
  label: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="flex size-8 shrink-0 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
          />
        }
      >
        <span
          aria-hidden
          className="size-3 rounded-full"
          style={{ backgroundColor: tagColor(hue) }}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div role="radiogroup" aria-label="Colour" className="flex gap-1">
          <button
            type="button"
            role="radio"
            aria-checked={hue == null}
            aria-label="No colour"
            title="No colour"
            onClick={() => onChange(null)}
            className={cn(
              "flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30",
              hue == null && "ring-2 ring-foreground/70"
            )}
          >
            <BanIcon className="size-4" />
          </button>
          {HUES.map(([key, name]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={hue === key}
              aria-label={name}
              title={name.charAt(0).toUpperCase() + name.slice(1)}
              onClick={() => onChange(key)}
              className="flex size-8 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <span
                aria-hidden
                className={cn(
                  "size-5 rounded-full",
                  hue === key &&
                    "ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover"
                )}
                style={{ backgroundColor: tagColor(key) }}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function TagsCard({
  adding,
  setAdding,
}: {
  adding: boolean
  setAdding: (on: boolean) => void
}) {
  const tags = useQuery(tagsQuery)
  const list = tags.data ?? []
  return (
    <SectionCard
      title="Tags"
      flush
      action={
        list.length ? (
          <span className="text-sm text-muted-foreground tabular-nums">
            {pluralize(list.length, "tag")}
          </span>
        ) : null
      }
    >
      {!tags.data ? (
        <Loading rows={3} className="px-5 pb-5" />
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 border-t">
          {adding ? (
            <li>
              <NewTag onDone={() => setAdding(false)} />
            </li>
          ) : null}
          {list.map((t) => (
            <TagRow key={t.id} tag={t} />
          ))}
          {!list.length && !adding ? (
            <li>
              <EmptyState
                title="No tags yet"
                action={
                  <Button size="sm" onClick={() => setAdding(true)}>
                    New tag
                  </Button>
                }
              >
                Tags mark transactions across categories, such as reimbursable
                or a trip.
              </EmptyState>
            </li>
          ) : null}
        </ul>
      )}
    </SectionCard>
  )
}

function NewTag({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("")
  const [hue, setHue] = useState<string | null>("ye")
  const create = useSend<{ name: string; hue: string | null }>(
    "POST",
    "/api/tags",
    { success: (_, v) => `Added ${v.name}`, onSuccess: onDone }
  )
  return (
    <form
      className="flex flex-wrap items-center gap-2 py-2 pr-3 pl-3 sm:pr-4 sm:pl-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) create.mutate({ name: name.trim(), hue })
      }}
    >
      <HuePicker hue={hue} onChange={setHue} label="Tag colour" />
      <Input
        autoFocus
        aria-label="New tag name"
        placeholder="New tag"
        className="h-8 min-w-40 flex-1 sm:max-w-80"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
      />
      <span className="flex gap-2 max-sm:ml-auto">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          Add tag
        </Button>
      </span>
    </form>
  )
}

function TagRow({ tag: t }: { tag: Tag }) {
  const [renaming, setRenaming] = useState(false)
  const [picking, setPicking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(t.name)
  const awayRef = useRef(false)
  const patch = useSend<{ name?: string; hue?: string | null }>(
    "PATCH",
    `/api/tags/${t.id}`
  )
  const remove = useSend("DELETE", `/api/tags/${t.id}`, {
    success: `Deleted ${t.name}`,
  })
  const save = () => {
    const next = name.trim()
    if (next && next !== t.name) patch.mutate({ name: next })
    else setName(t.name)
    setRenaming(false)
  }
  return (
    <li className="flex min-h-14 items-center gap-2 py-2 pr-3 pl-3 sm:pr-4 sm:pl-4">
      <HuePicker
        hue={t.hue}
        label={`Colour for ${t.name}`}
        open={picking}
        onOpenChange={setPicking}
        onChange={(hue) => patch.mutate({ hue })}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        {renaming ? (
          <Input
            autoFocus
            aria-label={`Name for ${t.name}`}
            className="h-8 max-w-80"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save()
              if (e.key === "Escape") {
                setName(t.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <>
            <span className="text-sm font-medium break-words">{t.name}</span>
            <Link
              to="/transactions"
              search={{ tag: t.id }}
              className="w-fit text-xs text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline"
            >
              {pluralize(t.transactions, "transaction")}
            </Link>
          </>
        )}
      </span>
      <RowMenu label={t.name} awayRef={awayRef}>
        <DropdownMenuItem
          onClick={() => {
            awayRef.current = true
            setRenaming(true)
          }}
        >
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTimeout(() => setPicking(true), 0)}>
          <PaletteIcon />
          Change colour
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </RowMenu>
      <ConfirmAction
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${t.name}?`}
        confirmLabel="Delete tag"
        destructive
        onConfirm={() => remove.mutateAsync()}
      >
        It comes off {pluralize(t.transactions, "transaction")}, and rules that
        add it stop adding it.
      </ConfirmAction>
    </li>
  )
}
