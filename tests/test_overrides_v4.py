"""App schema v4 evaluator and manual entries in MCP aggregates. Invented data only."""
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from detail import opaque
from overrides import resolve, rule_list, manual_balance

VECTORS = Path(__file__).with_name('overrides-v4-vectors.json')
APP_V4 = '''CREATE TABLE schema_version(version INTEGER NOT NULL);INSERT INTO schema_version VALUES(4);
CREATE TABLE txn_overrides(txn_id TEXT PRIMARY KEY,category TEXT,merchant TEXT,note TEXT,hidden INTEGER,reviewed INTEGER,updated_at TEXT NOT NULL DEFAULT '',date TEXT);
CREATE TABLE rules(id TEXT PRIMARY KEY,position INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,match_json TEXT NOT NULL,action_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT '',applies_from TEXT);
CREATE TABLE account_overrides(account_id TEXT PRIMARY KEY,display_name TEXT,hidden INTEGER NOT NULL DEFAULT 0,exclude_net_worth INTEGER NOT NULL DEFAULT 0);
CREATE TABLE categories(code TEXT PRIMARY KEY,label TEXT NOT NULL DEFAULT '',grp TEXT NOT NULL DEFAULT 'expense',parent TEXT,hidden INTEGER NOT NULL DEFAULT 0,sort INTEGER,icon TEXT,color TEXT,merged_into TEXT,budget_kind TEXT);
CREATE TABLE txn_splits(txn_id TEXT NOT NULL,idx INTEGER NOT NULL,amount_cents INTEGER NOT NULL,category TEXT NOT NULL,note TEXT,PRIMARY KEY(txn_id,idx));
CREATE TABLE manual_accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,currency TEXT NOT NULL DEFAULT 'USD',created_at TEXT NOT NULL DEFAULT '',closed_at TEXT);
CREATE TABLE manual_balances(account_id TEXT NOT NULL,date TEXT NOT NULL,cents INTEGER NOT NULL,PRIMARY KEY(account_id,date));
CREATE TABLE manual_txns(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,date TEXT NOT NULL,amount_cents INTEGER NOT NULL,merchant TEXT,category TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT '');'''


@pytest.mark.parametrize('vector',json.loads(VECTORS.read_text())['vectors'],ids=lambda v:v['name'])
def test_shared_v4_vectors(vector):
    rows=[{'id':r['id'],'position':r['position'],'enabled':r['enabled'],'applies_from':r['applies_from'],
        'match_json':r.get('match_json') or json.dumps(r['match']),'action_json':r.get('action_json') or json.dumps(r['action'])} for r in vector['rules']]
    assert resolve(vector['txn'],rule_list(rows),vector['override'],vector['splits'],vector['categories'])==vector['expected']


def test_manual_balance_rule():
    statements=[('2026-10-01',10000),('2026-10-10',50000)]
    txns=[('2026-10-05',-2500),('2026-10-10',-100),('2026-10-11',-700),('2026-10-20',300)]
    assert manual_balance('depository',statements,txns,'2026-10-09')==7500
    assert manual_balance('depository',statements,txns,'2026-10-10')==50000  # same-day activity precedes the statement
    assert manual_balance('depository',statements,txns,'2026-10-31')==49600
    assert manual_balance('credit',[('2026-10-01',2000)],[('2026-10-02',-500),('2026-10-03',200)],'2026-10-31')==2300
    assert manual_balance('loan',[],[('2026-10-02',-500)],'2026-10-01') is None
    assert manual_balance('loan',[],[('2026-10-02',-500)],'2026-10-02')==500
    assert manual_balance('other',[],[],'2026-10-02') is None


def app_db(tmp_path,script=''):
    path=tmp_path/'app.sqlite'
    with sqlite3.connect(path) as app:app.executescript(APP_V4+script)
    return path


