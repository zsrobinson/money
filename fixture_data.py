"""Deterministic invented development data. Never opens an existing database.

Run: python fixture_data.py --output ./fixture-output
Production paths are rejected and output must not exist. All names are fictional.
"""
import argparse
import math
from datetime import date, timedelta
from pathlib import Path
from store import connect, ingest_accounts, ingest_transactions, ingest_holdings, fingerprint
from detail import publish, opaque, cents


def generate(root):
    root=Path(root).resolve()
    if str(root).startswith(('/var/','/opt/','/etc/')) or root.exists():
        raise ValueError('Fixtures require a new development output directory')
    root.mkdir(parents=True,mode=0o700)
    db=connect(root/'fixture-private.sqlite')
    try:
        for key,name in [('bank','Juniper Demonstration Bank'),('broker','Orbit Example Brokerage'),('venmo-csv','Sample Payment Wallet')]:
            db.execute('INSERT INTO items VALUES(?,?,?,NULL)',(key,name,'2026-11-20T12:00:00+00:00'))
            db.execute('INSERT INTO source_identity VALUES(?,?)',(key,opaque('src',key)))
        accounts=[('checking','bank','Everyday checking','depository','checking',7800),('savings','bank','Rainy day savings','depository','savings',18400),('card','bank','Everyday card','credit','credit card',1230),('brokerage','broker','Long term investing','investment','brokerage',32700),('wallet','venmo-csv','Payment wallet','other','wallet',240)]
        for i,(key,item,name,kind,subtype,current) in enumerate(accounts):
            institution=db.execute('SELECT institution FROM items WHERE id=?',(item,)).fetchone()[0].casefold()
            ref=opaque('acct',key)
            db.execute('INSERT INTO account_identity VALUES(?,?,?,?,?)',(ref,institution,kind,subtype,fingerprint(name)))
            db.execute('INSERT INTO account_alias VALUES(?,?,?)',(key,item,ref))
            ingest_accounts(db,item,[{'account_id':key,'name':name,'official_name':'Example '+name,'type':kind,'subtype':subtype,'mask':str(4100+i),'balances':{'current':current,'available':current,'limit':8000 if kind=='credit' else None,'iso_currency_code':'USD'}}])
        db.execute('INSERT INTO account_alias VALUES(?,?,?)',('virtual:venmo-csv','venmo-csv',opaque('acct','wallet')))
        start=date(2024,10,1);end=date(2026,11,20)
        tx=[];day=start
        while day<=end:
            def add(label,amount,category,detail,account='checking',pending=False):
                key=opaque('fixture',day,label,account)
                tx.append({'transaction_id':key,'account_id':account,'date':day.isoformat(),'authorized_date':day.isoformat(),'amount':amount,'iso_currency_code':'USD','pending':pending,'name':label,'merchant_name':label,'payment_channel':'online','personal_finance_category':{'primary':category,'detailed':detail,'confidence_level':'HIGH'}})
            if day.day in (1,15):add('Northstar Fictional Studio payroll',-2600,'INCOME','INCOME_WAGES')
            if day.day==2:add('Example Apartments',1400,'RENT_AND_UTILITIES','RENT_AND_UTILITIES_RENT')
            if day.day==7:add('Imaginary Internet',65,'RENT_AND_UTILITIES','RENT_AND_UTILITIES_UTILITIES')
            if day.day==10:add('Lumen Fictional Streaming',14.99,'ENTERTAINMENT','ENTERTAINMENT_TV_AND_MOVIES')
            if day.day==18:add('Paper Kite Music',10.99,'ENTERTAINMENT','ENTERTAINMENT_MUSIC_AND_AUDIO')
            if day.weekday()==5:add('Juniper Example Grocer',62+(day.toordinal()%29),'FOOD_AND_DRINK','FOOD_AND_DRINK_GROCERIES','card')
            if day.weekday() in (1,4):add('Copper Kettle Fictional Cafe',8+(day.toordinal()%13),'FOOD_AND_DRINK','FOOD_AND_DRINK_RESTAURANT','card')
            if day.day==22:add('Example Transit',42,'TRANSPORTATION','TRANSPORTATION_PUBLIC_TRANSIT')
            if day.day==12:
                add('Savings transfer',350,'TRANSFER_OUT','TRANSFER_OUT_ACCOUNT_TRANSFER')
                add('Savings transfer',-350,'TRANSFER_IN','TRANSFER_IN_ACCOUNT_TRANSFER','savings')
            if day.day==25:
                add('Card payment',450,'LOAN_PAYMENTS','LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')
                add('Card payment',-450,'TRANSFER_IN','TRANSFER_IN_ACCOUNT_TRANSFER','card')
            if day.month%3==0 and day.day==19:add('Fictional Outfitters refund',-35,'GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES','card')
            if day==end:add('Pending Example Shop',23.45,'GENERAL_MERCHANDISE','GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE','card',True)
            for i,(key,item,name,kind,subtype,current) in enumerate(accounts):
                days=(day-start).days
                value=(current*(0.48+0.52*days/(end-start).days)+120*math.sin(days/17+i)) if kind!='credit' else 900+300*math.sin(days/19)
                db.execute('INSERT INTO web_balance_history VALUES(?,?,?,?)',(opaque('acct',key),day.isoformat(),cents(value),int(day<date(2026,6,1))))
                if kind=='investment':
                    for ticker,label,qty,weight in [('DEMO','Demonstration Market Fund',70,0.7),('SAMP','Sample Bond Fund',50,0.3)]:
                        db.execute('INSERT INTO web_holding_history VALUES(?,?,?,?,?)',(opaque('acct',key),opaque('sec',ticker,label,'etf'),day.isoformat(),qty,cents(value*weight)))
            day+=timedelta(days=1)
        ingest_transactions(db,'bank',{'added':tx})
        ingest_holdings(db,'broker',{'securities':[{'security_id':'demo','ticker_symbol':'DEMO','name':'Demonstration Market Fund','type':'etf'},{'security_id':'sample','ticker_symbol':'SAMP','name':'Sample Bond Fund','type':'etf'}],'holdings':[{'account_id':'brokerage','security_id':'demo','quantity':70,'institution_value':22890,'cost_basis':18500,'iso_currency_code':'USD'},{'account_id':'brokerage','security_id':'sample','quantity':50,'institution_value':9810,'cost_basis':8900,'iso_currency_code':'USD'}]})
        for i,day in enumerate(['2026-10-11','2026-11-04','2026-11-15']):
            db.execute('INSERT INTO venmo_rows VALUES(?,?,?,?)',(day,1800+i*500,'out' if i%2 else 'in','peer_sent' if i%2 else 'peer_received'))
        db.commit();publish(db,root/'detail.sqlite')
        import sqlite3
        with sqlite3.connect(root/'detail.sqlite') as out:
            out.execute("UPDATE meta SET value='2026-11-20T12:00:00+00:00' WHERE key='generated_at'")
    finally:db.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',required=True,type=Path)
    generate(parser.parse_args().output)
    print('Invented fixture snapshot generated.')
