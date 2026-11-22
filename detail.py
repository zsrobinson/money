"""Credential-free web snapshot. Never imported by the aggregate server.

Only sync opens private state. All SQL projections are explicit so credentials
and future private columns cannot accidentally enter a web snapshot.
"""
import hashlib
import os
import re
import sqlite3
import tempfile
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_EVEN
from pathlib import Path

PRIVATE_SCHEMA = '''
CREATE TABLE IF NOT EXISTS web_accounts(provider_id TEXT PRIMARY KEY, label TEXT, official_name TEXT);
CREATE TABLE IF NOT EXISTS web_transactions(provider_id TEXT PRIMARY KEY, item TEXT, description TEXT, merchant TEXT, logo_url TEXT, website TEXT, authorized_date TEXT, pfc_primary TEXT, pfc_detailed TEXT, pfc_confidence TEXT, payment_channel TEXT);
CREATE TABLE IF NOT EXISTS web_holding_prices(item TEXT,account_id TEXT,security_id TEXT,price REAL,PRIMARY KEY(item,account_id,security_id));
CREATE TABLE IF NOT EXISTS web_balance_history(account_id TEXT,date TEXT,current_cents INTEGER,estimated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,date));
CREATE TABLE IF NOT EXISTS web_holding_history(account_id TEXT,security_id TEXT,date TEXT,quantity REAL,value_cents INTEGER,PRIMARY KEY(account_id,security_id,date));
CREATE TABLE IF NOT EXISTS web_investment_transactions(item TEXT,provider_id TEXT,account TEXT,security_id TEXT,date TEXT,type TEXT,subtype TEXT,quantity REAL,price REAL,amount REAL,fees REAL,PRIMARY KEY(item,provider_id));
CREATE TABLE IF NOT EXISTS web_liabilities(item TEXT,account TEXT,kind TEXT,last_statement_balance REAL,last_statement_date TEXT,minimum_payment REAL,next_payment_due_date TEXT,last_payment REAL,last_payment_date TEXT,apr_percent REAL,is_overdue INTEGER,PRIMARY KEY(item,account));
'''
SCHEMA = '''
CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE sources(id TEXT PRIMARY KEY,kind TEXT,institution TEXT,status TEXT,last_success_at TEXT,data_kinds TEXT);
CREATE TABLE accounts(id TEXT PRIMARY KEY,source_id TEXT,label TEXT,official_name TEXT,type TEXT,subtype TEXT,mask TEXT,currency TEXT,current_cents INTEGER,available_cents INTEGER,limit_cents INTEGER,availability TEXT,scope TEXT);
CREATE TABLE transactions(id TEXT PRIMARY KEY,account_id TEXT,date TEXT,amount_cents INTEGER,currency TEXT,merchant TEXT,description TEXT,category TEXT,detailed_category TEXT,flow_kind TEXT,pending INTEGER,transfer_pair_id TEXT,authorized_date TEXT,logo_url TEXT,website TEXT,pfc_primary TEXT,pfc_detailed TEXT,pfc_confidence TEXT,payment_channel TEXT);
CREATE TABLE balance_history(account_id TEXT,date TEXT,current_cents INTEGER,estimated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account_id,date));
CREATE TABLE holdings(account_id TEXT,security_id TEXT,ticker TEXT,name TEXT,type TEXT,currency TEXT,quantity REAL,price REAL,value_cents INTEGER,cost_basis_cents INTEGER);
CREATE TABLE holding_history(account_id TEXT,security_id TEXT,date TEXT,quantity REAL,value_cents INTEGER,PRIMARY KEY(account_id,security_id,date));
CREATE TABLE recurring_hints(source_id TEXT,merchant TEXT,currency TEXT,frequency TEXT,last_charged_month TEXT,active INTEGER,PRIMARY KEY(source_id,merchant));
CREATE TABLE categories(code TEXT PRIMARY KEY,label TEXT,"group" TEXT,parent TEXT,sort INTEGER);
CREATE TABLE investment_transactions(id TEXT PRIMARY KEY,account_id TEXT,security_id TEXT,date TEXT,type TEXT,subtype TEXT,quantity REAL,price REAL,amount_cents INTEGER,fees_cents INTEGER);
CREATE TABLE liabilities(account_id TEXT PRIMARY KEY,kind TEXT,last_statement_balance_cents INTEGER,last_statement_date TEXT,minimum_payment_cents INTEGER,next_payment_due_date TEXT,last_payment_cents INTEGER,last_payment_date TEXT,apr_percent REAL,is_overdue INTEGER);
CREATE INDEX transactions_date ON transactions(date, id);
CREATE INDEX transactions_account ON transactions(account_id,date);
CREATE INDEX investment_transactions_account ON investment_transactions(account_id,date);
'''


