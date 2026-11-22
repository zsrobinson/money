"""Apply versioned web reporting edits privately, without publishing user text."""
import json
import re
import sqlite3
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from datetime import date, datetime, timezone
from detail import opaque, cents, wallet_rows
from taxonomy import category, CATEGORIES

TEXT_KEYS = frozenset({'merchant_contains','merchant_equals','merchant_starts_with','description_contains'})
MATCH_KEYS = TEXT_KEYS|{'account_id','category','flow_kind','direction','amount_min_cents','amount_max_cents','date_from','date_to'}
GROUP_CODES = {'income':'income','expense':'other','transfer':'bank_transfer'}
# Manual account types map to snapshot account types; credit/loan balances are owed.
MANUAL_TYPES = {'cash':'depository','credit':'credit','loan':'loan','investment':'investment','property':'other','vehicle':'other','other':'other'}
MANUAL_INSTITUTION = 'Manual entries'


def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC',unicodedata.normalize('NFKC',value or '').casefold()).split())


def is_int(value):
    return isinstance(value,int) and not isinstance(value,bool)


def valid_condition(match,nested=False):
    """Unknown keys, wrong types or nested `any` make the whole rule match nothing."""
    if not isinstance(match,dict) or not match or set(match)-MATCH_KEYS-({'any'} if not nested else set()):return False
    for key,value in match.items():
        if key=='any':
            if not isinstance(value,list) or not all(valid_condition(c,True) for c in value):return False
        elif key in ('amount_min_cents','amount_max_cents'):
            if not is_int(value) or value<0:return False
        elif not isinstance(value,str):return False
    return True


def condition(match,txn):
    text=normalize(txn.get('merchant') if txn.get('merchant') is not None else txn.get('description'))
    for key,value in match.items():
        if key=='any' and not any(condition(c,txn) for c in value):return False
        if key=='merchant_contains' and normalize(value) not in text:return False
        if key=='merchant_equals' and normalize(value)!=text:return False
        if key=='merchant_starts_with' and not text.startswith(normalize(value)):return False
        if key=='description_contains' and normalize(value) not in normalize(txn.get('description')):return False
        if key in ('account_id','category','flow_kind') and txn.get(key)!=value:return False
        if key=='direction' and not (txn['amount_cents']>0 if value=='in' else txn['amount_cents']<0 if value=='out' else False):return False
        if key=='amount_min_cents' and abs(txn['amount_cents'])<value:return False
        if key=='amount_max_cents' and abs(txn['amount_cents'])>value:return False
        if key=='date_from' and not (txn.get('date') and txn['date']>=value):return False
        if key=='date_to' and not (txn.get('date') and txn['date']<=value):return False
    return True


def matches(match,txn):
    return valid_condition(match) and condition(match,txn)


def valid_split(parts):
    return (isinstance(parts,list) and 2<=len(parts)<=10
        and all(isinstance(p,dict) and isinstance(p.get('category'),str) and is_int(p.get('percent')) and 1<=p['percent']<=10000 for p in parts)
        and sum(p['percent'] for p in parts)==10000)


def valid_action(action):
    """Readers ignore action keys they do not use; known keys must have their types."""
    if not isinstance(action,dict):return False
    kinds={'category':str,'merchant':str,'hide':bool,'mark_reviewed':bool,'tags':list,'mark_recurring':bool}
    if any(key in action and not isinstance(action[key],kind) for key,kind in kinds.items()):return False
    return 'split' not in action or valid_split(action['split'])


def rule_list(rows):
    """Enabled rules by position, id as (match, action, applies_from); invalid JSON is skipped."""
    rules=[]
    for r in sorted((r for r in rows if r.get('enabled',1)),key=lambda r:(r['position'],r['id'])):
        try:match,action=json.loads(r['match_json']),json.loads(r['action_json'])
        except (TypeError,ValueError):continue
        rules.append((match,action,r.get('applies_from')))
    return rules


def evaluate(txn,rules,override=None):
    result={'category':txn['category'],'merchant':txn.get('merchant'),'hidden':False,'reviewed':False,'split':None}
    assigned=set()
    fields={'category':'category','merchant':'merchant','hide':'hidden','mark_reviewed':'reviewed','split':'split'}
    for match,action,*scope in rules:
        start=scope[0] if scope else None
        if start is not None and not (isinstance(start,str) and txn.get('date') and txn['date']>=start):continue
        if valid_action(action) and matches(match,txn):
            for key,field in fields.items():
                if key in action and field not in assigned:
                    result[field]=action[key];assigned.add(field)
    for field in ('category','merchant','hidden','reviewed'):
        if override and override.get(field) is not None:result[field]=override[field]
    return result


