import os
import pytest
from plaid_client import Client,PlaidError,ALLOWED
from sync import sync_item
from store import ingest_transactions

def test_allowlist(monkeypatch):
    monkeypatch.setenv('PLAID_CLIENT_ID','fake'); monkeypatch.setenv('PLAID_SECRET','fake')
    c=Client()
    assert c.base=='https://sandbox.plaid.com'
    assert len(ALLOWED)==11
    for path in ('/transfer/create','/auth/get','/identity/get','/accounts/balance/get'):
        with pytest.raises(ValueError): c.call(path)
    with pytest.raises(ValueError): c.call('/link/token/create',products=['auth'])
    monkeypatch.setenv('PLAID_ENV','evil')
    with pytest.raises(ValueError): Client()

def test_sync_pagination_rollback(snapshot):
    db,_=snapshot
    db.execute('CREATE TABLE credentials(item TEXT PRIMARY KEY,institution_id TEXT,token TEXT,product TEXT,cursor TEXT)')
    db.execute("INSERT INTO credentials VALUES('bank','ins','fake','transactions','old')"); db.commit()
    class Fake:
        calls=0
        cursors=[]
        def call(self,path,**kw):
            if path=='/item/get': return {'item':{}}
            if path=='/institutions/get_by_id': return {'institution':{'name':'Example Bank'}}
            if path=='/accounts/get': return {'accounts':[]}
            if path=='/transactions/recurring/get':raise PlaidError('PRODUCT_NOT_ENABLED')
            self.cursors.append(kw.get('cursor')); self.calls+=1
            assert kw['options']['personal_finance_category_version']=='v2'
            if self.calls==2: raise PlaidError('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')
            return {'added':[], 'modified':[], 'removed':[{'transaction_id':'1'}], 'next_cursor':'next' if self.calls==1 else 'done','has_more':self.calls==1}
    fake=Fake(); sync_item(db,fake,('bank','ins','fake','transactions','old'))
    assert fake.cursors==['old','next','old']
    assert db.execute('SELECT cursor FROM credentials').fetchone()[0]=='done'
    class Broken:
        def call(self,*a,**kw): raise PlaidError('ITEM_LOGIN_REQUIRED')
    sync_item(db,Broken(),('bank','ins','fake','transactions','done'))
    assert db.execute("SELECT error FROM items WHERE id='bank'").fetchone()[0]=='ITEM_LOGIN_REQUIRED'

def test_modified_removed(snapshot):
    db,_=snapshot
    ingest_transactions(db,'bank',{'modified':[{'transaction_id':'2','date':'2026-11-03','amount':42,'personal_finance_category':{'primary':'FOOD_AND_DRINK','detailed':'FOOD_AND_DRINK_GROCERIES'}}],'removed':[{'transaction_id':'3'}]})
    assert db.execute("SELECT amount FROM transactions WHERE id='2'").fetchone()[0]==42
    assert db.execute("SELECT count(*) FROM transactions WHERE id='3'").fetchone()[0]==0


def test_sandbox_create_fails_closed(monkeypatch):
    import io
    import json
    from plaid_client import SANDBOX_CREATE
    monkeypatch.setenv('PLAID_CLIENT_ID','fake'); monkeypatch.setenv('PLAID_SECRET','fake')
    def fake_open(request,timeout):
        assert request.full_url=='https://sandbox.plaid.com'+SANDBOX_CREATE
        assert set(json.loads(request.data)['initial_products'])=={'transactions','investments'}
        return io.BytesIO(b'{"public_token":"fake-public"}')
    monkeypatch.setattr('urllib.request.urlopen',fake_open)
    monkeypatch.setenv('PLAID_ENV','sandbox')
    client=Client()
    assert client.call(SANDBOX_CREATE,initial_products=['transactions','investments'])=={'public_token':'fake-public'}
    with pytest.raises(ValueError): client.call(SANDBOX_CREATE,initial_products=['auth'])
    monkeypatch.setenv('PLAID_ENV','production')
    with pytest.raises(ValueError,match='Sandbox'): Client().call(SANDBOX_CREATE,initial_products=['transactions'])
    with pytest.raises(ValueError,match='Sandbox'): client.call(SANDBOX_CREATE,initial_products=['transactions'])
    monkeypatch.delenv('PLAID_ENV')
    with pytest.raises(ValueError,match='explicit'): Client().call(SANDBOX_CREATE,initial_products=['transactions'])
    monkeypatch.setenv('PLAID_ENV','development')
    with pytest.raises(ValueError): Client()