def opaque(prefix, *parts):
    return prefix + '_' + hashlib.sha256('\0'.join(str(p) for p in parts).encode()).hexdigest()


def cents(value):
    return None if value is None else int((Decimal(str(value))*100).quantize(Decimal(1),rounding=ROUND_HALF_EVEN))


def wallet_rows(db):
    """Stable IDs preserve duplicate multiplicity without retaining import IDs."""
    from collections import Counter
    counts=Counter()
    for day,amount,direction,cat in db.execute('SELECT date,cents,direction,category FROM venmo_rows ORDER BY date,cents,direction,category,rowid'):
        key=(day,amount,direction,cat);ordinal=counts[key];counts[key]+=1
        yield opaque('txn','csv',day,amount,direction,cat,ordinal),day,amount,direction,cat


def ingest_accounts(db, accounts):
    db.executemany('INSERT OR REPLACE INTO web_accounts VALUES(?,?,?)',
                   [(a['account_id'], a.get('name'), a.get('official_name')) for a in accounts])


def ingest_transactions(db, item, page, is_venmo):
    for t in page.get('added', []) + page.get('modified', []):
        p = t.get('personal_finance_category') or {}
        # Peer names, notes, counterparties, original_description and arbitrary
        # provider payloads are never retained, even in the web detail tables.
        description = ('Venmo payment received' if t['amount'] < 0 else 'Venmo payment sent') if is_venmo else t.get('name')
        db.execute('INSERT OR REPLACE INTO web_transactions VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                   (t['transaction_id'],item,description,None if is_venmo else t.get('merchant_name'),
                    None if is_venmo else t.get('logo_url'),None if is_venmo else t.get('website'),
                    t.get('authorized_date'),p.get('primary'),p.get('detailed'),p.get('confidence_level'),t.get('payment_channel')))
    for t in page.get('removed', []):
        db.execute('DELETE FROM web_transactions WHERE provider_id=? AND item=?',(t['transaction_id'],item))


def ingest_holdings(db,item,data):
    securities={s['security_id']:s for s in data['securities']}
    db.execute('DELETE FROM web_holding_prices WHERE item=?',(item,))
    for h in data['holdings']:
        s=securities.get(h['security_id'],{})
        security=security_ref(s)
        db.execute('INSERT OR REPLACE INTO web_holding_prices VALUES(?,?,?,?)',(item,h['account_id'],security,h.get('institution_price')))


def security_ref(s):
    """Same opaque security id as holdings."""
    return opaque('sec',s.get('ticker_symbol') or '',s.get('name') or '',s.get('type','unknown') or '')


def day_or_none(value):
    if value is None:return None
    if not isinstance(value,str) or date.fromisoformat(value).isoformat()!=value:raise ValueError('Invalid provider date')
    return value


def enum_or_none(value):
    # Provider enums only (buy, sell, dividend, ...); never free text.
    return value if isinstance(value,str) and re.fullmatch(r'[a-z][a-z ]{0,39}',value) else None


def number_or_none(value):
    if value is None:return None
    if isinstance(value,bool) or not isinstance(value,(int,float)):raise ValueError('Invalid provider number')
    return value


