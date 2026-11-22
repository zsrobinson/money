# App overrides: schema and evaluator

The web app owns a small read/write SQLite database (`MONEY_APP_DB`) holding
everything a person edits. The detail snapshot (`MONEY_DETAIL_DB`) is opened
read-only and never written. Any other reader (for example the Python
publisher) must implement the evaluator below exactly so both agree.

Schema version 4. `schema_version(version INTEGER NOT NULL)` holds one row.
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
  updated_at TEXT NOT NULL, -- ISO UTC
  date TEXT                 -- v3; NULL: no override; YYYY-MM-DD
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
-- v4
ALTER TABLE categories ADD COLUMN icon TEXT;        -- app-only display
ALTER TABLE categories ADD COLUMN color TEXT;       -- app-only display
ALTER TABLE categories ADD COLUMN merged_into TEXT; -- built-in codes only
ALTER TABLE categories ADD COLUMN budget_kind TEXT; -- app-only: fixed/flexible/non_monthly
ALTER TABLE rules ADD COLUMN applies_from TEXT;     -- NULL or YYYY-MM-DD
ALTER TABLE goals ADD COLUMN monthly_cents INTEGER; -- app-only planned contribution
CREATE TABLE manual_accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('cash','credit','loan','investment','property','vehicle','other')),
  currency TEXT NOT NULL DEFAULT 'USD', created_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE manual_balances(account_id TEXT NOT NULL, date TEXT NOT NULL,
  cents INTEGER NOT NULL, PRIMARY KEY(account_id, date));
CREATE TABLE manual_txns(id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
  date TEXT NOT NULL, amount_cents INTEGER NOT NULL, merchant TEXT, category TEXT NOT NULL,
  created_at TEXT NOT NULL);
CREATE TABLE budget_plans(category TEXT NOT NULL, from_month TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, PRIMARY KEY(category, from_month));
CREATE TABLE goal_allocations(goal_id TEXT NOT NULL, account_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('all','amount','percent')), value INTEGER,
  PRIMARY KEY(goal_id, account_id));
CREATE TABLE saved_views(id TEXT PRIMARY KEY, name TEXT NOT NULL,
  search_json TEXT NOT NULL, position INTEGER NOT NULL);
