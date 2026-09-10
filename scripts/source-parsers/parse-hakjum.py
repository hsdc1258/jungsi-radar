# -*- coding: utf-8 -*-
# source/results.json 의 어디가(학점나비 경유) 2026학년도 값을 만든 기록이다.
# 대학별 페이지를 먼저 받아 두고 돌린다:
#   curl -sS -o "hakjum/<대학명>-본교.html" "https://hakjum.school/admissions/<URL인코딩한 '대학명-본교'>/"
#   python3 scripts/source-parsers/parse-hakjum.py     # → newunis.json
#   (가천대는 정시 백분위 표가 없어 베리타스알파가 옮긴 공식 입결을 따로 넣는다)
#   npm run build
# 값은 페이지에 적힌 숫자만 옮기고, 없는 값은 만들지 않는다.
import re,html,json,urllib.parse
IDS={'인천대학교':'incheon','경기대학교':'kyonggi','인하대학교':'inha','아주대학교':'ajou'}
EXCLUDE=re.compile(r'농어촌|기초|차상위|특성화|기회균형|사회배려|고른기회|특수|장애|재직자|신학특별|실기|사회통합|한마음|국가보훈|만학도|성인학습|평생|특별전형|계약학과|국방|사이버|항공시스템')
def clean(x): return html.unescape(re.sub(r'<[^>]+>','',x)).strip().replace('\n',' ')
def num(x):
    x=x.replace(',','').strip()
    return float(x) if re.match(r'^-?\d+(\.\d+)?$',x) else None
def parse(path):
    s=open(path,encoding='utf-8',errors='ignore').read()
    out=[]
    for m in re.finditer(r'<table.*?</table>',s,re.S):
        before=s[max(0,m.start()-1500):m.start()]
        heads=[clean(h) for h in re.findall(r'<h[2-4][^>]*>(.*?)</h[2-4]>',before,re.S)]
        name=heads[-1] if heads else ''
        rows=[[clean(c) for c in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>',tr,re.S)] for tr in re.findall(r'<tr.*?</tr>',m.group(0),re.S)]
        out.append((name,rows))
    return out
def group_of(name):
    m=re.search(r'([가나다])군',name)
    if m: return m.group(1)
    m=re.search(r'일반([가나다])',name)
    return m.group(1) if m else None
result=[]
for uni,uid in IDS.items():
    f='hakjum/%s-본교.html'%uni
    url='https://hakjum.school/admissions/'+urllib.parse.quote(uni+'-본교')+'/'
    depts={}
    def dept(name): return depts.setdefault(name,{'name':name,'jeongsi':{},'gyogwa':{},'hakjong':{}})
    counts={'jeongsi':0,'gyogwa':0,'hakjong':0}
    for name,rows in parse(f):
        if not rows or len(rows)<2: continue
        hdr=rows[0]; idx={h:i for i,h in enumerate(hdr)}
        if '모집단위' not in idx: continue
        if EXCLUDE.search(name): continue
        kind = 'jeongsi' if ('수능' in name or '정시' in name) and '백분위70%' in idx else ('gyogwa' if '교과' in name else ('hakjong' if ('종합' in name or '수시' in name) else None))
        if kind is None: continue
        for r in rows[1:]:
            if len(r)<len(hdr): continue
            dn=r[idx['모집단위']]
            if not dn or dn=='모집단위': continue
            quota=num(r[idx['모집']]) if '모집' in idx else None
            if quota==0: continue
            rate=num(r[idx['경쟁률']]) if '경쟁률' in idx else None
            fill=num(r[idx['충원']]) if '충원' in idx else None
            if kind=='jeongsi':
                pct70=num(r[idx['백분위70%']]); pct50=num(r[idx['백분위50%']]) if '백분위50%' in idx else None
                sc70=num(r[idx['환산70%']]) if '환산70%' in idx else None
                if pct70 is None and sc70 is None: continue
                d=dept(dn); g=group_of(name)
                row={'typeName':name,'group':g,'quota':quota,'rate':rate,'fill':fill,'pct70':pct70,'pct50':pct50,'score70':sc70,'source':'adiga-hakjum','url':url}
                if '2026' in d['jeongsi'] and d['jeongsi']['2026'].get('pct70') is not None and pct70 is not None:
                    d['jeongsi'].setdefault('alts',[]).append(row)
                else:
                    d['jeongsi']['2026']=row
                counts['jeongsi']+=1
            else:
                g70=num(r[idx['등급70%']]) if '등급70%' in idx else None
                g50=num(r[idx['등급50%']]) if '등급50%' in idx else None
                if g70 is None and g50 is None: continue
                d=dept(dn)
                row={'typeName':name,'quota':quota,'rate':rate,'fill':fill,'cut70':g70 if g70 is not None else g50,'cut50':g50,'source':'adiga-hakjum','url':url}
                cur=d[kind].get('2026')
                if cur is None or (cur.get('quota') or 0)<(quota or 0): d[kind]['2026']=row
                counts[kind]+=1
    result.append({'id':uid,'name':uni,'url':url,'departments':list(depts.values()),'counts':counts})
    js=[d for d in depts.values() if d['jeongsi']]
    pcts=[d['jeongsi']['2026']['pct70'] for d in js if d['jeongsi']['2026'].get('pct70') is not None]
    print(uni,uid,counts,'depts',len(depts),'jeongsi',len(js),'pct',(min(pcts),max(pcts)) if pcts else None)
    for d in js[:4]: print('   ',d['name'],d['jeongsi']['2026'].get('group'),d['jeongsi']['2026'].get('pct70'))
import io
json.dump(result,io.open('newunis.json','w',encoding='utf8'),ensure_ascii=False,indent=1)