def ingest_investment_transactions(db,item,data):
    """Replace the fetched window. Names and cancel references are never retained."""
    securities={s['security_id']:s for s in data.get('securities',[])}
    rows=[]
    for t in data['investment_transactions']:
        security=security_ref(securities.get(t['security_id'],{})) if t.get('security_id') else None
        rows.append((item,t['investment_transaction_id'],t['account_id'],security,day_or_none(t['date']),enum_or_none(t.get('type')),enum_or_none(t.get('subtype')),
            number_or_none(t.get('quantity')),number_or_none(t.get('price')),number_or_none(t['amount']),number_or_none(t.get('fees'))))
    db.execute('DELETE FROM web_investment_transactions WHERE item=? AND date>=?',(item,day_or_none(data['start_date'])))
    db.executemany('INSERT OR REPLACE INTO web_investment_transactions VALUES(?,?,?,?,?,?,?,?,?,?,?)',rows)


def ingest_liabilities(db,item,data):
    """Bill fields only: no account numbers, addresses, servicer or loan names."""
    rows=[]
    groups=data.get('liabilities') or {}
    for c in groups.get('credit') or []:
        aprs=[a for a in c.get('aprs') or [] if isinstance(a,dict)]
        apr=next((a for a in aprs if a.get('apr_type')=='purchase_apr'),aprs[0] if aprs else {})
        rows.append((c['account_id'],'credit',c.get('last_statement_balance'),c.get('last_statement_issue_date'),c.get('minimum_payment_amount'),c.get('next_payment_due_date'),c.get('last_payment_amount'),c.get('last_payment_date'),apr.get('apr_percentage'),c.get('is_overdue')))
    for s in groups.get('student') or []:
        rows.append((s['account_id'],'student',s.get('last_statement_balance'),s.get('last_statement_issue_date'),s.get('minimum_payment_amount'),s.get('next_payment_due_date'),s.get('last_payment_amount'),s.get('last_payment_date'),s.get('interest_rate_percentage'),s.get('is_overdue')))
    for m in groups.get('mortgage') or []:
        past=number_or_none(m.get('past_due_amount'))
        rows.append((m['account_id'],'mortgage',None,None,m.get('next_monthly_payment'),m.get('next_payment_due_date'),m.get('last_payment_amount'),m.get('last_payment_date'),(m.get('interest_rate') or {}).get('percentage'),None if past is None else past>0))
    checked=[]
    for account,kind,balance,statement,minimum,due,paid,paid_on,apr,overdue in rows:
        if overdue is not None and not isinstance(overdue,bool):raise ValueError('Invalid provider flag')
        checked.append((item,account,kind,number_or_none(balance),day_or_none(statement),number_or_none(minimum),day_or_none(due),number_or_none(paid),day_or_none(paid_on),number_or_none(apr),None if overdue is None else int(overdue)))
    db.execute('DELETE FROM web_liabilities WHERE item=?',(item,))
    db.executemany('INSERT OR REPLACE INTO web_liabilities VALUES(?,?,?,?,?,?,?,?,?,?,?)',checked)


def record_history(db, today=None):
    today = today or datetime.now(timezone.utc).date().isoformat()
    for account,balance in db.execute('SELECT m.ref,a.current FROM accounts a JOIN account_alias m ON m.provider_ref=a.id AND m.item=a.item JOIN items i ON i.id=a.item WHERE a.active=1 AND a.current IS NOT NULL AND i.error IS NULL AND substr(i.as_of,1,10)=?',(today,)):
        db.execute('INSERT OR REPLACE INTO web_balance_history VALUES(?,?,?,0)',(account,today,cents(balance)))
    for account,ticker,name,kind,quantity,value in db.execute('SELECT m.ref,h.ticker,h.name,h.type,h.quantity,h.value FROM holdings h JOIN account_alias m ON m.provider_ref=h.account AND m.item=h.item JOIN items i ON i.id=h.item WHERE i.error IS NULL AND substr(i.as_of,1,10)=?',(today,)):
        security=opaque('sec',ticker or '',name or '',kind or '')
        db.execute('INSERT OR REPLACE INTO web_holding_history VALUES(?,?,?,?,?)',(account,security,today,quantity,cents(value)))


