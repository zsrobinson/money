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
        edits.executescript('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(2);CREATE TABLE categories(code TEXT,parent TEXT);CREATE TABLE txn_splits(txn_id TEXT,idx INTEGER,amount_cents INTEGER,category TEXT);CREATE TABLE rules(id TEXT,position INTEGER,enabled INTEGER,match_json TEXT,action_json TEXT);CREATE TABLE txn_overrides(txn_id TEXT,category TEXT,merchant TEXT,hidden INTEGER,reviewed INTEGER);')
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
        edits.executescript('CREATE TABLE schema_version(version INTEGER);INSERT INTO schema_version VALUES(2);CREATE TABLE categories(code TEXT,parent TEXT);CREATE TABLE txn_splits(txn_id TEXT,idx INTEGER,amount_cents INTEGER,category TEXT);CREATE TABLE rules(id TEXT,position INTEGER,enabled INTEGER,match_json TEXT,action_json TEXT);CREATE TABLE txn_overrides(txn_id TEXT,category TEXT,merchant TEXT,hidden INTEGER,reviewed INTEGER);')
        edits.execute('INSERT INTO categories VALUES(?,?)',('cat_fixture','shopping'))
        edits.executemany('INSERT INTO txn_splits VALUES(?,?,?,?)',[(opaque('txn','bank','2'),0,-6000,'cat_fixture'),(opaque('txn','bank','2'),1,-4000,'food')])
    monkeypatch.setenv('MONEY_APP_DB',str(app));aggregate_publish(db,aggregate)
    with sqlite3.connect(aggregate) as public:
        assert public.execute("SELECT SUM(spending) FROM daily WHERE category='shopping'").fetchone()==(60.0,)
        assert public.execute("SELECT SUM(spending) FROM daily WHERE category='food' AND day>='2026-11-01'").fetchone()==(50.0,)
    assert b'cat_fixture' not in aggregate.read_bytes()


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