def allocate(amount,code,splits=(),rule_split=None):
    """Signed cents per category: explicit splits, else the first matching rule split.

    Rule parts truncate toward zero and the last part takes the remainder; zero
    parts are dropped and fewer than two remaining parts mean a single category.
    """
    if splits:return [(r['category'],r['amount_cents']) for r in splits]
    if rule_split:
        parts=[];rest=amount
        for i,p in enumerate(rule_split):
            share=rest if i==len(rule_split)-1 else (abs(amount)*p['percent']//10000)*(1 if amount>=0 else -1)
            rest-=share;parts.append((p['category'],share))
        parts=[p for p in parts if p[1]]
        if len(parts)>=2:return parts
        if parts:return [(parts[0][0],amount)]
    return [(code,amount)]


def category_map(rows,strict=False):
    """Return (effective, owned) for app category rows.

    effective applies a one-step built-in merge to an evaluator result. owned
    maps any code to an owned taxonomy code for reporting outside the app:
    built-in ancestor, else custom top-level group. Unknown codes and ignored
    custom rows (missing or non-top-level parent) count as `other` from v4, as
    in the app; v2/v3 keep failing closed.
    """
    rows={r['code']:r for r in rows}
    merged={code:r.get('merged_into') for code,r in rows.items() if code in CATEGORIES and r.get('merged_into') in CATEGORIES and r.get('merged_into')!=code}
    def effective(code):
        return merged.get(code,code)
    def owned(code):
        row=rows.get(code) or {}
        top=rows.get(row.get('parent')) or {}
        if code in CATEGORIES:base=code
        elif row.get('parent') in CATEGORIES:base=row['parent']
        elif not strict and row and row.get('parent') is None and row.get('grp') in GROUP_CODES:base=GROUP_CODES[row['grp']]
        elif not strict and top and top.get('parent') is None and top['code'] not in CATEGORIES and top.get('grp') in GROUP_CODES:base=GROUP_CODES[top['grp']]
        elif strict:raise ValueError('Unknown app category mapping')
        else:base='other'
        return merged.get(base,base)
    return effective,owned


def resolve(txn,rules,override=None,splits=(),categories=()):
    """One transaction through the whole evaluator; the shape of the shared vectors."""
    effective,owned=category_map(categories)
    value=evaluate(txn,rules,override)
    parts=allocate(txn['amount_cents'],value['category'],splits,value['split'])
    # A rule split that collapses to one part gives the transaction that category.
    code=parts[0][0] if not splits and value['split'] and len(parts)==1 else value['category']
    return {'category':effective(code),'owned':owned(code),'hidden':bool(value['hidden']),
        'allocations':[{'category':effective(c),'owned':owned(c),'amount_cents':amount} for c,amount in parts]}


def register_dates(db):
    values=dict(db.execute('SELECT id,date FROM effective_dates')) if db.execute("SELECT 1 FROM sqlite_temp_master WHERE name='effective_dates'").fetchone() else {}
    db.create_function('web_date',1,lambda tid:values.get(tid))


def override_date(value):
    if value is None:return None
    if not isinstance(value,str) or len(value)!=10 or date.fromisoformat(value).isoformat()!=value:raise ValueError('Invalid transaction date override')
    return value


def manual_day(value):
    if not isinstance(value,str) or len(value)!=10 or date.fromisoformat(value).isoformat()!=value:raise ValueError('Invalid manual entry')
    return value


def manual_balance(kind,statements,txns,day):
    """Latest stated balance on or before day plus later manual activity; owed moves by -amount."""
    sign=-1 if kind in ('credit','loan') else 1
    stated=[s for s in statements if s[0]<=day]
    since,balance=stated[-1] if stated else (None,None)
    moved=[t for t in txns if t[0]<=day and (since is None or t[0]>since)]
    if balance is None and not moved:return None
    return (balance or 0)+sign*sum(amount for _,amount in moved)


def checked_splits(allocated,amount):
    if allocated and (sum(r['amount_cents'] for r in allocated)!=amount or any(r['amount_cents']*amount<0 for r in allocated)):raise ValueError('Invalid transaction split')
    return allocated


@contextmanager
def reporting_store(db, app_path):
    """Copy private state in memory; never mutate ingestion or attach app DB to MCP.

    Display merchant/note/name edits are deliberately not used by the merchant
    disclosure policy. Only safe owned taxonomy codes and hidden flags affect
    aggregate reporting. A failed schema/read fails publication closed.
    Manual accounts (v4) publish generated labels, fixed institution text and
    owned categories only; account names and manual merchant text stay here.
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
            if version not in ([2],[3],[4]):raise ValueError('Unsupported app override schema')
            v4=version==[4]
            rules=rule_list([dict(r) for r in app.execute('SELECT id,position,enabled,match_json,action_json,'+('applies_from' if v4 else 'NULL AS applies_from')+' FROM rules')])
            date_column='date' if version!=[2] else 'NULL AS date'
            edits={r['txn_id']:dict(r) for r in app.execute('SELECT txn_id,category,merchant,hidden,reviewed,'+date_column+' FROM txn_overrides')}
            excluded=[r[0] for r in app.execute('SELECT account_id FROM account_overrides WHERE exclude_net_worth=1')]
            categories=[dict(r) for r in app.execute('SELECT code,grp,parent,merged_into FROM categories' if v4 else 'SELECT code,parent FROM categories')]
            splits={}
            for r in app.execute('SELECT txn_id,idx,amount_cents,category FROM txn_splits ORDER BY txn_id,idx'):
                splits.setdefault(r['txn_id'],[]).append(dict(r))
            manual_accounts=[dict(r) for r in app.execute('SELECT id,type,currency,closed_at FROM manual_accounts ORDER BY id')] if v4 else []
            statements=[tuple(r) for r in app.execute('SELECT account_id,date,cents FROM manual_balances ORDER BY account_id,date')] if v4 else []
            manual_txns=[dict(r) for r in app.execute('SELECT id,account_id,date,amount_cents,merchant,category FROM manual_txns ORDER BY date,id')] if v4 else []
        db.commit();db.backup(copy)
        owned=category_map(categories,strict=not v4)[1]
        manual_refs={a['id']:opaque('acct','manual',a['id']) for a in manual_accounts}
        copy.execute('CREATE TEMP TABLE networth_exclusions(account_id TEXT PRIMARY KEY)')
        copy.executemany('INSERT OR IGNORE INTO networth_exclusions VALUES(?)',[(manual_refs.get(aid,aid),) for aid in excluded])
        copy.execute('CREATE TEMP TABLE effective_dates(id TEXT PRIMARY KEY,date TEXT)')
        copy.execute('CREATE TEMP TABLE effective_categories(id TEXT PRIMARY KEY,category TEXT)')
        copy.execute('CREATE TEMP TABLE reporting_allocations(id TEXT,category TEXT,amount REAL,PRIMARY KEY(id,category))')
        def owned_totals(parts):
            totals={}
            for code,amount in parts:
                selected=owned(code);totals[selected]=totals.get(selected,0)+amount
            return totals
        for tid,item,aid,day,amount,primary,detail,flow,merchant,description in copy.execute('''SELECT t.id,t.item,m.ref,t.date,t.amount,t.primary_category,t.detailed_category,t.flow_kind,COALESCE(w.merchant,t.merchant),w.description FROM transactions t LEFT JOIN account_alias m ON m.provider_ref=t.account AND m.item=t.item LEFT JOIN web_transactions w ON w.provider_id=t.id AND w.item=t.item''').fetchall():
            matched=copy.execute('SELECT 1 FROM internal_matches WHERE item=? AND transaction_ref=?',(item,tid)).fetchone()
            txn={'account_id':aid,'amount_cents':-cents(amount),'category':'internal_transfer' if matched else category(primary,detail),'merchant':merchant,'description':description,'date':day,'flow_kind':flow}
            ref=opaque('txn',item,tid)
            edit=edits.get(ref)
            changed_date=override_date(edit.get('date')) if edit else None
            if changed_date:copy.execute('INSERT INTO effective_dates VALUES(?,?)',(tid,changed_date))
            value=evaluate(txn,rules,edit)
            if value['hidden']:copy.execute('DELETE FROM transactions WHERE id=?',(tid,));continue
            allocated=checked_splits(splits.get(ref,[]),txn['amount_cents'])
            parts=allocate(txn['amount_cents'],value['category'],allocated,value['split'])
            if allocated or len(parts)>1:
                copy.executemany('INSERT INTO reporting_allocations VALUES(?,?,?)',[(tid,cat,-amount/100) for cat,amount in owned_totals(parts).items()])
            elif owned(parts[0][0])!=txn['category']:
                copy.execute('INSERT INTO effective_categories VALUES(?,?)',(tid,owned(parts[0][0])))
        copy.execute('CREATE TEMP TABLE reporting_venmo(date TEXT,cents INTEGER,direction TEXT,category TEXT,detailed_category TEXT)')
        wallet=copy.execute("SELECT ref FROM account_alias WHERE provider_ref='virtual:venmo-csv' AND item='venmo-csv'").fetchone()
        for ref,day,amount,direction,raw_category in wallet_rows(copy):
            cat='peer_payment' if raw_category.startswith('peer_') else 'bank_transfer' if raw_category=='bank_transfer' else 'fees' if raw_category=='fee' else 'shopping'
            signed=amount if direction=='in' else -amount
            txn={'account_id':wallet[0] if wallet else None,'amount_cents':signed,'category':cat,'merchant':None,'description':'Venmo payment received' if direction=='in' else 'Venmo payment sent','date':day,'flow_kind':cat if cat in ('peer_payment','bank_transfer') else 'activity'}
            edit=edits.get(ref);value=evaluate(txn,rules,edit)
            day=(override_date(edit.get('date')) if edit else None) or day
            if value['hidden']:continue
            parts=allocate(signed,value['category'],checked_splits(splits.get(ref,[]),signed),value['split'])
            for selected,amount in owned_totals(parts).items():
                detail=raw_category if selected==cat else CATEGORIES[selected][-1]
                copy.execute('INSERT INTO reporting_venmo VALUES(?,?,?,?,?)',(day,abs(amount),'in' if amount>=0 else 'out',selected,detail))
        # Manual entries: a virtual source in the aggregate only. Balances follow
        # every stated balance and manual transaction (hidden ones too, like a
        # bank balance); activity follows the evaluator like any snapshot row.
        copy.execute('CREATE TEMP TABLE reporting_manual_accounts(id TEXT PRIMARY KEY,type TEXT,subtype TEXT,currency TEXT,current REAL,availability TEXT)')
        copy.execute('CREATE TEMP TABLE reporting_manual(day TEXT,account_ref TEXT,category TEXT,detailed_category TEXT,currency TEXT,amount REAL)')
        today=datetime.now(timezone.utc).date().isoformat()
        currencies={}
        for a in manual_accounts:
            if a['type'] not in MANUAL_TYPES:raise ValueError('Invalid manual entry')
            currency=a['currency'] if isinstance(a['currency'],str) and re.fullmatch(r'[A-Z]{3}',a['currency']) else 'UNKNOWN'
            currencies[a['id']]=currency
            stated=[(manual_day(d),c) for aid,d,c in statements if aid==a['id']]
            moved=[(manual_day(t['date']),t['amount_cents']) for t in manual_txns if t['account_id']==a['id']]
            if any(not is_int(c) for _,c in stated+moved):raise ValueError('Invalid manual entry')
            balance=None if a['closed_at'] else manual_balance(MANUAL_TYPES[a['type']],stated,moved,today)
            copy.execute('INSERT INTO reporting_manual_accounts VALUES(?,?,?,?,?,?)',(manual_refs[a['id']],MANUAL_TYPES[a['type']],a['type'],currency,None if balance is None else balance/100,'historical' if a['closed_at'] else 'available'))
        for t in manual_txns:
            if t['account_id'] not in manual_refs:continue
            txn={'account_id':t['account_id'],'amount_cents':t['amount_cents'],'category':t['category'],'merchant':t['merchant'],'description':None,'date':t['date'],'flow_kind':'activity'}
            edit=edits.get(t['id']);value=evaluate(txn,rules,edit)
            if value['hidden']:continue
            day=(override_date(edit.get('date')) if edit else None) or t['date']
            parts=allocate(t['amount_cents'],value['category'],checked_splits(splits.get(t['id'],[]),t['amount_cents']),value['split'])
            for selected,amount in owned_totals(parts).items():
                copy.execute('INSERT INTO reporting_manual VALUES(?,?,?,?,?,?)',(day,manual_refs[t['account_id']],selected,CATEGORIES[selected][-1],currencies[t['account_id']],-amount/100))
        register_dates(copy)
        copy.commit()
        yield copy
    finally:
        app.close();copy.close()
