import json
import threading
import urllib.request
import urllib.error
import pytest
import link
from sync import private_store

@pytest.mark.parametrize('selection',['id','name'])
async def test_link_local_csrf_single_use_and_duplicate(tmp_path,monkeypatch,selection):
    monkeypatch.setenv('PLAIDMCP_PRIVATE',str(tmp_path/'private'))
    calls=[]
    class FakeClient:
        def call(self,path,**payload):
            calls.append((path,payload))
            if path=='/link/token/create': return {'link_token':'fake-link'}
            return {'item_id':'item','access_token':'fake-access'}
    monkeypatch.setattr(link,'Client',FakeClient)
    monkeypatch.setattr('sys.argv',['link.py','--product','transactions']+(['--institution','ins_1'] if selection=='id' else ['--institution-name','Example Bank']))
    import sqlite3
    import sync
    from store import SCHEMA
    def threaded_store(path):
        db=sqlite3.connect(path,check_same_thread=False)
        db.executescript(SCHEMA)
        return db
    monkeypatch.setattr(sync,'connect',threaded_store)
    real=link.http.server.HTTPServer
    class Done(Exception): pass
    class LocalServer(real):
        def __init__(self,address,handler):
            assert address==('127.0.0.1',8768)
            super().__init__(('127.0.0.1',0),handler)
        def serve_forever(self):
            # Exercise the actual helper handler without touching its fixed production port.
            thread=threading.Thread(target=super().serve_forever); thread.start()
            base=f'http://127.0.0.1:{self.server_port}'
            def request(path,csrf=None,body=b'{}'):
                headers={'Host':'127.0.0.1:8768'}
                if csrf: headers['X-CSRF']=csrf
                req=urllib.request.Request(base+path,body,headers)
                try:
                    with urllib.request.urlopen(req) as r: return r.status,json.load(r)
                except urllib.error.HTTPError as e: return e.code,{}
            try:
                with urllib.request.urlopen(urllib.request.Request(base,headers={'Host':'127.0.0.1:8768'})) as r:
                    html=r.read().decode()
                csrf=html.split('const csrf=')[1].split(';')[0].strip('"')
                assert request('/token')[0]==403
                assert request('/token',csrf)[0]==200
                assert calls[-1][1]['products']==['transactions']
                assert request('/token',csrf)[0]==409
                assert request('/exchange',csrf,json.dumps({'public_token':'fake-public','institution_id':'ins_1','institution_name':'Example Bank'}).encode())[0]==200
                assert request('/exchange',csrf)[0]==409
            finally:
                self.shutdown(); thread.join(); self.server_close()
            raise Done()
    monkeypatch.setattr(link.http.server,'HTTPServer',LocalServer)
    with pytest.raises(Done): link.main()
    with private_store() as db:
        assert db.execute('SELECT token FROM credentials').fetchone()[0]=='fake-access'
    with pytest.raises(SystemExit,match='already linked'): link.main()
    assert len(calls)==2


def test_initial_history_payload():
    assert link.token_payload('transactions')['transactions']=={'days_requested':730}
    assert link.token_payload('transactions',days_requested=30)['transactions']=={'days_requested':30}
    assert 'transactions' not in link.token_payload('investments')
    assert 'transactions' not in link.token_payload('transactions',('item','fake-token'))
    for value in (29,731,'bad'):
        with pytest.raises(link.argparse.ArgumentTypeError): link.token_payload('transactions',days_requested=value)


def serve_once(monkeypatch,tmp_path,argv,exchange):
    """Run the real helper handler on an ephemeral port: token, then one exchange."""
    import sqlite3
    import sync
    from store import SCHEMA
    monkeypatch.setenv('PLAIDMCP_PRIVATE',str(tmp_path/'private'))
    calls=[]
    class FakeClient:
        def call(self,path,**payload):
            calls.append((path,payload))
            if path=='/link/token/create': return {'link_token':'fake-link'}
            raise AssertionError('Update mode never exchanges or creates an Item')
    monkeypatch.setattr(link,'Client',FakeClient)
    monkeypatch.setattr('sys.argv',['link.py',*argv])
    monkeypatch.setattr(sync,'connect',lambda path:(lambda db:(db.executescript(SCHEMA),db)[1])(sqlite3.connect(path,check_same_thread=False)))
    statuses=[]
    real=link.http.server.HTTPServer
    class Done(Exception): pass
    class LocalServer(real):
        def __init__(self,address,handler): super().__init__(('127.0.0.1',0),handler)
        def serve_forever(self):
            thread=threading.Thread(target=super().serve_forever);thread.start()
            base=f'http://127.0.0.1:{self.server_port}'
            def request(path,csrf,body=b'{}'):
                req=urllib.request.Request(base+path,body,{'Host':'127.0.0.1:8768','X-CSRF':csrf})
                try:
                    with urllib.request.urlopen(req) as r: return r.status
                except urllib.error.HTTPError as e: return e.code
            try:
                with urllib.request.urlopen(urllib.request.Request(base,headers={'Host':'127.0.0.1:8768'})) as r:
                    csrf=r.read().decode().split('const csrf=')[1].split(';')[0].strip('"')
                statuses.append(request('/token',csrf))
                statuses.append(request('/exchange',csrf,json.dumps(exchange).encode()))
            finally:
                self.shutdown();thread.join();self.server_close()
            raise Done()
    monkeypatch.setattr(link.http.server,'HTTPServer',LocalServer)
    with pytest.raises(Done): link.main()
    return calls,statuses


def seed_item(product):
    with private_store() as db:
        with db:
            db.execute("INSERT INTO credentials VALUES('item','ins_1','fake-access',?,NULL)",(product,))
            db.execute("INSERT INTO items VALUES('item','Example Bank',NULL,NULL)")


def stored_product():
    with private_store() as db: return db.execute('SELECT product FROM credentials').fetchone()[0]


def test_update_mode_adds_liabilities_consent_after_success(tmp_path,monkeypatch):
    monkeypatch.setenv('PLAIDMCP_PRIVATE',str(tmp_path/'private'))
    seed_item('transactions,investments')
    calls,statuses=serve_once(monkeypatch,tmp_path,['--update','--institution','ins_1','--add-product','liabilities'],{'public_token':'fake-public','institution_id':'ins_1','institution_name':'Example Bank'})
    assert statuses==[200,200]
    assert calls==[('/link/token/create',{**link.token_payload(None,('item','fake-access')),'additional_consented_products':['liabilities']})]
    assert 'products' not in calls[0][1]
    assert stored_product()=='transactions,investments,liabilities'


def test_failed_update_never_records_consent(tmp_path,monkeypatch):
    monkeypatch.setenv('PLAIDMCP_PRIVATE',str(tmp_path/'private'))
    seed_item('transactions')
    _,statuses=serve_once(monkeypatch,tmp_path,['--update','--institution','ins_1','--add-product','liabilities'],{'public_token':'fake-public','institution_id':'ins_other','institution_name':'Other Bank'})
    assert statuses==[200,400]
    assert stored_product()=='transactions'


def test_add_product_requires_update_and_existing_item(tmp_path,monkeypatch):
    monkeypatch.setenv('PLAIDMCP_PRIVATE',str(tmp_path/'private'))
    for argv in (['--product','transactions','--add-product','liabilities'],['--add-product','liabilities','--institution','ins_1'],['--update','--institution','ins_1','--add-product','identity'],[]):
        monkeypatch.setattr('sys.argv',['link.py',*argv])
        with pytest.raises(SystemExit): link.main()
    with pytest.raises(ValueError): link.token_payload('transactions',None,add_product='liabilities')
