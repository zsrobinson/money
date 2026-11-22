"""One-shot sync, private credentials and SQLite; logs only fixed status messages."""
import telemetry
import fcntl
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from plaid_client import Client, PlaidError
from store import connect, ingest_accounts, ingest_transactions, ingest_holdings, publish
from detail import ingest_investment_transactions, ingest_liabilities

ingest_accounts = telemetry.timed('store')(ingest_accounts)
ingest_transactions = telemetry.timed('store')(ingest_transactions)
ingest_holdings = telemetry.timed('store')(ingest_holdings)

@contextmanager
def private_store():
    os.umask(0o077)
    root = Path(os.environ.get('PLAIDMCP_PRIVATE','private'))
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    os.chmod(root,0o700)
    with open(root/'lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        db = connect(root/'private.sqlite')
        os.chmod(root/'private.sqlite',0o600)
        db.execute('CREATE TABLE IF NOT EXISTS credentials(item TEXT PRIMARY KEY, institution_id TEXT UNIQUE, token TEXT, product TEXT, cursor TEXT)')
        try: yield db
        finally: db.close()

def optional(db, step, product="detail"):
    db.execute("CREATE TABLE IF NOT EXISTS optional_product_status(product TEXT PRIMARY KEY,status TEXT NOT NULL)")
    """Web-detail extras never fail an item: any error keeps the previous rows."""
    db.execute('SAVEPOINT optional_detail')
    try:
        step()
        db.execute('RELEASE optional_detail')
        db.execute('INSERT OR REPLACE INTO optional_product_status VALUES(?,?)',(product,'ok'))
    except Exception as error:
        db.execute('ROLLBACK TO optional_detail');db.execute('RELEASE optional_detail')
        relink=isinstance(error,PlaidError) and error.code in {'ITEM_LOGIN_REQUIRED','ADDITIONAL_CONSENT_REQUIRED','PRODUCT_NOT_READY','PRODUCTS_NOT_SUPPORTED','NO_INVESTMENT_ACCOUNTS'}
        db.execute('INSERT OR REPLACE INTO optional_product_status VALUES(?,?)',(product,'relink_required' if relink else 'unavailable'))


def investment_transactions(client, token, today=None):
    """Fetch Plaid's 24-month window with offset pagination before any write."""
    end = today or datetime.now(timezone.utc).date()
    start = end - timedelta(days=730)
    rows, securities = [], {}
    for _ in range(200):
        page = client.call('/investments/transactions/get',access_token=token,start_date=start.isoformat(),end_date=end.isoformat(),options={'count':500,'offset':len(rows)})
        telemetry.count('pages')
        securities.update({s['security_id']:s for s in page.get('securities',[])})
        rows += page['investment_transactions']
        if not page['investment_transactions'] or len(rows) >= page['total_investment_transactions']: break
    else: raise PlaidError('PAGINATION_LIMIT')
    return {'start_date':start.isoformat(),'investment_transactions':rows,'securities':list(securities.values())}


def sync_item(db, client, row):
    original = client
    class MeasuredClient:
        @telemetry.timed('fetch')
        def call(self, *args, **kwargs):
            return original.call(*args, **kwargs)
    client = MeasuredClient()
    telemetry.count('items_count')
    item,institution_id,token,product,cursor = row
    products = set(product.split(','))
    if not products & {'transactions','investments'} or products - {'transactions','investments','liabilities'}:
        raise ValueError('Unsupported stored sync products')
    backfill=os.environ.get('PLAIDMCP_BACKFILL_MERCHANTS','false').lower()=='true' and 'transactions' in products
    if backfill:cursor=None
    # Whole pagination transaction rolls back on mutation, leaving the old cursor intact.
    for attempt in range(3):
        try:
            with db:
                if backfill:db.execute("DELETE FROM transactions WHERE item=? AND origin='plaid'",(item,))
                meta = client.call('/item/get',access_token=token)['item']
                if meta.get('error'): raise PlaidError(meta['error'].get('error_code','PLAID_ERROR'))
                institution = client.call('/institutions/get_by_id',institution_id=institution_id,country_codes=['US'])['institution']['name']
                if 'venmo' in institution.casefold() and db.execute("SELECT 1 FROM items WHERE id='venmo-csv'").fetchone():
                    raise PlaidError('PLAIDMCP_VENMO_SOURCE_OVERLAP')
                db.execute('UPDATE items SET institution=? WHERE id=?',(institution,item))
                accounts = client.call('/accounts/get',access_token=token)['accounts']
                ingest_accounts(db,item,accounts)
                if 'transactions' in products:
                    next_cursor = cursor
                    for _ in range(1000):
                        payload = {'access_token':token,'count':500,'options':{'personal_finance_category_version':'v2','include_original_description':True}}
                        if next_cursor: payload['cursor'] = next_cursor
                        page = client.call('/transactions/sync',**payload)
                        telemetry.count('pages')
                        ingest_transactions(db,item,page)
                        next_cursor = page['next_cursor']
                        if not page['has_more']: break
                    else: raise PlaidError('PAGINATION_LIMIT')
                    db.execute('UPDATE credentials SET cursor=? WHERE item=?',(next_cursor,item))
                    from merchants import ingest_recurring
                    try:recurring=client.call('/transactions/recurring/get',access_token=token)
                    except PlaidError:recurring={}
                    ingest_recurring(db,item,recurring)
                if 'investments' in products:
                    ingest_holdings(db,item,client.call('/investments/holdings/get',access_token=token))
                    optional(db,lambda:ingest_investment_transactions(db,item,investment_transactions(client,token)),"investments")
                if 'liabilities' in products:
                    optional(db,lambda:ingest_liabilities(db,item,client.call('/liabilities/get',access_token=token)),"liabilities")
                now = datetime.now(timezone.utc).isoformat()
                db.execute('UPDATE items SET as_of=?,error=NULL WHERE id=?',(now,item))
            return
        except PlaidError as error:
            if error.code == 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' and attempt < 2:
                telemetry.count('retries')
                continue
            telemetry.failure(error)
            with db: db.execute('UPDATE items SET error=? WHERE id=?',(error.code,item))
            return

@telemetry.sync_run()
def main():
    from sources import refresh_sources
    if os.environ.get('MONEY_DETAIL_DB'):
        from detail import validate_paths
        validate_paths(os.environ.get('PLAIDMCP_PRIVATE','private'),os.environ.get('PLAIDMCP_PUBLIC','aggregate.sqlite'),os.environ['MONEY_DETAIL_DB'],os.environ.get('MONEY_APP_DB'))
    with private_store() as db:
        refresh_sources(db,os.environ.get('PLAIDMCP_PUBLIC','aggregate.sqlite'),Client)
        with telemetry.phase('publish'):
            publish(db,os.environ.get('PLAIDMCP_PUBLIC','aggregate.sqlite'))
        detail_path=os.environ.get('MONEY_DETAIL_DB')
        if detail_path:
            from detail import record_history, reconstruct_history, publish as publish_detail
            record_history(db)
            reconstruct_history(db)
            publish_detail(db,detail_path)
        db.commit()  # persist opaque identities generated during publication

if __name__ == '__main__':
    try: main()
    except Exception:
        raise SystemExit('Sync failed; inspect private configuration. No request details logged.') from None