def test_v4_merge_custom_top_level_and_rule_split_in_aggregates(snapshot,tmp_path,monkeypatch):
    from store import publish
    db,aggregate=snapshot
    app=app_db(tmp_path)
    with sqlite3.connect(app) as edits:
        edits.execute("INSERT INTO categories(code,label,grp,parent,merged_into) VALUES('food','Food','expense',NULL,'shopping')")
        edits.execute("INSERT INTO categories(code,label,grp,parent) VALUES('cat_top','PRIVATE LABEL SENTINEL','expense',NULL)")
        edits.execute("INSERT INTO categories(code,label,grp,parent) VALUES('cat_lost','Lost','expense','cat_missing')")
        edits.execute("INSERT INTO rules(id,position,match_json,action_json) VALUES('rule_a',0,?,?)",(json.dumps({'amount_min_cents':10000,'amount_max_cents':10000,'any':[{'merchant_starts_with':'secret fixture'},{'flow_kind':'peer_payment'}]}),json.dumps({'split':[{'category':'cat_top','percent':2500},{'category':'health','percent':7500}]})))
        edits.execute("INSERT INTO rules(id,position,match_json,action_json,applies_from) VALUES('rule_b',1,?,?,'2026-11-04')",(json.dumps({'amount_max_cents':2000,'direction':'out'}),json.dumps({'category':'travel'})))
        edits.execute("INSERT INTO rules(id,position,match_json,action_json) VALUES('rule_c',2,?,?)",(json.dumps({'merchant_regex':'.*'}),json.dumps({'hide':True})))
    monkeypatch.setenv('MONEY_APP_DB',str(app));publish(db,aggregate)
    with sqlite3.connect(aggregate) as public:
        totals=dict(public.execute("SELECT category,ROUND(SUM(spending),2) FROM daily WHERE day>='2026-11-01' GROUP BY category"))
        october=dict(public.execute("SELECT category,SUM(spending) FROM daily WHERE day<'2026-11-01' GROUP BY category"))
    # Tx 2 (100) splits 25/75, tx 3 (20, on applies_from) becomes travel, refund tx 4 (food) merges into shopping.
    assert totals=={'other':25.0,'health':75.0,'travel':20.0,'shopping':-10.0,'income':0.0,'bank_transfer':0.0}
    assert october=={'shopping':80.0}
    assert b'PRIVATE LABEL SENTINEL' not in aggregate.read_bytes() and b'cat_top' not in aggregate.read_bytes()


