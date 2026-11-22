import { useQuery } from "@tanstack/react-query"
import { cn } from "@zsrobinson/shell"
import {
  ArrowLeftRightIcon,
  BabyIcon,
  BanknoteIcon,
  BookOpenIcon,
  BriefcaseIcon,
  BusIcon,
  CarIcon,
  CircleDashedIcon,
  CircleIcon,
  ClapperboardIcon,
  CoffeeIcon,
  DumbbellIcon,
  FolderIcon,
  FuelIcon,
  GiftIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  HeartPulseIcon,
  HouseIcon,
  LandmarkIcon,
  LaptopIcon,
  type LucideIcon,
  MusicIcon,
  PawPrintIcon,
  PiggyBankIcon,
  PlaneIcon,
  ReceiptIcon,
  RepeatIcon,
  ShieldIcon,
  ShirtIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  SmartphoneIcon,
  SparklesIcon,
  TrainIcon,
  TrendingUpIcon,
  UsersIcon,
  UtensilsIcon,
  WifiIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react"
import { categoriesQuery } from "@/lib/queries"

/** The icons a category can use, by stored name. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsIcon,
  coffee: CoffeeIcon,
  "shopping-cart": ShoppingCartIcon,
  "shopping-bag": ShoppingBagIcon,
  shirt: ShirtIcon,
  car: CarIcon,
  fuel: FuelIcon,
  bus: BusIcon,
  train: TrainIcon,
  plane: PlaneIcon,
  house: HouseIcon,
  zap: ZapIcon,
  wifi: WifiIcon,
  smartphone: SmartphoneIcon,
  wrench: WrenchIcon,
  "heart-pulse": HeartPulseIcon,
  dumbbell: DumbbellIcon,
  sparkles: SparklesIcon,
  clapperboard: ClapperboardIcon,
  music: MusicIcon,
  "book-open": BookOpenIcon,
  "graduation-cap": GraduationCapIcon,
  baby: BabyIcon,
  "paw-print": PawPrintIcon,
  gift: GiftIcon,
  "heart-handshake": HeartHandshakeIcon,
  shield: ShieldIcon,
  laptop: LaptopIcon,
  briefcase: BriefcaseIcon,
  banknote: BanknoteIcon,
  "piggy-bank": PiggyBankIcon,
  "trending-up": TrendingUpIcon,
  landmark: LandmarkIcon,
  receipt: ReceiptIcon,
  "arrow-left-right": ArrowLeftRightIcon,
  repeat: RepeatIcon,
  users: UsersIcon,
  folder: FolderIcon,
  "circle-dashed": CircleDashedIcon,
  circle: CircleIcon,
}

/** The sixteen category colours; see --cat-* in styles.css. */
export const CATEGORY_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "magenta",
  "red-soft",
  "orange-soft",
  "yellow-soft",
  "green-soft",
  "cyan-soft",
  "blue-soft",
  "purple-soft",
  "magenta-soft",
] as const

/** A CSS colour for a stored colour key; unknown keys are neutral. */
export const categoryColor = (key: string | null | undefined) =>
  key && (CATEGORY_COLORS as readonly string[]).includes(key)
    ? `var(--cat-${key})`
    : "var(--cat-none)"

/** A category's icon on a tint of its colour. */
export function CategoryIcon({
  icon,
  color,
  className,
  size = "md",
}: {
  icon: string | null | undefined
  color: string | null | undefined
  className?: string
  size?: "sm" | "md"
}) {
  const Icon = CATEGORY_ICONS[icon ?? ""] ?? CircleIcon
  const c = categoryColor(color)
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
        className
      )}
      style={{
        color: c,
        backgroundColor: `color-mix(in oklab, ${c} 16%, transparent)`,
      }}
    >
      <Icon />
    </span>
  )
}

/** A small dot in a category's colour, for legends and lists. */
export function CategoryDot({
  color,
  className,
}: {
  color: string | null | undefined
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: categoryColor(color) }}
    />
  )
}

/** Look up a category's label, colour and icon by code. */
export function useCategories() {
  const q = useQuery(categoriesQuery)
  const map = new Map((q.data ?? []).map((c) => [c.code, c]))
  return {
    list: q.data ?? [],
    get: (code: string) => map.get(code),
    label: (code: string) => map.get(code)?.label ?? code,
    color: (code: string) => categoryColor(map.get(code)?.color),
  }
}
