"""All values below are invented; these tests never open deployment paths."""
import sqlite3
from datetime import date
from detail import publish, record_history, reconstruct_history, opaque
from store import ingest_transactions
from overrides import evaluate


def test_detail_is_separate_and_credential_free(snapshot,tmp_path):
    db,aggregate=snapshot
    db.execute("CREATE TABLE IF NOT EXISTS credentials(item TEXT, token TEXT)")
    db.execute("INSERT INTO credentials(item,token) VALUES('bank','fixture-secret-never-publish')")
    ingest_transactions(db,'bank',{'added':[{'transaction_id':'fixture-detail','account_id':'check','date':'2026-10-02','amount':19.25,'name':'Invented private description','merchant_name':'Invented shop','personal_finance_category':{'primary':'FOOD_AND_DRINK','detailed':'FOOD_AND_DRINK_GROCERIES','confidence_level':'HIGH'}}]})
    record_history(db,'2026-10-03');reconstruct_history(db,'2026-10-03')
    target=tmp_path/'detail.sqlite';publish(db,target)
    with sqlite3.connect(target) as out:
        assert out.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()==('1',)
        assert 'credentials' not in {r[0] for r in out.execute('SELECT name FROM sqlite_master')}
        assert out.execute('SELECT COUNT(*) FROM balance_history').fetchone()[0]>0
        assert out.execute('SELECT description,amount_cents FROM transactions WHERE id=?',(opaque('txn','bank','fixture-detail'),)).fetchone()==('Invented private description',-1925)
    assert b'fixture-secret-never-publish' not in target.read_bytes()
    assert b'Invented private description' not in aggregate.read_bytes()


def test_peer_detail_never_keeps_names_or_notes(snapshot):
    db,_=snapshot
    db.execute("UPDATE items SET institution='Venmo' WHERE id='bank'")
    ingest_transactions(db,'bank',{'added':[{'transaction_id':'peer-fixture','date':'2026-10-02','amount':5,'name':'Private Person Fixture','merchant_name':'Private Person Fixture','notes':'secret fixture note','personal_finance_category':{}}]})
    row=db.execute("SELECT description,merchant,logo_url,website FROM web_transactions WHERE provider_id='peer-fixture'").fetchone()
    assert row==('Venmo payment sent',None,None,None)


def test_rules_are_first_field_wins_snapshot_based_and_overrides_win():
    txn={'category':'food','merchant':'  Invented  SHOP ','description':None,'account_id':'acct_fixture','amount_cents':-500}
    rules=[({'merchant_contains':'invented shop'},{'category':'shopping'}),({'category':'shopping'},{'hide':True}),({'category':'food'},{'category':'housing','mark_reviewed':True})]
    result=evaluate(txn,rules,{'category':'travel','hidden':0})
    assert result=={'category':'travel','merchant':txn['merchant'],'hidden':0,'reviewed':True}


def test_overrides_change_aggregate_without_disclosing_edits(snapshot,tmp_path,monkeypatch):
    from store import publish as aggregate_publish
    from queries import Queries
    db,aggregate=snapshot
    app=tmp_path/'app.sqlite'
    with sqlite3.connect(app) as edits:
        edits.executescript('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(2);CREATE TABLE account_overrides(account_id TEXT,exclude_net_worth INTEGER);CREATE TABLE categories(code TEXT,parent TEXT);CREATE TABLE txn_splits(txn_id TEXT,idx INTEGER,amount_cents INTEGER,category TEXT);CREATE TABLE rules(id TEXT,position INTEGER,enabled INTEGER,match_json TEXT,action_json TEXT);CREATE TABLE txn_overrides(txn_id TEXT,category TEXT,merchant TEXT,hidden INTEGER,reviewed INTEGER);')
        edits.execute('INSERT INTO txn_overrides VALUES(?,?,?,?,?)',(opaque('txn','bank','2'),'shopping','PRIVATE EDIT DISPLAY SENTINEL',0,1))
        edits.execute('INSERT INTO txn_overrides VALUES(?,?,?,?,?)',(opaque('txn','bank','3'),None,None,1,0))
    monkeypatch.setenv('MONEY_APP_DB',str(app))
    aggregate_publish(db,aggregate)
    result=Queries(aggregate).cash_flow('category','2026-11-01','2026-12-01')['data']
    assert result['totals'][0]['spending']==90
    assert b'PRIVATE EDIT DISPLAY SENTINEL' not in aggregate.read_bytes()
    # Edits do not overwrite original ingestion records.
    assert db.execute("SELECT primary_category FROM transactions WHERE id='2'").fetchone()==('FOOD_AND_DRINK',)