def test_combined_products_syncs_both_and_cursor(snapshot):
    db,_=snapshot
    db.execute('CREATE TABLE credentials(item TEXT PRIMARY KEY,institution_id TEXT,token TEXT,product TEXT,cursor TEXT)')
    db.execute("INSERT INTO credentials VALUES('bank','ins','fake','transactions,investments',NULL)");db.commit()
    class Fake:
        calls=[]
        def call(self,path,**kwargs):
            self.calls.append(path)
            if path=='/item/get': return {'item':{}}
            if path=='/institutions/get_by_id': return {'institution':{'name':'Fake Sandbox'}}
            if path=='/accounts/get': return {'accounts':[]}
            if path=='/transactions/recurring/get':raise PlaidError('PRODUCT_NOT_ENABLED')
            if path=='/transactions/sync': return {'added':[],'modified':[],'removed':[],'next_cursor':'done','has_more':False}
            if path=='/investments/holdings/get': return {'holdings':[],'securities':[]}
            raise AssertionError('Unexpected endpoint')
    fake=Fake()
    sync_item(db,fake,('bank','ins','fake','transactions,investments',None))
    assert '/transactions/sync' in fake.calls and '/investments/holdings/get' in fake.calls
    assert db.execute('SELECT cursor FROM credentials').fetchone()[0]=='done'
    assert db.execute("SELECT error FROM items WHERE id='bank'").fetchone()[0] is None


def test_link_requests_only_read_products(monkeypatch):
    import io,json
    monkeypatch.setenv('PLAID_CLIENT_ID','fake');monkeypatch.setenv('PLAID_SECRET','fake')
    monkeypatch.setenv('PLAID_ENV','sandbox')
    def fake_open(request,timeout):
        body=json.loads(request.data)
        assert set(body['products']) <= {'transactions','investments'}
        assert not (set(body) & {'additional_consented_products','required_if_supported_products'})
        return io.BytesIO(b'{"link_token":"fake"}')
    monkeypatch.setattr('urllib.request.urlopen',fake_open)
    client=Client()
    assert client.call('/link/token/create',products=['transactions','investments'])=={'link_token':'fake'}
    for bad in ('auth','identity','transfer','payment_initiation','signal'):
        with pytest.raises(ValueError): client.call('/link/token/create',products=[bad])
        with pytest.raises(ValueError): client.call('/link/token/create',products=['transactions'],optional_products=[bad])


def test_sandbox_only_deployment_rejects_production(monkeypatch):
    monkeypatch.setenv('PLAID_CLIENT_ID','fake');monkeypatch.setenv('PLAID_SECRET','fake')
    monkeypatch.setenv('PLAIDMCP_SANDBOX_ONLY','true');monkeypatch.setenv('PLAID_ENV','production')
    with pytest.raises(ValueError,match='Sandbox only'): Client()


def credentials(db,product):
    db.execute('CREATE TABLE IF NOT EXISTS credentials(item TEXT PRIMARY KEY,institution_id TEXT,token TEXT,product TEXT,cursor TEXT)')
    db.execute('DELETE FROM credentials')
    db.execute("INSERT INTO credentials VALUES('broker','ins','fake',?,NULL)",(product,));db.commit()
    return ('broker','ins','fake',product,None)


INVESTMENT_ROWS=[{'investment_transaction_id':f'itx-{i}','account_id':'invest','security_id':'sec' if i!=2 else None,'date':f'2026-11-0{i+1}',
    'name':'PRIVATE INVESTMENT NAME','type':'buy' if i!=2 else 'cash','subtype':'buy' if i!=2 else 'dividend','quantity':1.5 if i!=2 else 0,
    'price':100,'amount':150.25 if i!=2 else -4.5,'fees':0.5 if i==0 else None,'iso_currency_code':'USD','cancel_transaction_id':None} for i in range(3)]


class Broker:
    """Fake Plaid for the invented broker item; records every call."""
    def __init__(self,fail=None,liabilities=None):
        self.calls=[];self.fail=fail or {};self.liabilities=liabilities
    def call(self,path,**kw):
        self.calls.append((path,kw))
        if path in self.fail: raise self.fail[path]
        if path=='/item/get': return {'item':{}}
        if path=='/institutions/get_by_id': return {'institution':{'name':'Example Broker'}}
        if path=='/accounts/get': return {'accounts':[]}
        if path=='/investments/holdings/get': return {'holdings':[{'account_id':'invest','security_id':'sec','quantity':30,'institution_value':3000,'cost_basis':2500,'iso_currency_code':'USD'}],'securities':[{'security_id':'sec','ticker_symbol':'FAKE','name':'Fixture Fund','type':'etf'}]}
        if path=='/investments/transactions/get':
            offset=kw['options']['offset']
            return {'investment_transactions':INVESTMENT_ROWS[offset:offset+2],'total_investment_transactions':3,'securities':[{'security_id':'sec','ticker_symbol':'FAKE','name':'Fixture Fund','type':'etf'}],'accounts':[]}
        if path=='/liabilities/get': return self.liabilities
        if path=='/transactions/sync': return {'added':[],'modified':[],'removed':[],'next_cursor':'done','has_more':False}
        if path=='/transactions/recurring/get': raise PlaidError('PRODUCT_NOT_ENABLED')
        raise AssertionError('Unexpected endpoint')


