import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { normalizeText } from "../server/normalize.ts"

const vectors = JSON.parse(
  readFileSync(new URL("./normalize-vectors.json", import.meta.url), "utf8")
) as { input: string; expected: string }[]

test("normalization matches Python's shared vectors exactly", () => {
  for (const v of vectors) assert.equal(normalizeText(v.input), v.expected, JSON.stringify(v.input))
  assert.equal(normalizeText(null), "")
})
