import { useState, type ReactElement } from "react"
import { cn } from "@zsrobinson/shell"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@zsrobinson/shell/ui/popover"
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  CategoryIcon,
  categoryColor,
} from "@/components/category-style"

/** "blue-soft" → "Soft blue", for labels on colour swatches. */
const colorName = (key: string) =>
  key.endsWith("-soft")
    ? `Soft ${key.replace("-soft", "")}`
    : key.charAt(0).toUpperCase() + key.slice(1)
const iconName = (key: string) =>
  (key.charAt(0).toUpperCase() + key.slice(1)).replaceAll("-", " ")

/**
 * A category's icon and colour, chosen from the fixed grid of icons and the
 * sixteen category colours. The trigger is the category's own icon.
 */
export function IconColorPicker({
  icon,
  color,
  onChange,
  label,
  size = "md",
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  icon: string
  color: string
  onChange: (next: { icon: string; color: string }) => void
  /** Names the trigger for assistive tech: "Icon and colour for Coffee". */
  label: string
  size?: "sm" | "md"
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Replace the default icon button. */
  trigger?: ReactElement
}) {
  const [uncontrolled, setUncontrolled] = useState(false)
  const open = controlledOpen ?? uncontrolled
  const setOpen = (next: boolean) => {
    setUncontrolled(next)
    onOpenChange?.(next)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          trigger ?? (
            <button
              type="button"
              aria-label={label}
              className="flex size-8 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            />
          )
        }
      >
        {trigger ? undefined : (
          <CategoryIcon
            icon={icon}
            color={color}
            size={size}
            className="transition-transform hover:scale-105"
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-w-[calc(100vw-2rem)] gap-3 p-3"
      >
        <div
          role="radiogroup"
          aria-label="Icon"
          className="grid grid-cols-8 gap-1"
        >
          {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={key === icon}
              aria-label={iconName(key)}
              title={iconName(key)}
              onClick={() => onChange({ icon: key, color })}
              className={cn(
                "flex size-8 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30 [&_svg]:size-4",
                key === icon && "ring-2 ring-foreground/70"
              )}
              style={{
                color: categoryColor(color),
                backgroundColor:
                  key === icon
                    ? `color-mix(in oklab, ${categoryColor(color)} 16%, transparent)`
                    : undefined,
              }}
            >
              <Icon />
            </button>
          ))}
        </div>
        <div className="border-t" />
        <div
          role="radiogroup"
          aria-label="Colour"
          className="grid grid-cols-8 gap-1"
        >
          {CATEGORY_COLORS.map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={key === color}
              aria-label={colorName(key)}
              title={colorName(key)}
              onClick={() => onChange({ icon, color: key })}
              className="flex size-8 items-center justify-center rounded-full outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <span
                aria-hidden
                className={cn(
                  "size-5 rounded-full",
                  key === color &&
                    "ring-2 ring-foreground/70 ring-offset-2 ring-offset-popover"
                )}
                style={{ backgroundColor: categoryColor(key) }}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
