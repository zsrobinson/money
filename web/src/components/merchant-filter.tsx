import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@zsrobinson/shell"
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
import { ChevronDownIcon } from "lucide-react"
import { searchQuery } from "@/lib/queries"

/** Choose a merchant by name; results come from the server as you type. */
export function MerchantFilter({
  value,
  name,
  onChange,
  className,
}: {
  value: string | undefined
  name: string | undefined
  onChange: (key: string | undefined, name: string | undefined) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [term, setTerm] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setTerm(text), 200)
    return () => clearTimeout(id)
  }, [text])
  const results = useQuery({
    ...searchQuery(term),
    enabled: open && term.trim().length > 1,
  })
  const merchants = results.data?.merchants ?? []
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Merchant"
        className={cn(
          "flex h-8 min-w-0 items-center justify-between gap-1.5 rounded-2xl border border-transparent bg-input/50 px-3 text-left text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm",
          !value && "text-muted-foreground",
          className
        )}
      >
        <span className="truncate">
          {value ? (name ?? value) : "Any merchant"}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(18rem,calc(100vw-2rem))] gap-0 p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search merchants"
            className="text-base md:text-sm"
            value={text}
            onValueChange={setText}
          />
          <CommandList>
            {term.trim().length > 1 && !results.isFetching ? (
              <CommandEmpty>No merchant matches</CommandEmpty>
            ) : null}
            <CommandGroup>
              {value ? (
                <CommandItem
                  value="__any"
                  onSelect={() => {
                    onChange(undefined, undefined)
                    setOpen(false)
                  }}
                >
                  Any merchant
                </CommandItem>
              ) : null}
              {merchants.map((m) => (
                <CommandItem
                  key={m.key}
                  value={m.key}
                  data-checked={m.key === value}
                  onSelect={() => {
                    onChange(m.key, m.name)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {m.count}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {term.trim().length < 2 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                Type two or more letters
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
