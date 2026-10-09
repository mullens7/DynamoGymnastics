"""Capture the public Wix presentation without Wix application scripts."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import requests, json, hashlib, re
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
BASE='https://www.dynamogymnastics.co.uk'
paths=['/','/octoberhalfterm','/results','/terms','/policies','/parties','/gallery','/classes','/contact-us','/staff','/parties/biggym-member','/parties/biggym-nonmember']
def fetch(path):
 r=requests.get(BASE+path,timeout=20);r.raise_for_status();return path,r.text
pages=dict(ThreadPoolExecutor(max_workers=6).map(fetch,paths))
# Include directly linked public information pages, but never booking/auth endpoints.
extra=set()
for html in pages.values():
 for a in BeautifulSoup(html,'html.parser').find_all('a',href=True):
  u=urlparse(a['href'])
  if u.hostname in ('www.dynamogymnastics.co.uk','dynamogymnastics.co.uk') and u.path not in paths and not any(x in u.path for x in ('booking','event-details','login','account','cart','checkout','_api')):
   extra.add(u.path)
def safe_fetch(p):
 try:return fetch(p)
 except Exception as e: print('Unavailable public page',p,str(e)[:80],flush=True);return p,None
with ThreadPoolExecutor(max_workers=8) as pool:
 for p,h in pool.map(safe_fetch, sorted(extra)[:30]):
  if h:pages[p]=h
assets={}
def local_asset(url):
 if not url.startswith('https://static.wixstatic.com/media/'):return url
 if url not in assets:
  ext=urlparse(url).path.rsplit('.',1)[-1]
  if ext.lower() not in ('jpg','jpeg','png','webp','svg','gif','avif'):ext='img'
  assets[url]='/assets/'+hashlib.sha256(url.encode()).hexdigest()[:20]+'.'+ext
 return assets[url]
manifest=[]
for path,html in pages.items():
 s=BeautifulSoup(html,'html.parser')
 if not s.body:
  print('Skipping non-HTML response',path,flush=True);continue
 for t in s.find_all(['script','iframe']):t.decompose()
 for t in s.find_all('link'):
  if t.get('rel') not in (['stylesheet'],['icon'],['shortcut','icon']):t.decompose()
 for t in s.find_all(True):
  for attr in list(t.attrs):
   if attr.startswith('on'):del t[attr]
 for img in s.find_all('img'):
  if img.get('src'):img['src']=local_asset(img['src'])
  img.attrs.pop('srcset',None);img.attrs.pop('loading',None)
 for a in s.find_all('a',href=True):
  u=urlparse(a['href'])
  if u.hostname in ('www.dynamogymnastics.co.uk','dynamogymnastics.co.uk'):
   if u.path.endswith('.pdf'):a['href']=BASE+u.path
   elif u.path in pages:a['href']=u.path+('/' if u.path!='/' and not u.path.endswith('/') else '')+('#'+u.fragment if u.fragment else '')
   else:a['href']='#';a['aria-disabled']='true';a['data-static-control']='true'
 for form in s.find_all('form'):form['action']='#';form['onsubmit']='return false'
 # Keep only a local presentation script: menu opening, with all submissions disabled.
 st=s.new_tag('script',src='/presentation.js');s.body.append(st)
 output=ROOT/'public'/path.strip('/')/'index.html'
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(str(s))
 manifest.append({'path':path,'title':s.title.text if s.title else '', 'images':len(s.find_all('img'))})
(ROOT/'public/assets').mkdir(parents=True,exist_ok=True)
def download(item):
 url,path=item
 r=requests.get(url,timeout=20);r.raise_for_status();(ROOT/'public'/path.lstrip('/')).write_bytes(r.content)
 return path
with ThreadPoolExecutor(max_workers=8) as pool:
 for p in pool.map(download,assets.items()):pass
(ROOT/'capture-manifest.json').write_text(json.dumps({'pages':manifest,'assets':len(assets)},indent=2))
print(json.dumps({'pages':len(pages),'assets':len(assets)}))