def test_stored_product_combinations(snapshot):
    db,_=snapshot
    for product in ('investments','transactions,investments,liabilities','investments,liabilities'):
        fake=Broker();sync_item(db,fake,credentials(db,product))
        assert db.execute("SELECT error FROM items WHERE id='broker'").fetchone()[0] is None
        assert ('/liabilities/get' in [c[0] for c in fake.calls])==('liabilities' in product)
    for product in ('liabilities','auth','investments,auth',''):
        with pytest.raises(ValueError,match='Unsupported'): sync_item(db,Broker(),credentials(db,product))


def test_investment_transactions_paginate_and_errors_skip(snapshot):
    db,_=snapshot
    from datetime import date, timedelta
    fake=Broker();sync_item(db,fake,credentials(db,'investments'))
    pages=[kw for path,kw in fake.calls if path=='/investments/transactions/get']
    assert [p['options'] for p in pages]==[{'count':500,'offset':0},{'count':500,'offset':2}]
    assert date.fromisoformat(pages[0]['end_date'])-date.fromisoformat(pages[0]['start_date'])==timedelta(days=730)
    assert db.execute('SELECT COUNT(*) FROM web_investment_transactions').fetchone()==(3,)
    assert b'PRIVATE INVESTMENT NAME' not in b''.join(str(r).encode() for r in db.execute('SELECT * FROM web_investment_transactions'))
    for error in (PlaidError('PRODUCT_NOT_READY'),PlaidError('INVALID_FIELD'),KeyError('total_investment_transactions'),ValueError('bad')):
        sync_item(db,Broker(fail={'/investments/transactions/get':error}),credentials(db,'investments'))
        assert db.execute("SELECT error FROM items WHERE id='broker'").fetchone()[0] is None
        assert db.execute('SELECT COUNT(*) FROM web_investment_transactions').fetchone()==(3,)
        assert db.execute("SELECT COUNT(*) FROM holdings WHERE item='broker'").fetchone()==(1,)
    # A malformed row mid-ingest rolls back to the previous rows, never a partial write.
    global INVESTMENT_ROWS
    good=INVESTMENT_ROWS;INVESTMENT_ROWS=[good[0],{**good[1],'date':'not a date'},good[2]]
    try:sync_item(db,Broker(),credentials(db,'investments'))
    finally:INVESTMENT_ROWS=good
    assert db.execute('SELECT COUNT(*) FROM web_investment_transactions').fetchone()==(3,)


CARD_BILL={'accounts':[],'liabilities':{'credit':[{'account_id':'card','aprs':[{'apr_type':'cash_apr','apr_percentage':29.9},{'apr_type':'purchase_apr','apr_percentage':21.24}],
    'is_overdue':False,'last_payment_amount':120.5,'last_payment_date':'2026-10-20','last_statement_issue_date':'2026-11-01','last_statement_balance':410.75,
    'minimum_payment_amount':35,'next_payment_due_date':'2026-11-25'}],
    'student':[{'account_id':'invest','account_number':'PRIVATE ACCOUNT NUMBER','loan_name':'PRIVATE LOAN NAME','servicer_address':{'street':'PRIVATE STREET'},'interest_rate_percentage':5.1,'is_overdue':None,
        'last_payment_amount':None,'last_payment_date':None,'last_statement_balance':900,'last_statement_issue_date':'2026-10-28','minimum_payment_amount':80,'next_payment_due_date':'2026-11-28'}],
    'mortgage':None}}


