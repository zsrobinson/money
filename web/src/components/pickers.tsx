import { useState } from "react"
import { cn } from "@zsrobinson/shell"
import { Button } from "@zsrobinson/shell/ui/button"
import { Calendar } from "@zsrobinson/shell/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zsrobinson/shell/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@zsrobinson/shell/ui/select"
import { CalendarIcon, XIcon } from "lucide-react"
import { fullDate } from "@/lib/format"

export type ChoiceOption = {
  value: string
  label: string
  group?: string
  indent?: boolean
}

/**
 * The shell Select with labelled options. An empty string value stands for
 * "none" and shows the placeholder option's label.
 */
export function Choice({
  value,
  onChange,
  options,
  placeholder,
  size = "default",
  className,
  id,
  disabled,
  align = "start",
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: ChoiceOption[]
  /** Label for the empty value, listed first. */
  placeholder?: string
  size?: "sm" | "default"
  className?: string
  id?: string
  disabled?: boolean
  align?: "start" | "end"
  "aria-label"?: string
}) {
  const all =
    placeholder !== undefined
      ? [{ value: "", label: placeholder }, ...options]
      : options
  const items = Object.fromEntries(all.map((o) => [o.value, o.label]))
  const groups: { name?: string; options: ChoiceOption[] }[] = []
  for (const o of options) {
    const last = groups.at(-1)
    if (last && last.name === o.group) last.options.push(o)
    else groups.push({ name: o.group, options: [o] })
  }
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(v) => onChange((v as string | null) ?? "")}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={cn("min-w-0", className)}
      >
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent align={align}>
        {placeholder !== undefined ? (
          <>
            <SelectItem value="">{placeholder}</SelectItem>
            <SelectSeparator />
          </>
        ) : null}
        {groups.map((g, i) =>
          g.name ? (
            <SelectGroup key={`${g.name}-${i}`}>
              <SelectLabel>{g.name}</SelectLabel>
              {g.options.map((o) => (
                <SelectItem
                  key={o.value}
                  value={o.value}
                  className={o.indent ? "pl-6" : undefined}
                >
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : (
            g.options.map((o) => (
              <SelectItem
                key={o.value}
                value={o.value}
                className={o.indent ? "pl-6" : undefined}
              >
                {o.label}
              </SelectItem>
            ))
          )
        )}
      </SelectContent>
    </Select>
  )
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** A date chosen from the shell calendar in a popover; value is YYYY-MM-DD or "". */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  id,
  className,
  clearable = true,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  className?: string
  clearable?: boolean
  "aria-label"?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = value ? fromIso(value) : undefined
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              aria-label={ariaLabel}
              className={cn(
                "min-w-0 flex-1 justify-start font-normal",
                !value && "text-muted-foreground"
              )}
            />
          }
        >
          <CalendarIcon data-icon="inline-start" />
          <span className="truncate">
            {value ? fullDate(value) : placeholder}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            captionLayout="dropdown"
            onSelect={(d) => {
              onChange(d ? iso(d) : "")
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      {clearable && value ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Clear date"
          onClick={() => onChange("")}
        >
          <XIcon />
        </Button>
      ) : null}
    </div>
  )
}