```

The v3 to v4 migration moves every `budget_defaults` row into `budget_plans`
with `from_month = '0001-01'` (the table stays, empty), gives every goal
account an `all` allocation, and stores a `reviewSince` setting of the day it
runs. Readers must accept versions 2, 3 and 4.

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

From v4 a custom row may also be **top level** (`parent` NULL, `grp` chosen
from income, expense or transfer) or sit under a custom top-level row (its
group is that row's). Outside the app every custom code maps to an owned code:
its built-in ancestor when it has one, otherwise by group: `income` to
`income`, `expense` to `other`, `transfer` to `bank_transfer`. A custom row's
parent must be a top-level row (one level of children). A custom row whose
parent no longer exists is ignored. Any category result that is neither
built-in nor a valid custom row, including an ignored row, counts as `other`
(inside the app it shows as Other).

A built-in row with `merged_into` set is a merge: wherever the evaluator's
category result (snapshot, rule or override) is that built-in code, it
becomes `merged_into` instead (one step; the target is never itself merged).
Merging rewrites explicit references in the app database, so the remap only
matters for snapshot categories. Rule matching still reads the snapshot
category. The owned code is itself remapped by a merge, from the evaluator's
result before its own merge, so a custom child of a merged built-in and the
group fallbacks land on the merge target. Merging also points anything
already merged into the source at the new target, so chains never form.
`icon`, `color` and `budget_kind` never leave the app.

Inside the app a parent's figure always includes its children, with each child
also shown on its own, and grand totals add only top-level categories so each
dollar counts once. Budgets are app-only and follow the same rule: a parent's
budget is its own `budgets`/`budget_defaults` amount plus its children's, and
its spending includes theirs. The stored rows are unchanged. Budget amounts
come from `budget_plans` and `budgets` (v4, below); `budget_defaults` is no
longer read.

### Splits

When a transaction has splits, they replace its single category in every total:
each split counts under its own category (custom codes map to their parent).
Split amounts are non-zero, share the transaction's sign and sum exactly to its
amount; there are zero or at least two. Hidden still applies to the whole
transaction, and the merchant is unchanged.

### Dates (v3)

A non-NULL `txn_overrides.date` replaces the snapshot date for every period:
months, budgets, reports, merchant windows and the transaction list. It must
be a real calendar day in years 0001-9999. Rules never set it, matching and
transfer pairing keep the snapshot date, and the snapshot date stays visible
as the bank's date. The v2 to v3 migration only adds the column.

### Manual accounts and transactions (v4)

`manual_accounts` are accounts a person keeps by hand. Their ids start
`macct_`; a manual transaction's id starts `mtxn_`. `type` maps to the
snapshot account types: `cash` is `depository`, `credit` and `loan` are
liabilities (balances are amounts owed, positive), and `investment`,
`property`, `vehicle` and `other` are assets. A closed account (`closed_at`
set) keeps its history and stops at its last balance, like a historical
linked account.

Each `manual_balances` row is the balance as stated on that day. The balance
on day D is the latest stated balance on or before D, plus every manual
transaction on that account dated after that statement and on or before D:
an asset moves by `amount_cents`, a liability's amount owed moves by
`-amount_cents`. With no statement yet, the balance starts at zero on the day
of the first transaction. With neither, the balance is unknown (NULL).
Hidden manual transactions still move the balance, and the balance uses the
manual date, not a `txn_overrides.date`. Any non-NULL `closed_at` makes the
account historical. A `currency` that is not three capital letters reports
as `UNKNOWN` outside the app.

`manual_txns` belong only to manual accounts. They follow the evaluator like
snapshot transactions: `category`, `merchant` and `date` are their snapshot
values, so rules, `txn_overrides` (hidden, reviewed, note), `txn_splits` and
`txn_tags` apply by their id. They are never pending, `flow_kind` is
`activity`, and they never pair as internal transfers. `merchant` is
app-only text, like display names; aggregate reporting outside the app uses
only owned category codes and amounts.

### Tags

Tags are app-only. A transaction's tags are the union of the tags added by every
matching rule and its own `txn_tags` rows.

### Accounts

`exclude_net_worth` removes the account from net worth and its history only; its
balances stay listed and its transactions still count everywhere. `hidden` only
hides it from app lists and pickers. `display_name` never leaves the app.

### Budgets, goals and views (v4)

App-only. The budget for (month M, category C) is the `budgets` row for M
when present ("only this month"), otherwise the `budget_plans` row for C with
the latest `from_month <= M`, otherwise none. Category `__flexible` holds the
flexible pool. `goal_allocations` give each goal a share of an account:
`all`, `amount` (cents, capped at the balance) or `percent` (basis points,
0-10000). `saved_views` hold transaction filter searches.

## Rule shape

`match_json`, every present key must match (AND); an empty object matches nothing:

| Key                    | Type         | Meaning                                                                  |
| ---------------------- | ------------ | ------------------------------------------------------------------------ |
| `merchant_contains`    | string       | normalized substring of normalized `coalesce(merchant, description, '')` |
| `merchant_equals`      | string       | normalized equality with the same text                                   |
| `merchant_starts_with` | string       | v4: normalized prefix of the same text                                   |
| `description_contains` | string       | v4: normalized substring of normalized `coalesce(description, '')` only  |
| `account_id`           | string       | equality with the account id                                             |
| `category`             | string       | equality with the **snapshot** category (the bank's)                     |
| `flow_kind`            | string       | v4: equality with `activity`, `bank_transfer` or `peer_payment`          |
| `direction`            | `in`/`out`   | amount > 0 / amount < 0                                                  |
| `amount_min_cents`     | integer >= 0 | abs(amount) >= value                                                     |
| `amount_max_cents`     | integer >= 0 | abs(amount) <= value                                                     |
| `date_from`            | YYYY-MM-DD   | v4: snapshot date >= value                                               |
| `date_to`              | YYYY-MM-DD   | v4: snapshot date <= value                                               |
| `any`                  | object[]     | v4: at least one of these condition objects (no nested `any`) matches    |

`action_json`, at least one key:

| Key              | Type     | Effect               |
| ---------------- | -------- | -------------------- |
| `category`       | string   | set category         |
| `merchant`       | string   | set display merchant |
| `hide`           | boolean  | set hidden           |
| `mark_reviewed`  | boolean  | set reviewed         |
| `tags`           | string[] | add these tag ids    |
| `split`          | object[] | v4: split by share   |
| `mark_recurring` | boolean  | v4: app-only         |

`split` (v4) is 2 to 10 `{category, percent}` parts, `percent` in basis points
(1-10000) summing to exactly 10000. It applies only to a transaction without
its own `txn_splits` rows, and the first matching rule with `split` wins.
Each part's amount is `trunc(amount_cents * percent / 10000)` (toward zero)
and the last part takes the remainder, so parts sum to the amount; a part
that comes to zero is dropped, and when fewer than two parts remain the
transaction takes the first non-zero part's category instead of a split.
Split categories follow the same owned mapping as any other category. A rule
split applies even when `txn_overrides.category` is set; only `txn_splits`
rows suppress it. When a rule split collapses to one part, that part's
category becomes the transaction's category; when every part is zero, the
transaction keeps its category.

`applies_from` (v4) limits a rule to transactions whose **snapshot** date is
on or after it ("only new transactions"); NULL applies to all history.
`mark_recurring` is read only by the app's recurring view. Readers ignore
action keys they do not use, but a key they do not know in `match_json`, an
empty `any` list, an empty or invalid condition inside it, or a value of the
wrong type makes the rule match nothing. `tests/overrides-v4-vectors.json`
at the repository root holds shared vectors both implementations must pass.

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
5. Then each non-NULL column of `txn_overrides` replaces the field, including
   the date.
6. Splits, when present, allocate the amount across categories.

A rule whose stored JSON fails validation (for example written by a newer
version) is skipped, never partly applied.

`merchant_key` for recurring is the normalized effective merchant.
Hidden transactions are excluded from cash flow, reports and budgets but still
listed when a transaction filter asks for them.
