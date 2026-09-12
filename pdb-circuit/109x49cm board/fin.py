import urllib.request, json, urllib.parse, time
def search(text, limit=40):
    p='/api/search?'+urllib.parse.urlencode({'q':text,'limit':limit})
    req=urllib.request.Request('https://jlcsearch.tscircuit.com'+p, headers={'User-Agent':'Mozilla/5.0 Chrome/124','Accept':'application/json'})
    try: return json.load(urllib.request.urlopen(req, timeout=25)).get('components',[])
    except Exception as ex: return [{'__err__':str(ex)}]
def pick(label,text,pkg=None,n=4):
    print(f'== {label} ==')
    cs=search(text)
    if cs and '__err__' in cs[0]: print(' ERR',cs[0]['__err__']);return
    if pkg: cs=[c for c in cs if pkg.lower() in str(c.get('package','')).lower()]
    cs.sort(key=lambda c:(-(1 if c.get('is_basic') else 0),-(1 if c.get('is_preferred') else 0),-(c.get('stock') or 0)))
    for c in cs[:n]:
        print(f"  C{c.get('lcsc')}|{'BASIC' if c.get('is_basic') else ('PREF' if c.get('is_preferred') else 'ext')}|stk={c.get('stock')}|{c.get('package','')}|{c.get('mfr','')}|{(c.get('description') or '')[:44]}")
    time.sleep(0.3)
pick('10k 0603 UniOhm','0603WAF1002T5E')