def test_custom_category_splits_map_to_owned_totals(snapshot,tmp_path,monkeypatch):
    from store import publish as aggregate_publish
    from queries import Queries
    db,aggregate=snapshot
    app=tmp_path/'app.sqlite'
    with sqlite3.connect(app) as edits:
        edits.executescript('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(2);CREATE TABLE account_overrides(account_id TEXT,exclude_net_worth INTEGER);CREATE TABLE categories(code TEXT,parent TEXT);CREATE TABLE txn_splits(txn_id TEXT,idx INTEGER,amount_cents INTEGER,category TEXT);CREATE TABLE rules(id TEXT,position INTEGER,enabled INTEGER,match_json TEXT,action_json TEXT);CREATE TABLE txn_overrides(txn_id TEXT,category TEXT,merchant TEXT,hidden INTEGER,reviewed INTEGER);')
        aid=db.execute("SELECT ref FROM account_alias WHERE provider_ref='check' AND item='bank'").fetchone()[0]
        edits.execute('INSERT INTO account_overrides VALUES(?,1)',(aid,))
        edits.execute('INSERT INTO categories VALUES(?,?)',('cat_fixture','shopping'))
        edits.executemany('INSERT INTO txn_splits VALUES(?,?,?,?)',[(opaque('txn','bank','2'),0,-6000,'cat_fixture'),(opaque('txn','bank','2'),1,-4000,'food')])
    monkeypatch.setenv('MONEY_APP_DB',str(app));aggregate_publish(db,aggregate)
    with sqlite3.connect(aggregate) as public:
        assert public.execute("SELECT SUM(spending) FROM daily WHERE category='shopping'").fetchone()==(60.0,)
        assert public.execute("SELECT SUM(spending) FROM daily WHERE category='food' AND day>='2026-11-01'").fetchone()==(50.0,)
    assert b'cat_fixture' not in aggregate.read_bytes()
    q=Queries(aggregate)
    assert q.balance_summary()['data']['totals'][0]['net_worth']==2800
    assert q.balance_summary()['data']['totals'][0]['cash']==2000
    assert any(a['id']==aid for a in q.list_accounts()['data'])


def test_normalization_matches_shared_web_vectors():
    import json
    from pathlib import Path
    from overrides import normalize
    vectors=Path(__file__).resolve().parents[1]/'web/tests/normalize-vectors.json'
    for vector in json.loads(vectors.read_text()):
        assert normalize(vector['input'])==vector['expected']


def test_publication_paths_cannot_share_privileges(tmp_path):
    import pytest
    from detail import validate_paths
    with pytest.raises(ValueError):validate_paths(tmp_path/'private',tmp_path/'aggregate.sqlite',tmp_path/'detail.sqlite',None)
    with pytest.raises(ValueError):validate_paths(tmp_path/'private',tmp_path/'aggregate.sqlite',tmp_path/'aggregate.sqlite',None)
    validate_paths(tmp_path/'private',tmp_path/'aggregate/aggregate.sqlite',tmp_path/'detail/detail.sqlite',tmp_path/'app/app.sqlite')


