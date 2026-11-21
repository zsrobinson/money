import { CASEFOLD_TABLE } from "./casefold-table.ts"

let table: Map<number, string> | undefined
function folds() {
  if (table) return table
  table = new Map()
  for (const entry of CASEFOLD_TABLE.split("\u0001")) {
    const colon = entry.indexOf(":")
    table.set(parseInt(entry.slice(0, colon), 16), entry.slice(colon + 1))
  }
  return table
}

/** Python's str.casefold(): full Unicode case folding, not toLowerCase(). */
export function casefold(text: string) {
  const map = folds()
  let out = ""
  for (const char of text) out += map.get(char.codePointAt(0)!) ?? char
  return out
}

// Exactly Python's str.isspace() set, so split() agrees on both sides.
const WHITESPACE = new RegExp(
  "[" +
    [
      [0x09, 0x0d],
      [0x1c, 0x20],
      [0x85, 0x85],
      [0xa0, 0xa0],
      [0x1680, 0x1680],
      [0x2000, 0x200a],
      [0x2028, 0x2029],
      [0x202f, 0x202f],
      [0x205f, 0x205f],
      [0x3000, 0x3000],
    ]
      .map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`)
      .join("") +
    "]+",
  "gu"
)

/**
 * Shared matching key (docs/overrides.md):
 * nfkc(casefold(nfkc(s))), whitespace runs collapsed to one space, trimmed.
 */
export function normalizeText(text: string | null | undefined) {
  if (!text) return ""
  return casefold(text.normalize("NFKC"))
    .normalize("NFKC")
    .replace(WHITESPACE, " ")
    .trim()
}
