import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertLoopback, fixturePaths } from "../server/fixture-guard.ts"

test("fixture paths reject system dirs and symlink escapes before opening", () => {
  const root = mkdtempSync(join(tmpdir(), "money-guard-"))
  const fixtures = join(root, "fixtures")
  const outside = join(root, "outside")
  mkdirSync(fixtures)
  mkdirSync(outside)
  writeFileSync(join(outside, "detail.sqlite"), "")
  writeFileSync(join(fixtures, "real.sqlite"), "")
  symlinkSync(join(outside, "detail.sqlite"), join(fixtures, "detail.sqlite"))
  assert.throws(
    () => fixturePaths({ MONEY_FIXTURE_DIR: fixtures }, fixtures),
    /outside the fixture directory/
  )
  assert.throws(
    () =>
      fixturePaths(
        {
          MONEY_FIXTURE_DIR: fixtures,
          MONEY_FIXTURE_DETAIL: "../outside/detail.sqlite",
        },
        fixtures
      ),
    /inside the fixture directory/
  )
  // A symlinked directory is judged by where it really points.
  symlinkSync("/etc", join(root, "etc-link"))
  assert.throws(
    () => fixturePaths({ MONEY_FIXTURE_DIR: join(root, "etc-link") }, fixtures),
    /system or deployment/
  )
  for (const dir of ["/var", "/opt", "/etc"])
    assert.throws(
      () => fixturePaths({ MONEY_FIXTURE_DIR: dir }, fixtures),
      /system or deployment/
    )
  const ok = fixturePaths(
    { MONEY_FIXTURE_DIR: fixtures, MONEY_FIXTURE_DETAIL: "real.sqlite" },
    fixtures
  )
  assert.equal(ok.detail, join(fixtures, "real.sqlite"))
  assert.throws(() => assertLoopback("0.0.0.0"))
  assertLoopback("127.0.0.1")
})
