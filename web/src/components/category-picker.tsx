import { useState, type ReactNode } from "react"
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
import { CategoryDot, CategoryIcon } from "@/components/category-style"
import type { Category } from "@/lib/types"

const GROUPS = [
  { label: "Spending", group: "expense" },
  { label: "Income", group: "income" },
  { label: "Transfers", group: "transfer" },
] as const

/** Top-level categories each followed by their children, by group. */
export function categoryTree(
  categories: Category[],
  value?: string,
  includeHidden = false
) {
  const visible = categories.filter(
    (c) => includeHidden || !c.hidden || c.code === value
  )
  return GROUPS.map((g) => ({
    ...g,
    items: visible
      .filter((c) => !c.parent && c.group === g.group)
      .flatMap((c) => [c, ...visible.filter((x) => x.parent === c.code)]),
  })).filter((g) => g.items.length)
}

/**
 * A searchable category list in a popover. `variant="chip"` is a compact
 * inline trigger for a table row; `"field"` looks like the other form
 * selects. `open`/`onOpenChange` let a keyboard shortcut open it.
 */
export function CategoryPicker({
  value,
  onChange,
  categories,
  variant = "field",
  placeholder = "Choose a category",
  label,
  className,
  disabled,
  includeHidden = false,
  open: openProp,
  onOpenChange,
  emptyOption,
  children,
  id,
}: {
  value: string
  onChange: (code: string) => void
  categories: Category[]
  variant?: "field" | "chip"
  placeholder?: string
  /** Accessible name for the trigger. */
  label: string
  className?: string
  disabled?: boolean
  includeHidden?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** A first option for "no category", such as "All categories". */
  emptyOption?: string
  /** Custom trigger content. */
  children?: ReactNode
  id?: string
}) {
  const [own, setOwn] = useState(false)
  const open = openProp ?? own
  const setOpen = (v: boolean) => {
    setOwn(v)
    onOpenChange?.(v)
  }
  const current = categories.find((c) => c.code === value)
  const pick = (code: string) => {
    setOpen(false)
    if (code !== value) onChange(code)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        id={id}
        aria-label={label}
        className={cn(
          variant === "chip"
            ? "-mx-2 flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 data-popup-open:bg-muted data-popup-open:text-foreground"
            : "flex h-8 w-full min-w-0 items-center justify-between gap-1.5 rounded-2xl border border-transparent bg-input/50 px-3 text-left text-base transition-[color,box-shadow] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
      >
        {children ?? (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              {current ? <CategoryDot color={current.color} /> : null}
              <span
                className={cn(
                  "truncate",
                  !current && variant === "field" && "text-muted-foreground"
                )}
              >
                {current?.label ?? emptyOption ?? placeholder}
              </span>
            </span>
            {variant === "field" ? (
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : null}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0"
      >
        <Command
          // Search the label, its parent and its group.
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase().trim())
              ? 1
              : 0
          }
        >
          <CommandInput
            placeholder="Search categories"
            className="text-base md:text-sm"
          />
          <CommandList>
            <CommandEmpty>No category matches</CommandEmpty>
            {emptyOption ? (
              <CommandGroup>
                <CommandItem
                  value={emptyOption}
                  data-checked={!value}
                  onSelect={() => pick("")}
                >
                  {emptyOption}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {categoryTree(categories, value, includeHidden).map((g) => (
              <CommandGroup key={g.group} heading={g.label}>
                {g.items.map((c) => {
                  const parent = c.parent
                    ? categories.find((x) => x.code === c.parent)
                    : undefined
                  return (
                    <CommandItem
                      key={c.code}
                      value={`${c.label} ${parent?.label ?? ""} ${g.label} ${c.code}`}
                      data-checked={c.code === value}
                      onSelect={() => pick(c.code)}
                      className={c.parent ? "pl-8" : undefined}
                    >
                      {c.parent ? (
                        <CategoryDot color={c.color} />
                      ) : (
                        <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                      )}
                      <span className="truncate">{c.label}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