def test_reconstruction_signs_pending_and_observation_anchors(tmp_path):
    from store import connect, ingest_accounts
    db=connect(tmp_path/'fixture.sqlite')
    try:
        db.execute("INSERT INTO items VALUES('bank','Example Bank','2026-11-10T12:00:00+00:00',NULL)")
        ingest_accounts(db,'bank',[{'account_id':key,'name':key,'type':kind,'subtype':subtype,'balances':{'current':balance,'iso_currency_code':'USD'}} for key,kind,subtype,balance in [('cash','depository','checking',1000),('card','credit','credit card',200)]])
        ingest_transactions(db,'bank',{'added':[{'transaction_id':key,'account_id':account,'date':day,'amount':amount,'pending':pending} for key,account,day,amount,pending in [('cash-today','cash','2026-11-10',50,False),('cash-before','cash','2026-11-09',30,False),('cash-older','cash','2026-11-08',10,False),('cash-pending','cash','2026-11-10',900,True),('card-today','card','2026-11-10',20,False),('card-before','card','2026-11-09',-40,False)]]})
        refs=dict(db.execute('SELECT provider_ref,ref FROM account_alias'))
        record_history(db,'2026-11-10');reconstruct_history(db,'2026-11-10')
        assert db.execute('SELECT current_cents,estimated FROM web_balance_history WHERE account_id=? AND date=?',(refs['cash'],'2026-11-09')).fetchone()==(105000,1)
        assert db.execute('SELECT current_cents,estimated FROM web_balance_history WHERE account_id=? AND date=?',(refs['card'],'2026-11-09')).fetchone()==(18000,1)
        assert db.execute('SELECT current_cents,estimated FROM web_balance_history WHERE account_id=? AND date=?',(refs['cash'],'2026-11-10')).fetchone()==(100000,0)
        # An actual earlier observation supersedes a reconstruction anchor.
        db.execute('INSERT OR REPLACE INTO web_balance_history VALUES(?,?,?,0)',(refs['cash'],'2026-11-09',88800))
        reconstruct_history(db,'2026-11-10')
        assert db.execute('SELECT current_cents,estimated FROM web_balance_history WHERE account_id=? AND date=?',(refs['cash'],'2026-11-09')).fetchone()==(88800,0)
        assert db.execute('SELECT current_cents,estimated FROM web_balance_history WHERE account_id=? AND date=?',(refs['cash'],'2026-11-08')).fetchone()==(91800,1)
    finally:db.close()


def test_disabled_sources_are_metadata_only(snapshot,tmp_path,monkeypatch):
    db,_=snapshot
    source=db.execute("SELECT ref FROM source_identity WHERE provider_ref='bank'").fetchone()[0]
    monkeypatch.setenv('PLAIDMCP_DISABLED_SOURCES',source)
    target=tmp_path/'detail.sqlite';publish(db,target)
    with sqlite3.connect(target) as out:
        assert out.execute('SELECT status FROM sources WHERE id=?',(source,)).fetchone()==('disabled',)
        assert out.execute('SELECT COUNT(*) FROM accounts WHERE source_id=?',(source,)).fetchone()==(0,)
        assert out.execute('SELECT COUNT(*) FROM transactions').fetchone()==(0,)


def test_development_fixture_has_repeatable_full_history(tmp_path):
    from fixture_data import generate
    first=tmp_path/'first';second=tmp_path/'second';generate(first);generate(second)
    with sqlite3.connect(first/'detail.sqlite') as a,sqlite3.connect(second/'detail.sqlite') as b:
        assert list(a.iterdump())==list(b.iterdump())
        assert a.execute('SELECT COUNT(DISTINCT substr(date,1,7)) FROM transactions').fetchone()[0]>=24
        assert a.execute('SELECT COUNT(*) FROM accounts').fetchone()[0]>=5
        assert a.execute('SELECT COUNT(*) FROM transactions WHERE pending=1').fetchone()[0]>0
        assert a.execute('SELECT COUNT(*) FROM holding_history').fetchone()[0]>700
        assert a.execute("SELECT COUNT(*) FROM sources WHERE kind='file_import'").fetchone()[0]==1


