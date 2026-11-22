import { useRef, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { cn } from "@zsrobinson/shell"
import { ConfirmAction } from "@zsrobinson/shell/blocks/confirm-action"
import { Badge } from "@zsrobinson/shell/ui/badge"
import { Button } from "@zsrobinson/shell/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@zsrobinson/shell/ui/dropdown-menu"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@zsrobinson/shell/ui/field"
import { Input } from "@zsrobinson/shell/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@zsrobinson/shell/ui/toggle-group"
import {
  CombineIcon,
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  FolderInputIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"
import { IconColorPicker } from "@/components/category-picker"
import { CategoryIcon } from "@/components/category-style"
import { SectionCard } from "@/components/money"
import { Choice, type ChoiceOption } from "@/components/pickers"
import { pluralize } from "@/lib/format"
import { useSend } from "@/lib/mutations"
import { rulesQuery } from "@/lib/queries"
import type { Category, Group } from "@/lib/types"

export const GROUPS: { group: Group; label: string }[] = [
  { group: "income", label: "Income" },
  { group: "expense", label: "Spending" },
  { group: "transfer", label: "Transfers" },
]
const groupLabel = (g: Group) => GROUPS.find((x) => x.group === g)!.label

/** What a row is doing besides showing itself: one at a time on the page. */
export type RowMode = {
  code: string
  kind: "rename" | "add" | "move" | "merge" | "delete" | "style"
} | null

type Tree = {
  active: Category[]
  merged: Category[]
  children: (code: string) => Category[]
  /** A parent's count includes the categories inside it. */
  count: (c: Category) => number
  get: (code: string) => Category | undefined
}

export function categoryTree(list: Category[]): Tree {
  const active = list.filter((c) => !c.mergedInto)
  const merged = list.filter((c) => c.mergedInto)
  const children = (code: string) => active.filter((c) => c.parent === code)
  const map = new Map(list.map((c) => [c.code, c]))
  return {
    active,
    merged,
    children,
    count: (c) =>
      c.transactions +
      (c.parent ? 0 : children(c.code).reduce((s, x) => s + x.transactions, 0)),
    get: (code) => map.get(code),
  }
}

/** Top-level categories as options, grouped Income, Spending, Transfers. */
function topOptions(tree: Tree, keep: (c: Category) => boolean) {
  return GROUPS.flatMap((g) =>
    tree.active
      .filter((c) => !c.parent && c.group === g.group && keep(c))
      .map((c) => ({ value: c.code, label: c.label, group: g.label }))
  )
}
/** Every category as an option, children indented under their parent. */
function allOptions(tree: Tree, keep: (c: Category) => boolean) {
  return GROUPS.flatMap((g) =>
    tree.active
      .filter((c) => !c.parent && c.group === g.group)
      .flatMap((c) => [c, ...tree.children(c.code)])
      .filter(keep)
      .map((c) => ({
        value: c.code,
        label: c.label,
        group: g.label,
        indent: Boolean(c.parent),
      }))
  )
}

type CreateBody = {
  label: string
  parent?: string | null
  group?: Group
  icon?: string | null
  color?: string | null
}
const useCreate = (onDone: () => void) =>
  useSend<CreateBody, { code: string }>("POST", "/api/categories", {
    success: (_, v) => `Added ${v.label}`,
    onSuccess: onDone,
  })

/**
 * The form at the top of the page for a new group (a top-level category of
 * your own) or a new category inside one.
 */
export function NewCategoryForm({
  kind,
  group: initialGroup = "expense",
  tree,
  onDone,
}: {
  kind: "group" | "category"
  group?: Group
  tree: Tree
  onDone: () => void
}) {
  const firstSpending =
    tree.active.find((c) => !c.parent && c.group === "expense")?.code ?? ""
  const [label, setLabel] = useState("")
  const [group, setGroup] = useState<Group>(initialGroup)
  const [parent, setParent] = useState(firstSpending)
  const [style, setStyle] = useState<{ icon: string; color: string } | null>(
    null
  )
  const [tried, setTried] = useState(false)
  const create = useCreate(onDone)
  const inside = tree.get(parent)
  // Until chosen, a new category takes its group's look.
  const shown =
    style ??
    (kind === "category" && inside
      ? { icon: inside.icon, color: inside.color }
      : { icon: "folder", color: "blue" })
  const error = !label.trim() ? "Name it" : null
  const submit = () => {
    setTried(true)
    if (error) return
    create.mutate({
      label: label.trim(),
      ...(kind === "group" ? { parent: null, group } : { parent }),
      // What you see is what is stored, even before choosing.
      icon: shown.icon,
      color: shown.color,
    })
  }
  return (
    <SectionCard
      title={kind === "group" ? "New group" : "New category"}
      footer={
        <>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={submit}>
            {kind === "group" ? "Add group" : "Add category"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <FieldGroup className="@container">
          <div className="grid gap-4 @lg:grid-cols-2">
            <Field data-invalid={tried && !!error}>
              <FieldLabel htmlFor="new-category-name">Name</FieldLabel>
              <div className="flex items-center gap-2">
                <IconColorPicker
                  label="Icon and colour"
                  icon={shown.icon}
                  color={shown.color}
                  onChange={setStyle}
                />
                <Input
                  id="new-category-name"
                  autoFocus
                  value={label}
                  placeholder={kind === "group" ? "Kids" : "Takeout"}
                  aria-invalid={tried && !!error}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              {tried && error ? <FieldError>{error}</FieldError> : null}
            </Field>
            {kind === "category" ? (
              <Field>
                <FieldLabel htmlFor="new-category-parent">Inside</FieldLabel>
                <Choice
                  id="new-category-parent"
                  className="w-full"
                  value={parent}
                  onChange={setParent}
                  options={topOptions(tree, () => true)}
                />
              </Field>
            ) : (
              <FieldSet>
                <FieldLegend variant="label">Type</FieldLegend>
                <ToggleGroup
                  variant="outline"
                  value={[group]}
                  onValueChange={(v) => v[0] && setGroup(v[0] as Group)}
                >
                  {GROUPS.map((g) => (
                    <ToggleGroupItem key={g.group} value={g.group}>
                      {g.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldSet>
            )}
          </div>
        </FieldGroup>
        <button type="submit" hidden />
      </form>
    </SectionCard>
  )
}

/** One card per group: each top-level category with its own beneath it. */
export function CategoryGroupCard({
  group,
  tree,
  mode,
  setMode,
  onNewGroup,
}: {
  group: Group
  tree: Tree
  mode: RowMode
  setMode: (m: RowMode) => void
  onNewGroup: () => void
}) {
  const tops = tree.active.filter((c) => !c.parent && c.group === group)
  return (
    <SectionCard
      title={groupLabel(group)}
      flush
      action={
        <Button variant="ghost" size="sm" onClick={onNewGroup}>
          <PlusIcon data-icon="inline-start" />
          Add group
        </Button>
      }
    >
      <ul className="flex flex-col border-t">
        {tops.map((c) => (
          <li
            key={c.code}
            className="border-b border-border/70 last:border-b-0"
          >
            <CategoryRow
              category={c}
              tree={tree}
              mode={mode}
              setMode={setMode}
            />
            {tree.children(c.code).length || mode?.code === c.code ? (
              <ul className="flex flex-col">
                {tree.children(c.code).map((x) => (
                  <li key={x.code} className="border-t border-border/50">
                    <CategoryRow
                      category={x}
                      tree={tree}
                      mode={mode}
                      setMode={setMode}
                    />
                  </li>
                ))}
                {mode?.code === c.code && mode.kind === "add" ? (
                  <li className="border-t border-border/50">
                    <AddInside parent={c} onDone={() => setMode(null)} />
                  </li>
                ) : null}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

function CategoryRow({
  category: c,
  tree,
  mode,
  setMode,
}: {
  category: Category
  tree: Tree
  mode: RowMode
  setMode: (m: RowMode) => void
}) {
  const mine = mode?.code === c.code ? mode.kind : null
  const patch = useSend<Record<string, unknown>>(
    "PATCH",
    `/api/categories/${c.code}`
  )
  const count = tree.count(c)
  const close = () => setMode(null)
  // Rename and add put focus in their own input, not back on the menu.
  const awayRef = useRef(false)
  const focusAway = (kind: "rename" | "add") => {
    awayRef.current = true
    setMode({ code: c.code, kind })
  }
  return (
    <>
      <div
        className={cn(
          "flex min-h-14 items-center gap-3 py-2 pr-3 sm:pr-4",
          c.parent ? "pl-11 sm:pl-13" : "pl-4 sm:pl-5"
        )}
      >
        <IconColorPicker
          label={`Icon and colour for ${c.label}`}
          icon={c.icon}
          color={c.color}
          size={c.parent ? "sm" : "md"}
          open={mine === "style"}
          onOpenChange={(open) =>
            setMode(open ? { code: c.code, kind: "style" } : null)
          }
          onChange={(next) => patch.mutate(next)}
        />
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            c.hidden && mine !== "rename" && "opacity-60"
          )}
        >
          {mine === "rename" ? (
            <RenameInput category={c} onDone={close} />
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span
                className={cn(
                  "text-sm break-words",
                  c.parent ? "" : "font-medium"
                )}
              >
                {c.label}
              </span>
              {c.hidden ? (
                <Badge variant="outline" className="font-normal">
                  <EyeOffIcon />
                  Hidden
                </Badge>
              ) : null}
            </span>
          )}
          {mine === "rename" ? null : (
            <Link
              to="/transactions"
              search={{ category: c.code }}
              className="w-fit text-xs text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline"
            >
              {pluralize(count, "transaction")}
            </Link>
          )}
        </div>
        <RowMenu label={c.label} awayRef={awayRef}>
          <DropdownMenuItem onClick={() => focusAway("rename")}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              // Opened after the menu has closed so focus lands in the picker.
              setTimeout(() => setMode({ code: c.code, kind: "style" }), 0)
            }
          >
            <PaletteIcon />
            Change icon and colour
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => patch.mutate({ hidden: !c.hidden })}>
            {c.hidden ? <EyeIcon /> : <EyeOffIcon />}
            {c.hidden ? "Show in lists" : "Hide from lists"}
          </DropdownMenuItem>
          {!c.parent ? (
            <DropdownMenuItem onClick={() => focusAway("add")}>
              <PlusIcon />
              Add category inside
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {c.custom ? (
            <DropdownMenuItem
              onClick={() => setMode({ code: c.code, kind: "move" })}
            >
              <FolderInputIcon />
              Move to…
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => setMode({ code: c.code, kind: "merge" })}
          >
            <CombineIcon />
            Merge into…
          </DropdownMenuItem>
          {c.custom ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setMode({ code: c.code, kind: "delete" })}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          ) : null}
        </RowMenu>
      </div>
      {mine === "move" ? (
        <MovePanel category={c} tree={tree} onDone={close} />
      ) : mine === "merge" ? (
        <MergePanel category={c} tree={tree} onDone={close} />
      ) : mine === "delete" ? (
        <DeletePanel category={c} tree={tree} onDone={close} />
      ) : null}
    </>
  )
}

function RenameInput({
  category: c,
  onDone,
}: {
  category: Category
  onDone: () => void
}) {
  const [label, setLabel] = useState(c.label)
  const patch = useSend<{ label: string }>(
    "PATCH",
    `/api/categories/${c.code}`,
    { success: "Category renamed" }
  )
  const save = () => {
    const next = label.trim()
    if (next && next !== c.label) patch.mutate({ label: next })
    onDone()
  }
  return (
    <Input
      autoFocus
      aria-label={`Name for ${c.label}`}
      className="h-8 max-w-80"
      value={label}
      maxLength={60}
      onChange={(e) => setLabel(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save()
        if (e.key === "Escape") onDone()
      }}
    />
  )
}

/** The inline row for a new category inside a top-level one. */
function AddInside({
  parent,
  onDone,
}: {
  parent: Category
  onDone: () => void
}) {
  const [label, setLabel] = useState("")
  const [style, setStyle] = useState<{ icon: string; color: string } | null>(
    null
  )
  const create = useCreate(onDone)
  const submit = () => {
    if (!label.trim()) return
    create.mutate({
      label: label.trim(),
      parent: parent.code,
      icon: style?.icon ?? parent.icon,
      color: style?.color ?? parent.color,
    })
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 py-2 pr-3 pl-11 sm:pr-4 sm:pl-13"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <IconColorPicker
        label="Icon and colour"
        size="sm"
        icon={style?.icon ?? parent.icon}
        color={style?.color ?? parent.color}
        onChange={setStyle}
      />
      <Input
        autoFocus
        aria-label={`New category in ${parent.label}`}
        placeholder={`New category in ${parent.label}`}
        className="h-8 min-w-40 flex-1 sm:max-w-80"
        value={label}
        maxLength={60}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
      />
      <span className="flex gap-2 max-sm:ml-auto">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!label.trim() || create.isPending}>
          Add
        </Button>
      </span>
    </form>
  )
}

/** A step under a row: choose, read what happens, then act. */
function Panel({
  children,
  actions,
  indent,
}: {
  children: ReactNode
  actions: ReactNode
  indent: boolean
}) {
  return (
    <div
      className={cn(
        "mx-3 mb-3 flex flex-col gap-3 rounded-2xl bg-muted/50 p-3 sm:mx-4",
        indent && "ml-11 sm:ml-13"
      )}
    >
      {children}
      <div className="flex flex-wrap justify-end gap-2">{actions}</div>
    </div>
  )
}

function MovePanel({
  category: c,
  tree,
  onDone,
}: {
  category: Category
  tree: Tree
  onDone: () => void
}) {
  const hasChildren = tree.children(c.code).length > 0
  // A category inside another can become a group of its own; a group of
  // your own can change type, or (when empty) go inside another group.
  const options: ChoiceOption[] = [
    ...GROUPS.filter((g) => c.parent || g.group !== c.group).map((g) => ({
      value: `group:${g.group}`,
      label: `${g.label} group of its own`,
      group: "Make it a group",
    })),
    ...(hasChildren
      ? []
      : topOptions(tree, (x) => x.code !== c.code && x.code !== c.parent).map(
          (o) => ({ ...o, group: `Inside a ${o.group.toLowerCase()} group` })
        )),
  ]
  const [target, setTarget] = useState("")
  const move = useSend<{ parent?: string | null; group?: Group }>(
    "PATCH",
    `/api/categories/${c.code}`,
    { success: `Moved ${c.label}`, onSuccess: onDone }
  )
  const go = () => {
    if (target.startsWith("group:")) {
      const group = target.slice(6) as Group
      move.mutate(c.parent ? { parent: null, group } : { group })
    } else move.mutate({ parent: target })
  }
  return (
    <Panel
      indent={Boolean(c.parent)}
      actions={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={!target || move.isPending} onClick={go}>
            Move
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor={`move-${c.code}`}>Move {c.label} to</FieldLabel>
        <Choice
          id={`move-${c.code}`}
          className="w-full sm:max-w-80"
          value={target}
          placeholder="Choose where"
          onChange={setTarget}
          options={options}
        />
      </Field>
      {hasChildren ? (
        <p className="text-sm text-muted-foreground">
          The categories inside it move with it.
        </p>
      ) : null}
    </Panel>
  )
}

/** Where a category's transactions, rules and budgets could go. */
function targetsFor(c: Category, tree: Tree) {
  const hasChildren = tree.children(c.code).length > 0
  // Its own categories need a top-level home in the same group.
  return hasChildren
    ? topOptions(tree, (x) => x.code !== c.code && x.group === c.group)
    : allOptions(tree, (x) => x.code !== c.code && x.parent !== c.code)
}

function useRuleCount(code: string) {
  const rules = useQuery(rulesQuery)
  return (rules.data ?? []).filter(
    (r) =>
      r.action.category === code ||
      r.action.split?.some((p) => p.category === code)
  ).length
}

/** "12 transactions and 2 rules", or null when nothing uses it. */
function whatMoves(c: Category, tree: Tree, rules: number) {
  const parts = [
    tree.count(c) ? pluralize(tree.count(c), "transaction") : null,
    rules ? pluralize(rules, "rule") : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" and ") : null
}
const list = (parts: string[]) =>
  parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
    : parts[0]
/** "Its 268 transactions, 1 rule and budgets move to Shopping." */
function movesSentence(c: Category, tree: Tree, rules: number, into: string) {
  const kids = tree.children(c.code).length
  const parts = [
    tree.count(c) ? pluralize(tree.count(c), "transaction") : null,
    rules ? pluralize(rules, "rule") : null,
    "budgets",
    kids ? `the ${pluralize(kids, "category", "categories")} inside it` : null,
  ].filter((p): p is string => Boolean(p))
  return `Its ${list(parts)} move to ${into}.`
}

function MergePanel({
  category: c,
  tree,
  onDone,
}: {
  category: Category
  tree: Tree
  onDone: () => void
}) {
  const [target, setTarget] = useState("")
  const [confirming, setConfirming] = useState(false)
  const rules = useRuleCount(c.code)
  const merge = useSend<{ into: string }>(
    "POST",
    `/api/categories/${c.code}/merge`,
    {
      success: (_, v) => `Merged ${c.label} into ${tree.get(v.into)?.label}`,
      onSuccess: onDone,
    }
  )
  const into = tree.get(target)
  return (
    <Panel
      indent={Boolean(c.parent)}
      actions={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={!into} onClick={() => setConfirming(true)}>
            Merge…
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor={`merge-${c.code}`}>
          Merge {c.label} into
        </FieldLabel>
        <Choice
          id={`merge-${c.code}`}
          className="w-full sm:max-w-80"
          value={target}
          placeholder="Choose a category"
          onChange={setTarget}
          options={targetsFor(c, tree)}
        />
      </Field>
      {into ? (
        <ConfirmAction
          open={confirming}
          onOpenChange={setConfirming}
          title={`Merge ${c.label} into ${into.label}?`}
          confirmLabel="Merge"
          onConfirm={() => merge.mutateAsync({ into: into.code })}
        >
          {movesSentence(c, tree, rules, into.label)}{" "}
          {c.custom
            ? `${c.label} is then deleted.`
            : `Bank transactions in ${c.label} count as ${into.label} from now on; you can restore ${c.label} later.`}
        </ConfirmAction>
      ) : null}
    </Panel>
  )
}

function DeletePanel({
  category: c,
  tree,
  onDone,
}: {
  category: Category
  tree: Tree
  onDone: () => void
}) {
  const rules = useRuleCount(c.code)
  const kids = tree.children(c.code).length
  const moving = whatMoves(c, tree, rules)
  const used = Boolean(moving) || kids > 0
  const [target, setTarget] = useState("")
  const [confirming, setConfirming] = useState(false)
  const into = tree.get(target)
  const remove = useSend<{ moveTo?: string }>(
    "DELETE",
    (v) =>
      `/api/categories/${c.code}${v.moveTo ? `?moveTo=${encodeURIComponent(v.moveTo)}` : ""}`,
    { success: `Deleted ${c.label}`, onSuccess: onDone }
  )
  return (
    <Panel
      indent={Boolean(c.parent)}
      actions={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={used && !into}
            onClick={() => setConfirming(true)}
          >
            Delete…
          </Button>
        </>
      }
    >
      {used ? (
        <Field>
          <FieldLabel htmlFor={`delete-${c.code}`}>
            Move its {moving ?? "categories"} to
          </FieldLabel>
          <Choice
            id={`delete-${c.code}`}
            className="w-full sm:max-w-80"
            value={target}
            placeholder="Choose a category"
            onChange={setTarget}
            options={targetsFor(c, tree)}
          />
        </Field>
      ) : (
        <p className="text-sm">Nothing uses {c.label}.</p>
      )}
      <ConfirmAction
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${c.label}?`}
        confirmLabel="Delete category"
        destructive
        onConfirm={() => remove.mutateAsync({ moveTo: into?.code })}
      >
        {into
          ? movesSentence(c, tree, rules, into.label)
          : "It has no transactions, rules or categories inside it."}
      </ConfirmAction>
    </Panel>
  )
}

/** Built-in categories merged into another, with a way back. */
export function MergedCard({ tree }: { tree: Tree }) {
  const [open, setOpen] = useState(false)
  if (!tree.merged.length) return null
  return (
    <SectionCard
      title="Merged"
      flush
      action={
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : `Show ${tree.merged.length}`}
        </Button>
      }
    >
      {open ? (
        <ul className="flex flex-col divide-y divide-border/70 border-t">
          {tree.merged.map((c) => (
            <MergedRow key={c.code} category={c} tree={tree} />
          ))}
        </ul>
      ) : (
        <div className="pb-1" />
      )}
    </SectionCard>
  )
}

function MergedRow({ category: c, tree }: { category: Category; tree: Tree }) {
  const restore = useSend("PATCH", `/api/categories/${c.code}`, {
    body: () => ({ mergedInto: null }),
    success: `Restored ${c.label}`,
  })
  return (
    <li className="flex min-h-14 items-center gap-3 py-2 pr-3 pl-4 sm:pr-4 sm:pl-5">
      <CategoryIcon icon={c.icon} color={c.color} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium break-words">{c.label}</span>
        <span className="text-xs text-muted-foreground">
          Merged into {tree.get(c.mergedInto!)?.label ?? "another category"}
        </span>
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={restore.isPending}
        onClick={() => restore.mutate()}
      >
        <Undo2Icon data-icon="inline-start" />
        Restore
      </Button>
    </li>
  )
}

/** The same menu at the end of every editable row. */
export function RowMenu({
  label,
  children,
  awayRef,
}: {
  label: string
  children: ReactNode
  /** Set when the chosen item moves focus elsewhere itself. */
  awayRef?: { current: boolean }
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 text-muted-foreground"
            aria-label={`${label} options`}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-52"
        finalFocus={() => {
          const keep = !awayRef?.current
          if (awayRef) awayRef.current = false
          return keep
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