def reconstruct_history(db, today=None):
    """Back-calculate cash/liability balances; never invent historical asset prices.

    Estimated values ignore pending activity and never replace observed snapshots.
    Credit/loan balances move in the opposite direction from cash balances.
    """
    today = date.fromisoformat(today) if today else datetime.now(timezone.utc).date()
    for provider,item,account,kind,current in db.execute('SELECT a.id,a.item,m.ref,a.type,a.current FROM accounts a JOIN account_alias m ON m.provider_ref=a.id AND m.item=a.item WHERE a.active=1 AND a.current IS NOT NULL'):
        if kind in ('investment','brokerage'): continue
        rows=db.execute('SELECT date,SUM(amount) FROM transactions WHERE account=? AND item=? AND pending=0 AND date<=? GROUP BY date ORDER BY date DESC',(provider,item,today.isoformat())).fetchall()
        if not rows: continue
        changes={d:cents(v) for d,v in rows}; earliest=date.fromisoformat(min(changes))
        # Do not extrapolate indefinitely from malformed or very old upstream data.
        earliest=max(earliest,today-timedelta(days=36525))
        balance=cents(current); day=today
        while day>=earliest:
            observed=db.execute('SELECT current_cents FROM web_balance_history WHERE account_id=? AND date=? AND estimated=0',(account,day.isoformat())).fetchone()
            if observed:balance=observed[0]
            db.execute('INSERT INTO web_balance_history VALUES(?,?,?,1) ON CONFLICT(account_id,date) DO UPDATE SET current_cents=excluded.current_cents WHERE estimated=1',(account,day.isoformat(),balance))
            balance += changes.get(day.isoformat(),0) * (-1 if kind in ('credit','loan') else 1)
            day -= timedelta(days=1)


