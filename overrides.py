"""Apply versioned web reporting edits privately, without publishing user text."""
import json
import sqlite3
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from datetime import date
from detail import opaque, cents
from taxonomy import category, CATEGORIES


def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC',unicodedata.normalize('NFKC',value or '').casefold()).split())


def matches(match, txn):
    allowed={'merchant_contains','merchant_equals','account_id','category','direction','amount_min_cents','amount_max_cents'}
    if not match or set(match)-allowed:return False
    text=normalize(txn.get('merchant') if txn.get('merchant') is not None else txn.get('description'))
    for key,value in match.items():
        if key=='merchant_contains' and normalize(value) not in text:return False
        if key=='merchant_equals' and normalize(value)!=text:return False
        if key in ('account_id','category') and txn[key]!=value:return False
        if key=='direction' and not (txn['amount_cents']>0 if value=='in' else txn['amount_cents']<0 if value=='out' else False):return False
        if key=='amount_min_cents' and abs(txn['amount_cents'])<value:return False
        if key=='amount_max_cents' and abs(txn['amount_cents'])>value:return False
    return True


def evaluate(txn,rules,override=None):
    result={'category':txn['category'],'merchant':txn.get('merchant'),'hidden':False,'reviewed':False}
    assigned=set()
    fields={'category':'category','merchant':'merchant','hide':'hidden','mark_reviewed':'reviewed'}
    for match,action in rules:
        if matches(match,txn):
            for key,field in fields.items():
                if key in action and field not in assigned:
                    result[field]=action[key];assigned.add(field)
    for field in result:
        if override and override.get(field) is not None:result[field]=override[field]
    return result


def register_dates(db):
    values=dict(db.execute('SELECT id,date FROM effective_dates')) if db.execute("SELECT 1 FROM sqlite_temp_master WHERE name='effective_dates'").fetchone() else {}
    db.create_function('web_date',1,lambda tid:values.get(tid))


def override_date(value):
    if value is None:return None
    if not isinstance(value,str) or len(value)!=10 or date.fromisoformat(value).isoformat()!=value:raise ValueError('Invalid transaction date override')
    return value


@contextmanager
def reporting_store(db, app_path):
    """Copy private state in memory; never mutate ingestion or attach app DB to MCP.

    Display merchant/note/name edits are deliberately not used by the merchant
    disclosure policy. Only safe owned taxonomy codes and hidden flags affect
    aggregate reporting. A failed schema/read fails publication closed.
    """
    if not app_path:
        yield db;return
    app=sqlite3.connect(Path(app_path).resolve().as_uri()+'?mode=ro',uri=True)
    copy=sqlite3.connect(':memory:')
    try:
        app.row_factory=sqlite3.Row
        with app:
            app.execute("BEGIN")
            version=[r[0] for r in app.execute('SELECT version FROM schema_version')]
            if version not in ([2],[3]):raise ValueError('Unsupported app override schema')
            rules=[(json.loads(r['match_json']),json.loads(r['action_json'])) for r in app.execute('SELECT match_json,action_json FROM rules WHERE enabled=1 ORDER BY position,id')]
            date_column='date' if version==[3] else 'NULL AS date'
            edits={r['txn_id']:dict(r) for r in app.execute('SELECT txn_id,category,merchant,hidden,reviewed,'+date_column+' FROM txn_overrides')}
            excluded=[r[0] for r in app.execute('SELECT account_id FROM account_overrides WHERE exclude_net_worth=1')]
            parents={r['code']:r['parent'] for r in app.execute('SELECT code,parent FROM categories') if r['code'] not in CATEGORIES}
            splits={}
            for r in app.execute('SELECT txn_id,idx,amount_cents,category FROM txn_splits ORDER BY txn_id,idx'):
                splits.setdefault(r['txn_id'],[]).append(dict(r))
        db.commit();db.backup(copy)
        copy.execute('CREATE TEMP TABLE networth_exclusions(account_id TEXT PRIMARY KEY)')
        copy.executemany('INSERT INTO networth_exclusions VALUES(?)',[(aid,) for aid in excluded])
        copy.execute('CREATE TEMP TABLE effective_dates(id TEXT PRIMARY KEY,date TEXT)')
        copy.execute('CREATE TEMP TABLE effective_categories(id TEXT PRIMARY KEY,category TEXT)')
        copy.execute('CREATE TEMP TABLE reporting_allocations(id TEXT,category TEXT,amount REAL,PRIMARY KEY(id,category))')
        def owned(code):
            if code in CATEGORIES:return code
            if code in parents and parents[code] in CATEGORIES:return parents[code]
            raise ValueError('Unknown app category mapping')
        for tid,item,aid,amount,primary,detail,merchant,description in copy.execute('''SELECT t.id,t.item,m.ref,t.amount,t.primary_category,t.detailed_category,COALESCE(w.merchant,t.merchant),w.description FROM transactions t LEFT JOIN account_alias m ON m.provider_ref=t.account AND m.item=t.item LEFT JOIN web_transactions w ON w.provider_id=t.id AND w.item=t.item''').fetchall():
            matched=copy.execute('SELECT 1 FROM internal_matches WHERE item=? AND transaction_ref=?',(item,tid)).fetchone()
            txn={'account_id':aid,'amount_cents':-cents(amount),'category':'internal_transfer' if matched else category(primary,detail),'merchant':merchant,'description':description}
            ref=opaque('txn',item,tid)
            edit=edits.get(ref)
            changed_date=override_date(edit.get('date')) if edit else None
            if changed_date:copy.execute('INSERT INTO effective_dates VALUES(?,?)',(tid,changed_date))
            value=evaluate(txn,rules,edit)
            if value['hidden']:copy.execute('DELETE FROM transactions WHERE id=?',(tid,))
            else:
                allocated=splits.get(ref,[])
                if allocated:
                    if sum(r['amount_cents'] for r in allocated)!=txn['amount_cents'] or any(r['amount_cents']*txn['amount_cents']<0 for r in allocated):raise ValueError('Invalid transaction split')
                    totals={}
                    for r in allocated:
                        cat=owned(r['category']);totals[cat]=totals.get(cat,0)-r['amount_cents']/100
                    copy.executemany('INSERT INTO reporting_allocations VALUES(?,?,?)',[(tid,cat,amount) for cat,amount in totals.items()])
                elif value['category']!=txn['category']:
                    copy.execute('INSERT INTO effective_categories VALUES(?,?)',(tid,owned(value['category'])))
        register_dates(copy)
        copy.commit()
        yield copy
    finally:
        app.close();copy.close()
