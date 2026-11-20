import { chmodSync, existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

/** Bump together with docs/overrides.md whenever a table or evaluator rule changes. */
export const SCHEMA_VERSION = 2

const V1 = `
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS txn_overrides(
  txn_id TEXT PRIMARY KEY, category TEXT, merchant TEXT, note TEXT,
  hidden INTEGER, reviewed INTEGER, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules(
  id TEXT PRIMARY KEY, position INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  match_json TEXT NOT NULL, action_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS budgets(month TEXT NOT NULL, category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, PRIMARY KEY(month, category));
CREATE TABLE IF NOT EXISTS budget_defaults(category TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS goals(id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('save','payoff')), target_cents INTEGER NOT NULL,
  target_date TEXT, account_ids_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recurring_overrides(merchant_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active','ignored','cancelled')),
  cadence TEXT, expected_cents INTEGER);
CREATE TABLE IF NOT EXISTS account_overrides(account_id TEXT PRIMARY KEY, display_name TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, exclude_net_worth INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
`

const V2 = `
CREATE TABLE IF NOT EXISTS categories(code TEXT PRIMARY KEY, label TEXT NOT NULL,
  grp TEXT NOT NULL CHECK(grp IN ('income','expense','transfer')), parent TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, sort INTEGER);
CREATE TABLE IF NOT EXISTS txn_splits(txn_id TEXT NOT NULL, idx INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, category TEXT NOT NULL, note TEXT,
  PRIMARY KEY(txn_id, idx));
CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, hue TEXT);
CREATE TABLE IF NOT EXISTS txn_tags(txn_id TEXT NOT NULL, tag_id TEXT NOT NULL,
  PRIMARY KEY(txn_id, tag_id));
CREATE INDEX IF NOT EXISTS txn_tags_tag ON txn_tags(tag_id);
`

/**
 * Open (creating if needed) and migrate the app database. Idempotent. The
 * file is 0640 with a rollback journal, so the sync user's group can read it
 * without write access to WAL side files.
 */
export function openAppDb(path: string) {
  const created = path !== ":memory:" && !existsSync(path)
  const db = new DatabaseSync(path)
  db.exec(
    "PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"
  )
  migrate(db)
  // SQLite creates the file on first write; journals inherit its mode.
  if (created) chmodSync(path, 0o640)
  return db
}

export function migrate(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE")
  try {
    db.exec(V1)
    const row = db.prepare("SELECT version FROM schema_version").get() as
      { version: number } | undefined
    const current = row?.version ?? 0
    if (current > SCHEMA_VERSION)
      throw new Error(
        `App database schema ${current} is newer than this app (${SCHEMA_VERSION})`
      )
    if (current < 2) db.exec(V2)
    if (!row)
      db.prepare("INSERT INTO schema_version VALUES(?)").run(SCHEMA_VERSION)
    else if (current < SCHEMA_VERSION)
      db.prepare("UPDATE schema_version SET version=?").run(SCHEMA_VERSION)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export type AppDb = DatabaseSync