def test_manual_accounts_publish_generated_labels_balances_and_activity(snapshot,tmp_path,monkeypatch):
    from store import publish
    from queries import Queries
    db,aggregate=snapshot
    today=datetime.now(timezone.utc).date()
    day=lambda n:(today-timedelta(days=n)).isoformat()
    app=app_db(tmp_path)
    with sqlite3.connect(app) as edits:
        edits.executemany('INSERT INTO manual_accounts(id,name,type,currency,closed_at) VALUES(?,?,?,?,?)',[
            ('macct_cash','PRIVATE ACCOUNT NAME SENTINEL','cash','USD',None),('macct_card','Card name','credit','USD',None),
            ('macct_car','Car','vehicle','Private currency text',None),('macct_old','Old','loan','USD','2026-01-01T00:00:00Z')])
        edits.executemany('INSERT INTO manual_balances VALUES(?,?,?)',[('macct_cash',day(40),20000),('macct_card',day(40),5000),('macct_car',day(400),1500000),('macct_old',day(400),900000)])
        edits.executemany('INSERT INTO manual_txns(id,account_id,date,amount_cents,merchant,category) VALUES(?,?,?,?,?,?)',[
            ('mtxn_1','macct_cash',day(3),-1234,'PRIVATE MANUAL MERCHANT SENTINEL','food'),
            ('mtxn_2','macct_cash',day(3),50000,None,'income'),
            ('mtxn_3','macct_cash',day(2),-900,'Hidden by rule','food'),
            ('mtxn_4','macct_card',day(1),-2500,None,'cat_custom'),
            ('mtxn_5','macct_card',day(1),-1000,None,'shopping'),
            ('mtxn_6','macct_gone',day(1),-777,None,'shopping')])
        edits.execute("INSERT INTO categories(code,label,grp,parent) VALUES('cat_custom','Custom','expense','travel')")
        edits.execute("INSERT INTO rules(id,position,match_json,action_json) VALUES('rule_a',0,?,?)",(json.dumps({'merchant_equals':'hidden by rule','account_id':'macct_cash'}),json.dumps({'hide':True})))
        edits.executemany('INSERT INTO txn_splits(txn_id,idx,amount_cents,category) VALUES(?,?,?,?)',[('mtxn_5',0,-600,'health'),('mtxn_5',1,-400,'fees')])
        edits.execute("INSERT INTO txn_overrides(txn_id,date) VALUES('mtxn_1',?)",(day(60),))
        edits.execute("INSERT INTO account_overrides(account_id,exclude_net_worth) VALUES('macct_car',1)")
    monkeypatch.setenv('MONEY_APP_DB',str(app));publish(db,aggregate)
    q=Queries(aggregate)
    manual=opaque('src','manual')
    source=next(s for s in q.list_sources()['data'] if s['id']==manual)
    assert (source['kind'],source['institution'],source['status'],source['freshness'])==('file_import','Manual entries','healthy','current')
    accounts={a['id']:a for a in q.list_accounts(institution='Manual entries')['data']}
    cash,card,car,old=(accounts[opaque('acct','manual',key)] for key in ('macct_cash','macct_card','macct_car','macct_old'))
    # Hidden activity still moves a balance; an override date does not.
    assert (cash['type'],cash['subtype'],cash['current'],cash['availability'])==('depository','cash',678.66,'available')
    assert (card['type'],card['current'])==('credit',50+25+10)
    assert (car['type'],car['subtype'],car['currency'],car['current'])==('other','vehicle','UNKNOWN',15000)
    assert (old['availability'],old['current'],old['data_kinds'])==('historical',None,['spending'])
    assert cash['display_name']=='Cash '+cash['id'][-6:] and old['display_name'].endswith('(historical)')
    start,end=day(10),(today+timedelta(days=1)).isoformat()
    flow=q.cash_flow('category',start,end,account_ids=[cash['id'],card['id']])['data']
    assert {g['group']:g['spending'] for g in flow['groups'] if g['spending']}=={'travel':25,'health':6,'fees':4}
    assert flow['totals'][0]['income']==500
    moved=q.cash_flow('category',day(70),day(50),account_ids=[cash['id']])['data']
    assert {g['group']:g['spending'] for g in moved['groups']}=={'food':12.34}
    usd=next(t for t in q.balance_summary()['data']['totals'] if t['currency']=='USD')
    assert usd['net_worth']==round(4800+cash['current']-card['current'],2)  # vehicle excluded from net worth
    with sqlite3.connect(aggregate) as public:
        assert public.execute('SELECT exclude_net_worth FROM accounts WHERE id=?',(car['id'],)).fetchone()==(1,)
        # Manual rows never become named merchants: merchant windows read bank rows only.
        assert public.execute("SELECT SUM(purchase_count) FROM merchants WHERE window='all_history' AND scope='all'").fetchone()==(3,)
    raw=aggregate.read_bytes()
    for secret in (b'PRIVATE ACCOUNT NAME SENTINEL',b'PRIVATE MANUAL MERCHANT SENTINEL',b'Hidden by rule',b'macct_',b'mtxn_',b'Private currency text'):
        assert secret not in raw
    # Same opaque ids on the next run.
    publish(db,aggregate)
    assert {a['id'] for a in Queries(aggregate).list_accounts(institution='Manual entries')['data']}==set(accounts)


def test_manual_source_can_be_disabled_and_is_absent_without_manual_accounts(snapshot,tmp_path,monkeypatch):
    from store import publish
    from queries import Queries
    db,aggregate=snapshot
    app=app_db(tmp_path)
    monkeypatch.setenv('MONEY_APP_DB',str(app));publish(db,aggregate)
    assert len(Queries(aggregate).list_sources()['data'])==2
    with sqlite3.connect(app) as edits:
        edits.execute("INSERT INTO manual_accounts(id,name,type) VALUES('macct_x','X','cash')")
    publish(db,aggregate)
    assert len(Queries(aggregate).list_sources()['data'])==3
    monkeypatch.setenv('PLAIDMCP_DISABLED_SOURCES',opaque('src','manual'));publish(db,aggregate)
    assert len(Queries(aggregate).list_sources()['data'])==2


def test_v4_rejects_malformed_manual_rows(snapshot,tmp_path,monkeypatch):
    from store import publish
    db,aggregate=snapshot
    app=app_db(tmp_path,"INSERT INTO manual_accounts(id,name,type) VALUES('macct_x','X','cash');INSERT INTO manual_txns(id,account_id,date,amount_cents,category) VALUES('mtxn_x','macct_x','2026-13-01',5,'food');")
    monkeypatch.setenv('MONEY_APP_DB',str(app))
    with pytest.raises(ValueError):publish(db,aggregate)


def test_unsupported_app_schema_fails_closed(snapshot,tmp_path,monkeypatch):
    from store import publish
    db,aggregate=snapshot
    app=app_db(tmp_path,'UPDATE schema_version SET version=5;')
    monkeypatch.setenv('MONEY_APP_DB',str(app))
    with pytest.raises(ValueError,match='Unsupported'):publish(db,aggregate)
