import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@zsrobinson/shell/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zsrobinson/shell/ui/popover"
import { PlusIcon, XIcon } from "lucide-react"
import { TagBadge } from "@/components/transactions"
import { tagsQuery } from "@/lib/queries"

/** A transaction's tags as badges that remove with ×, and a picker to add more. */
export function TagEditor({
  value,
  onChange,
}: {
  value: string[]
  onChange: (tags: string[]) => void
}) {
  const tags = useQuery(tagsQuery).data ?? []
  const [open, setOpen] = useState(false)
  const applied = tags.filter((t) => value.includes(t.id))
  const rest = tags.filter((t) => !value.includes(t.id))
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {applied.map((t) => (
        <span key={t.id} className="flex items-center">
          <TagBadge
            name={t.name}
            hue={t.hue}
            className="h-6 rounded-r-none border-r-0 pr-1 text-xs text-foreground"
          />
          <button
            type="button"
            aria-label={`Remove tag ${t.name}`}
            className="flex h-6 items-center rounded-r-full border border-l-0 px-1 text-muted-foreground hover:text-foreground"
            onClick={() => onChange(value.filter((x) => x !== t.id))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      {tags.length ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button size="xs" variant="ghost" disabled={!rest.length} />
            }
          >
            <PlusIcon data-icon="inline-start" />
            Tag
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60 gap-0 p-0">
            <Command>
              <CommandInput
                placeholder="Search tags"
                className="text-base md:text-sm"
              />
              <CommandList>
                <CommandEmpty>No tag matches</CommandEmpty>
                <CommandGroup>
                  {rest.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={t.name}
                      onSelect={() => {
                        onChange([...value, t.id])
                        setOpen(false)
                      }}
                    >
                      <TagBadge
                        name={t.name}
                        hue={t.hue}
                        className="border-0"
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="text-sm text-muted-foreground">
          No tags yet.{" "}
          <Link
            to="/categories"
            search={{ tab: "tags" }}
            className="underline underline-offset-4"
          >
            Create tags
          </Link>
        </span>
      )}
    </div>
  )
}