def publish(db, path):
    from sources import snapshot_sources
    from account_scope import separate_accounts
    from taxonomy import CATEGORIES, category, detailed
    from transfers import match_internal
    match_internal(db)
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(dir=path.parent,prefix='.detail-');os.close(fd)
    out=sqlite3.connect(temp)
    try:
        out.executescript(SCHEMA)
        out.executemany('INSERT INTO meta VALUES(?,?)',[('schema_version','2'),('generated_at',datetime.now(timezone.utc).isoformat())])
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='optional_product_status'").fetchone():
            for product,status in db.execute('SELECT product,status FROM optional_product_status'):
                if product in {'investments','liabilities'} and status in {'ok','relink_required','unavailable'}:
                    out.execute('INSERT INTO meta VALUES(?,?)',(product+'_status',status))
        separate=separate_accounts(db)
        for source in snapshot_sources(db):
            snap=source.read_snapshot(db)
            for sid,institution,kind,as_of,status,kinds in snap.get('sources',[]):
                out.execute('INSERT INTO sources VALUES(?,?,?,?,?,?)',(sid,kind,institution,'healthy' if status=='healthy' else 'error',as_of,kinds))
            for a in snap.get('accounts',[]):
                aid,sid,label,institution,kind,subtype,currency,current,available,limit,mask,kinds,availability=a
                names=db.execute('SELECT w.label,w.official_name,a.mask FROM accounts a JOIN account_alias m ON m.provider_ref=a.id AND m.item=a.item LEFT JOIN web_accounts w ON w.provider_id=a.id WHERE m.ref=? ORDER BY a.active DESC LIMIT 1',(aid,)).fetchone()
                out.execute('INSERT OR REPLACE INTO accounts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(aid,sid,(names[0] if names else None) or label,names[1] if names else None,kind,subtype,names[2] if names else None,currency,cents(current),cents(available),cents(limit),availability,'separate' if aid in separate else 'own'))
        # Disabled feeds remain visible as metadata in Settings, without
        # republishing their accounts, transactions or holdings.
        from sources import enabled,source_ref
        for item,institution,as_of in db.execute('SELECT id,institution,as_of FROM items'):
            if not enabled(db,item):
                out.execute('INSERT INTO sources VALUES(?,?,?,?,?,?)',(source_ref(db,item),'file_import' if item=='venmo-csv' else 'connection',institution,'disabled',as_of,'[]'))
        for r in db.execute('''SELECT t.id,t.item,m.ref,t.date,t.amount,t.currency,t.merchant,t.primary_category,t.detailed_category,t.flow_kind,t.pending,w.description,w.merchant,w.authorized_date,w.logo_url,w.website,w.pfc_primary,w.pfc_detailed,w.pfc_confidence,w.payment_channel,x.paired_item,x.paired_ref
        FROM transactions t JOIN account_alias m ON m.provider_ref=t.account AND m.item=t.item LEFT JOIN web_transactions w ON w.provider_id=t.id AND w.item=t.item LEFT JOIN internal_matches x ON x.item=t.item AND x.transaction_ref=t.id'''):
            tid,item,aid,day,amount,currency,merchant,primary,detail,flow,pending,description,raw_merchant,authorized,logo,website,pfc,pfcd,confidence,channel,paired_item,paired_ref=r
            if not out.execute('SELECT 1 FROM accounts WHERE id=?',(aid,)).fetchone():continue
            pair=opaque('pair',*sorted([opaque('txn',item,tid),opaque('txn',paired_item,paired_ref)])) if paired_ref else None
            cat='internal_transfer' if pair else category(primary,detail)
            out.execute('INSERT INTO transactions VALUES('+','.join('?'*19)+')',(opaque('txn',item,tid),aid,day,-cents(amount),currency,raw_merchant or merchant,description,cat,'internal_transfer' if pair else detailed(primary,detail),flow,pending,pair,authorized,logo,website,pfc,pfcd,confidence,channel))
        # Sanitized CSV rows have no provider IDs or text. Stable ordinal preserves
        # duplicate genuine rows without exposing filenames or import metadata.
        wallet=out.execute("SELECT a.id FROM accounts a JOIN sources s ON s.id=a.source_id WHERE a.subtype='wallet' AND s.id=?",(source_ref(db,'venmo-csv'),)).fetchone() if db.execute("SELECT 1 FROM items WHERE id='venmo-csv'").fetchone() else None
        if wallet:
            for tid,day,amount,direction,cat in wallet_rows(db):
                group='peer_payment' if cat.startswith('peer_') else 'bank_transfer' if cat=='bank_transfer' else 'fees' if cat=='fee' else 'shopping'
                out.execute('INSERT INTO transactions(id,account_id,date,amount_cents,currency,description,category,detailed_category,flow_kind,pending) VALUES(?,?,?,?,?,?,?,?,?,0)',(tid,wallet[0],day,amount if direction=='in' else -amount,'USD','Venmo payment received' if direction=='in' else 'Venmo payment sent',group,cat,group if group in ('peer_payment','bank_transfer') else 'activity'))
        for row in db.execute('SELECT * FROM web_balance_history'):
            if out.execute('SELECT 1 FROM accounts WHERE id=?',(row[0],)).fetchone():out.execute('INSERT INTO balance_history VALUES(?,?,?,?)',row)
        for aid,ticker,name,kind,currency,quantity,value,basis in db.execute('SELECT m.ref,h.ticker,h.name,h.type,h.currency,h.quantity,h.value,h.cost_basis FROM holdings h JOIN account_alias m ON m.provider_ref=h.account AND m.item=h.item'):
            if out.execute('SELECT 1 FROM accounts WHERE id=?',(aid,)).fetchone():
                security=opaque('sec',ticker or '',name or '',kind or '')
                price=db.execute('SELECT p.price FROM web_holding_prices p JOIN account_alias m ON m.provider_ref=p.account_id AND m.item=p.item WHERE m.ref=? AND p.security_id=?',(aid,security)).fetchone()
                price=price[0] if price and price[0] is not None else value/quantity if quantity else None
                out.execute('INSERT INTO holdings VALUES(?,?,?,?,?,?,?,?,?,?)',(aid,security,ticker,name,kind,currency,quantity,price,cents(value),cents(basis)))
        for row in db.execute('SELECT * FROM web_holding_history'):
            if out.execute('SELECT 1 FROM accounts WHERE id=?',(row[0],)).fetchone():out.execute('INSERT INTO holding_history VALUES(?,?,?,?,?)',row)
        # Investment amounts follow transactions: cash into the account is positive.
        for item,provider,account,security,day,kind,subtype,quantity,price,amount,fees in db.execute('SELECT w.item,w.provider_id,m.ref,w.security_id,w.date,w.type,w.subtype,w.quantity,w.price,w.amount,w.fees FROM web_investment_transactions w JOIN account_alias m ON m.provider_ref=w.account AND m.item=w.item ORDER BY w.date,w.item,w.provider_id'):
            if out.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():
                out.execute('INSERT INTO investment_transactions VALUES(?,?,?,?,?,?,?,?,?,?)',(opaque('itx',item,provider),account,security,day,kind,subtype,quantity,price,None if amount is None else -cents(amount),cents(fees)))
        for account,*bill in db.execute('SELECT m.ref,w.kind,w.last_statement_balance,w.last_statement_date,w.minimum_payment,w.next_payment_due_date,w.last_payment,w.last_payment_date,w.apr_percent,w.is_overdue FROM web_liabilities w JOIN account_alias m ON m.provider_ref=w.account AND m.item=w.item ORDER BY w.item,w.account'):
            if out.execute('SELECT 1 FROM accounts WHERE id=?',(account,)).fetchone():
                kind,balance,statement,minimum,due,paid,paid_on,apr,overdue=bill
                out.execute('INSERT OR REPLACE INTO liabilities VALUES(?,?,?,?,?,?,?,?,?,?)',(account,kind,cents(balance),statement,cents(minimum),due,cents(paid),paid_on,apr,overdue))
        for item,merchant,currency,frequency,month,active in db.execute('SELECT item,merchant,currency,frequency,last_charged_month,active FROM recurring_merchants'):
            from sources import source_ref
            sid=source_ref(db,item)
            if out.execute('SELECT 1 FROM sources WHERE id=? AND status!=\'disabled\'',(sid,)).fetchone():out.execute('INSERT INTO recurring_hints VALUES(?,?,?,?,?,?)',(sid,merchant,currency,frequency,month,active))
        for i,(code,values) in enumerate(CATEGORIES.items()):
            # The web app counts peer payments in spending by default; MCP keeps them separate.
            group='income' if code=='income' else 'transfer' if code in ('bank_transfer','internal_transfer') else 'expense'
            out.execute('INSERT INTO categories VALUES(?,?,?,?,?)',(code,values[0],group,None,i))
        out.commit();out.close();os.chmod(temp,0o640)
        with open(temp,'rb') as f:os.fsync(f.fileno())
        db.commit();os.replace(temp,path)
    finally:
        out.close()
        if os.path.exists(temp):os.unlink(temp)


def validate_paths(private_root,aggregate,detail,app):
    """Fail closed before publication if a detail path aliases protected stores."""
    paths=[Path(private_root).resolve()/'private.sqlite',Path(aggregate).resolve(),Path(detail).resolve()]
    if app:paths.append(Path(app).resolve())
    if len(set(paths))!=len(paths):raise ValueError('Money databases require distinct paths')
    if paths[1].parent==paths[2].parent:raise ValueError('Detail and aggregate require separate access directories')