def test_liabilities_only_when_consented_and_errors_skip(snapshot):
    db,_=snapshot
    db.execute("INSERT INTO web_liabilities VALUES('broker','card','credit',1,NULL,NULL,NULL,NULL,NULL,NULL,0)")
    for error in (PlaidError('ADDITIONAL_CONSENT_REQUIRED'),PlaidError('PRODUCTS_NOT_SUPPORTED'),KeyError('account_id')):
        sync_item(db,Broker(fail={'/liabilities/get':error}),credentials(db,'investments,liabilities'))
        assert db.execute("SELECT error FROM items WHERE id='broker'").fetchone()[0] is None
        assert db.execute('SELECT COUNT(*) FROM web_liabilities').fetchone()==(1,)
    fake=Broker(liabilities=CARD_BILL);sync_item(db,fake,credentials(db,'investments'))
    assert '/liabilities/get' not in [c[0] for c in fake.calls]
    sync_item(db,Broker(liabilities=CARD_BILL),credentials(db,'investments,liabilities'))
    rows=db.execute('SELECT * FROM web_liabilities ORDER BY account').fetchall()
    assert rows==[('broker','card','credit',410.75,'2026-11-01',35,'2026-11-25',120.5,'2026-10-20',21.24,0),('broker','invest','student',900,'2026-10-28',80,'2026-11-28',None,None,5.1,None)]


def test_detail_publishes_investment_transactions_and_liabilities(snapshot,tmp_path):
    import sqlite3
    from detail import publish, opaque
    db,aggregate=snapshot
    sync_item(db,Broker(liabilities={'liabilities':{'credit':[{**CARD_BILL['liabilities']['credit'][0],'account_id':'invest'}]}}),credentials(db,'investments,liabilities'))
    target=tmp_path/'detail.sqlite';publish(db,target)
    with sqlite3.connect(target) as out:
        rows=out.execute('SELECT id,account_id,security_id,date,type,subtype,quantity,price,amount_cents,fees_cents FROM investment_transactions ORDER BY date').fetchall()
        holding=out.execute('SELECT account_id,security_id FROM holdings').fetchone()
        bill=out.execute('SELECT * FROM liabilities').fetchone()
        assert out.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()==('2',)
    assert [r[0] for r in rows]==[opaque('itx','broker',f'itx-{i}') for i in range(3)]
    assert rows[0][1:]==(holding[0],holding[1],'2026-11-01','buy','buy',1.5,100,-15025,50)
    assert rows[2][1:]==(holding[0],None,'2026-11-03','cash','dividend',0,100,450,None)
    assert bill==(holding[0],'credit',41075,'2026-11-01',3500,'2026-11-25',12050,'2026-10-20',21.24,0)
    raw=target.read_bytes()
    for secret in (b'PRIVATE INVESTMENT NAME',b'itx-0',b'PRIVATE ACCOUNT NUMBER'):
        assert secret not in raw
    assert b'investment_transactions' not in aggregate.read_bytes()


def test_liabilities_consent_only_in_update_mode(monkeypatch):
    import io,json
    monkeypatch.setenv('PLAID_CLIENT_ID','fake');monkeypatch.setenv('PLAID_SECRET','fake');monkeypatch.setenv('PLAID_ENV','sandbox')
    sent=[]
    monkeypatch.setattr('urllib.request.urlopen',lambda request,timeout:(sent.append(json.loads(request.data)),io.BytesIO(b'{"link_token":"fake"}'))[1])
    client=Client()
    assert client.call('/link/token/create',access_token='fake-access',additional_consented_products=['liabilities'])=={'link_token':'fake'}
    assert sent[-1]['additional_consented_products']==['liabilities'] and 'products' not in sent[-1]
    for bad in ({'products':['liabilities']},{'products':['transactions'],'optional_products':['liabilities']},
            {'products':['transactions'],'additional_consented_products':['liabilities']},
            {'access_token':'fake-access','additional_consented_products':['auth']},
            {'access_token':'fake-access','additional_consented_products':['liabilities','identity']},
            {'access_token':'fake-access','products':['transactions'],'additional_consented_products':['liabilities']},
            {'access_token':'fake-access','required_if_supported_products':['liabilities']}):
        with pytest.raises(ValueError): client.call('/link/token/create',**bad)
    with pytest.raises(ValueError): client.call(__import__('plaid_client').SANDBOX_CREATE,initial_products=['transactions','liabilities'])
    assert len(sent)==1


def test_sandbox_check_client_refuses_production(monkeypatch):
    from sandbox_check import AuditClient
    monkeypatch.setenv('PLAID_CLIENT_ID','fake');monkeypatch.setenv('PLAID_SECRET','fake');monkeypatch.setenv('PLAID_ENV','production')
    with pytest.raises(ValueError,match='Sandbox'): AuditClient()
    monkeypatch.setenv('PLAID_ENV','sandbox')
    client=AuditClient();client.base='https://production.plaid.com'
    with pytest.raises(ValueError,match='Sandbox'): client.call('/investments/transactions/get',access_token='fake')