def test_date_override_moves_all_reporting_periods_without_mutating_source(snapshot,tmp_path,monkeypatch):
    from store import publish as aggregate_publish
    from queries import Queries
    db,aggregate=snapshot
    app=tmp_path/'app.sqlite'
    with sqlite3.connect(app) as edits:
        edits.executescript('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(3);CREATE TABLE account_overrides(account_id TEXT,exclude_net_worth INTEGER);CREATE TABLE categories(code TEXT,parent TEXT);CREATE TABLE txn_splits(txn_id TEXT,idx INTEGER,amount_cents INTEGER,category TEXT);CREATE TABLE rules(id TEXT,position INTEGER,enabled INTEGER,match_json TEXT,action_json TEXT);CREATE TABLE txn_overrides(txn_id TEXT,category TEXT,merchant TEXT,hidden INTEGER,reviewed INTEGER,date TEXT);')
        edits.execute('INSERT INTO txn_overrides VALUES(?,?,?,?,?,?)',(opaque('txn','bank','2'),None,None,None,None,'2026-10-31'))
    monkeypatch.setenv('MONEY_APP_DB',str(app));aggregate_publish(db,aggregate)
    q=Queries(aggregate)
    assert q.cash_flow('category','2026-11-01','2026-12-01')['data']['totals'][0]['spending']==10
    assert q.cash_flow('category','2026-10-01','2026-11-01')['data']['totals'][0]['spending']==180
    assert db.execute("SELECT date FROM transactions WHERE id='2'").fetchone()==('2026-11-03',)
    with sqlite3.connect(aggregate) as public:
        assert public.execute("SELECT SUM(total) FROM merchants WHERE window='last_month' AND scope='all'").fetchone()==(180.0,)


def test_wallet_edits_dates_splits_and_hidden_use_same_rules(snapshot,tmp_path,monkeypatch):
    from detail import wallet_rows
    from store import publish as aggregate_publish
    from queries import Queries
    db,aggregate=snapshot
    db.execute("INSERT INTO items VALUES('venmo-csv','Venmo','2026-11-10T12:00:00+00:00',NULL)")
    db.executemany('INSERT INTO venmo_rows VALUES(?,?,?,?)',[('2026-11-05',1000,'out','purchase'),('2026-11-06',2000,'out','purchase')])
    rows=list(wallet_rows(db));app=tmp_path/'app.sqlite'
    with sqlite3.connect(app) as edits:
        edits.executescript('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(3);CREATE TABLE account_overrides(account_id TEXT,exclude_net_worth INTEGER);CREATE TABLE categories(code TEXT,parent TEXT);CREATE TABLE txn_splits(txn_id TEXT,idx INTEGER,amount_cents INTEGER,category TEXT);CREATE TABLE rules(id TEXT,position INTEGER,enabled INTEGER,match_json TEXT,action_json TEXT);CREATE TABLE txn_overrides(txn_id TEXT,category TEXT,merchant TEXT,hidden INTEGER,reviewed INTEGER,date TEXT);')
        edits.execute('INSERT INTO txn_overrides VALUES(?,?,?,?,?,?)',(rows[0][0],'food',None,None,None,'2026-10-31'))
        edits.execute('INSERT INTO txn_overrides VALUES(?,?,?,?,?,?)',(rows[1][0],None,None,1,None,None))
        edits.executemany('INSERT INTO txn_splits VALUES(?,?,?,?)',[(rows[0][0],0,-600,'food'),(rows[0][0],1,-400,'fees')])
    monkeypatch.setenv('MONEY_APP_DB',str(app));aggregate_publish(db,aggregate)
    q=Queries(aggregate)
    assert q.cash_flow('category','2026-11-01','2026-12-01')['data']['totals'][0]['spending']==110
    assert q.cash_flow('category','2026-10-01','2026-11-01')['data']['totals'][0]['spending']==90
    with sqlite3.connect(aggregate) as public:
        assert public.execute("SELECT SUM(spending) FROM daily WHERE category='fees' AND day='2026-10-31'").fetchone()==(4.0,)
    assert list(wallet_rows(db))==rows
