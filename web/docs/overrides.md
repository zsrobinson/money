# App overrides: schema and evaluator

The web app owns a small read/write SQLite database (`MONEY_APP_DB`) holding
everything a person edits. The detail snapshot (`MONEY_DETAIL_DB`) is opened
read-only and never written. Any other reader (for example the Python
publisher) must implement the evaluator below exactly so both agree.

Schema version 2. `schema_version(version INTEGER NOT NULL)` holds one row.
A change to any table or to evaluator behaviour bumps the version.

## Tables

```sql
CREATE TABLE schema_version(version INTEGER NOT NULL);
CREATE TABLE txn_overrides(
  txn_id TEXT PRIMARY KEY,
  category TEXT,            -- NULL: no override
  merchant TEXT,            -- NULL: no override
  note TEXT,                -- NULL or text, never published anywhere
  hidden INTEGER,           -- NULL: no override; 0/1
  reviewed INTEGER,         -- NULL: no override; 0/1
  updated_at TEXT NOT NULL  -- ISO UTC
);
CREATE TABLE rules(
  id TEXT PRIMARY KEY,      -- 'rule_' + random hex
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  match_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE budgets(month TEXT NOT NULL, category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, PRIMARY KEY(month, category));
CREATE TABLE budget_defaults(category TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL);
CREATE TABLE goals(id TEXT PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('save','payoff')),
  target_cents INTEGER NOT NULL, target_date TEXT, account_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL);
CREATE TABLE recurring_overrides(merchant_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active','ignored','cancelled')),
  cadence TEXT, expected_cents INTEGER);
CREATE TABLE account_overrides(account_id TEXT PRIMARY KEY, display_name TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, exclude_net_worth INTEGER NOT NULL DEFAULT 0);
CREATE TABLE settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
-- v2
CREATE TABLE categories(code TEXT PRIMARY KEY, label TEXT NOT NULL,
  grp TEXT NOT NULL CHECK(grp IN ('income','expense','transfer')), parent TEXT,
  hidden INTEGER NOT NULL DEFAULT 0, sort INTEGER);
CREATE TABLE txn_splits(txn_id TEXT NOT NULL, idx INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL, category TEXT NOT NULL, note TEXT,
  PRIMARY KEY(txn_id, idx));
CREATE TABLE tags(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, hue TEXT);
CREATE TABLE txn_tags(txn_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY(txn_id, tag_id));
```

The file is mode 0640 with `journal_mode=DELETE`, so a reader in the file's
group needs no write access to WAL side files. `node --import tsx
server/migrate.ts` (only `MONEY_APP_DB` set) creates or upgrades it without the
detail snapshot.

### Categories

A row whose `code` equals a built-in taxonomy code is an edit: only `label`,
`hidden` and `sort` apply. Any other code is custom (`cat_` + hex) and must have
`parent` set to a built-in top-level code; its group is the parent's. Every
total outside the app maps a custom code to its parent. Custom labels never
leave the app.

### Splits

When a transaction has splits, they replace its single category in every total:
each split counts under its own category (custom codes map to their parent).
Split amounts are non-zero, share the transaction's sign and sum exactly to its
amount; there are zero or at least two. Hidden still applies to the whole
transaction, and the merchant is unchanged.

### Tags

Tags are app-only. A transaction's tags are the union of the tags added by every
matching rule and its own `txn_tags` rows.

### Accounts

`exclude_net_worth` removes the account from net worth and its history only; its
balances stay listed and its transactions still count everywhere. `hidden` only
hides it from app lists and pickers. `display_name` never leaves the app.

## Rule shape

`match_json`, every present key must match (AND); an empty object matches nothing:

| Key | Type | Meaning |
| --- | --- | --- |
| `merchant_contains` | string | normalized substring of normalized `coalesce(merchant, description, '')` |
| `merchant_equals` | string | normalized equality with the same text |
| `account_id` | string | equals `account_id` |
| `category` | string | equals the snapshot `category` |
| `direction` | `"in"` \| `"out"` | `in`: `amount_cents > 0`; `out`: `amount_cents < 0` |
| `amount_min_cents` | integer | `abs(amount_cents) >= value` |
| `amount_max_cents` | integer | `abs(amount_cents) <= value` |

`action_json`, at least one key:

| Key | Type | Effect |
| --- | --- | --- |
| `category` | string | set category |
| `merchant` | string | set display merchant |
| `hide` | boolean | set hidden |
| `mark_reviewed` | boolean | set reviewed |
| `tags` | string[] | add these tag ids |

Normalization: `nfkc(casefold(nfkc(s)))` with full Unicode case folding
(Python `str.casefold()`; the server uses a table generated from it, not
`toLowerCase`), then runs of Python `str.isspace()` whitespace collapse to one
space and the ends are trimmed. `tests/normalize-vectors.json` holds shared
vectors both implementations must pass.

## Evaluator

For each transaction:

1. Start from snapshot values: `category`, `merchant`, `hidden = false`, `reviewed = false`.
2. Take enabled rules ordered by `position ASC, id ASC`.
3. Matching always reads the **snapshot** values, never values set by earlier rules
   (no chaining).
4. Per field, the **first** matching rule that sets that field wins; later rules
   can still set other fields. Tags are the union over all matching rules.
5. Then each non-NULL column of `txn_overrides` replaces the field.
6. Splits, when present, allocate the amount across categories.

A rule whose stored JSON fails validation (for example written by a newer
version) is skipped, never partly applied.

`merchant_key` for recurring is the normalized effective merchant.
Hidden transactions are excluded from cash flow, reports and budgets but still
listed when a transaction filter asks for them.
