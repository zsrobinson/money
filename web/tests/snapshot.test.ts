import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, statSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { openAppDb, publishAppSnapshot } from "../server/app-db.ts"

test("live app is private and atomically publishes committed edits for sync", () => {
  const dir = mkdtempSync(join(tmpdir(), "money-snapshot-"))
  const live = join(dir, "live.sqlite")
  const copy = join(dir, "snapshot.sqlite")
  const db = openAppDb(live)
  try {
    assert.equal(statSync(live).mode & 0o777, 0o600)
    db.prepare("INSERT INTO settings VALUES('fixture', '{}')").run()
    publishAppSnapshot(db, copy)
    assert.equal(statSync(copy).mode & 0o777, 0o640)
    const first = new DatabaseSync(copy, { readOnly: true })
    db.prepare(
      "UPDATE settings SET value_json='true' WHERE key='fixture'"
    ).run()
    publishAppSnapshot(db, copy)
    const next = new DatabaseSync(copy, { readOnly: true })
    assert.equal(
      first.prepare("SELECT value_json FROM settings WHERE key='fixture'").get()
        ?.value_json,
      "{}"
    )
    assert.equal(
      next.prepare("SELECT value_json FROM settings WHERE key='fixture'").get()
        ?.value_json,
      "true"
    )
    first.close()
    next.close()
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
