import { chmodSync, existsSync, renameSync, unlinkSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

/** Bump together with docs/overrides.md whenever a table or evaluator rule changes. */
export const SCHEMA_VERSION = 4

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

// v4: manual accounts and transactions, category styling, custom top-level
// categories and merges, forward budget plans, goal allocations, rule scope
// and saved transaction views.
const V4 = `
CREATE TABLE IF NOT EXISTS manual_accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('cash','credit','loan','investment','property','vehicle','other')),
  currency TEXT NOT NULL DEFAULT 'USD', created_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE IF NOT EXISTS manual_balances(account_id TEXT NOT NULL, date TEXT NOT NULL,
  cents INTEGER NOT NULL, PRIMARY KEY(account_id, date));
CREATE TABLE IF NOT EXISTS manual_txns(id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
  date TEXT NOT NULL, amount_cents INTEGER NOT NULL, merchant TEXT, category TEXT NOT NULL,
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS manual_txns_account ON manual_txns(account_id, date);
CREATE TABLE IF NOT EXISTS budget_plans(category TEXT NOT NULL, from_month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, PRIMARY KEY(category, from_month));
CREATE TABLE IF NOT EXISTS goal_allocations(goal_id TEXT NOT NULL, account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('all','amount','percent')), value INTEGER,
  PRIMARY KEY(goal_id, account_id));
CREATE TABLE IF NOT EXISTS saved_views(id TEXT PRIMARY KEY, name TEXT NOT NULL,
  search_json TEXT NOT NULL, position INTEGER NOT NULL);
`

function addColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  type: string
) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string
  }[]
  if (!columns.some((c) => c.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

/**
 * Open (creating if needed) and migrate the app database. Idempotent. The
 * live file and its journals are owner-only. Sync reads a separately published
 * immutable snapshot, never this database.
 */
export function openAppDb(path: string) {
  const created = path !== ":memory:" && !existsSync(path)
  const db = new DatabaseSync(path)
  db.exec(
    "PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"
  )
  migrate(db)
  // SQLite creates the file on first write; journals inherit its mode.
  if (created) chmodSync(path, 0o600)
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
    // Every CREATE is IF NOT EXISTS, so a partial older file fills in.
    db.exec(V2)
    // v3: a person can correct a transaction's date.
    addColumn(db, "txn_overrides", "date", "TEXT")
    db.exec(V4)
    addColumn(db, "categories", "icon", "TEXT")
    addColumn(db, "categories", "color", "TEXT")
    addColumn(db, "categories", "merged_into", "TEXT")
    addColumn(db, "categories", "budget_kind", "TEXT")
    addColumn(db, "rules", "applies_from", "TEXT")
    addColumn(db, "goals", "monthly_cents", "INTEGER")
    if (current < 4) {
      // Defaults become plans that start before any data; each goal's
      // accounts count in full, as before.
      db.exec(`INSERT OR IGNORE INTO budget_plans(category, from_month, amount_cents)
        SELECT category, '0001-01', amount_cents FROM budget_defaults;
        DELETE FROM budget_defaults;`)
      for (const g of db
        .prepare("SELECT id, account_ids_json FROM goals")
        .all() as {
        id: string
        account_ids_json: string
      }[])
        for (const account of JSON.parse(g.account_ids_json) as string[])
          db.prepare(
            "INSERT OR IGNORE INTO goal_allocations VALUES(?,?,'all',NULL)"
          ).run(g.id, account)
      // Review starts from the day this version first runs, so a first sync
      // of years of history does not all need review.
      db.prepare("INSERT OR IGNORE INTO settings VALUES('reviewSince', ?)").run(
        JSON.stringify(new Date().toISOString().slice(0, 10))
      )
    }
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

/** Publish a consistent read-only copy; atomic replacement keeps readers safe. */
export function publishAppSnapshot(db: AppDb, destination: string) {
  const temp = destination + ".new"
  try {
    if (existsSync(temp)) unlinkSync(temp)
    db.prepare("VACUUM INTO ?").run(temp)
    chmodSync(temp, 0o640)
    renameSync(temp, destination)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
}
