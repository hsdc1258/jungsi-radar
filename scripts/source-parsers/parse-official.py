# -*- coding: utf-8 -*-
# 이 스크립트는 source/results.json 의 `official`(대학 공식 발표 정시 결과)을 만든 기록이다.
# 입력은 각 대학이 낸 입시결과 PDF·HTML을 텍스트로 뽑아 둔 파일들이며 저장소에 담지 않는다
# (용량이 크고 재배포 권한이 없다). 다시 돌리려면 아래 R 경로에 원문 텍스트를 놓고
#   python3 scripts/source-parsers/parse-official.py
#   python3 scripts/source-parsers/merge-official.py
#   npm run build
# 순서로 실행한다. 값은 파일에 적힌 숫자만 옮기고, 없는 값은 만들지 않는다.
"""대학 공식 입시결과 텍스트 → {uid: {학과명: {연도: {...}}}}.
   값의 종류(kind)와 지표(metric)를 함께 남긴다. 숫자는 파일에 적힌 것만 쓴다."""
import re, json

R = '/tmp/claude-0/-home-user-hvsdcm1/d70081a4-a2de-5ad6-975e-a9922b212bab/scratchpad/research/'
read = lambda p: open(R + p, encoding='utf8').read()
NUMTOK = re.compile(r'^-?[\d,]+(\.\d+)?$')

out = {}


def put(uid, name, year, row):
    out.setdefault(uid, {}).setdefault(name.strip(), {}).setdefault(year, {}).update(row)


# ---------- 단국대(죽전) : 최저/평균/최고 백분위 ----------
def dankook(path, year, url):
    n = 0
    for line in read(path).splitlines():
        line = line.strip()
        if not line.startswith('정원내'):
            continue
        toks = line.split()
        idx = next((i for i, t in enumerate(toks) if NUMTOK.match(t)), None)
        if idx is None or idx < 3:
            continue
        start = 3 if toks[2] in ('인문', '자연', '예체능', '-') else 2
        name = ' '.join(toks[start:idx])
        vals = [float(t.replace(',', '')) for t in toks[idx:] if NUMTOK.match(t)]
        trip = None
        for i in range(len(vals) - 3, -1, -1):
            a, b, c = vals[i:i + 3]
            if 40 <= a <= 100 and a <= b <= c <= 100 and a != int(a):
                trip = (a, b, c)
                break
        if not trip or not name:
            continue
        put('dankook', name, year, {'avg': trip[1], 'min': trip[0], 'max': trip[2],
                                    'kind': '평균', 'metric': 'pct', 'note': '국·수·탐 백분위 최저/평균/최고',
                                    'source': '단국대학교 %s학년도 정시모집 입시결과' % year, 'url': url})
        n += 1
    return n


# ---------- 광운대 : 백분위(국,수,탐) 등록자 산술평균. 정원내 표가 먼저 나오므로 첫 등장만 쓴다 ----------
def kwangwoon(path, year, url):
    lines = [l.strip() for l in read(path).splitlines()]
    row = re.compile(r'^(.*?)\s+(\d+)\s+([\d,]+)\s+(\d+\.\d)\s+(\d+\.\d\d)\s+(\d\.\d\d)\s+(\d+\.\d\d)\s+(\d+\.\d\d)\s+')
    n, buf, seen = 0, '', set()
    for l in lines:
        m = row.match(l)
        if m:
            name = re.sub(r'^(자연|인문|예체능)\s+', '', (buf + ' ' + m.group(1)).strip())
            buf = ''
            if '전체' in name or not name or name in seen:
                continue
            seen.add(name)
            put('kw', name, year, {'avg': float(m.group(7)), 'quota': int(m.group(2)), 'rate': float(m.group(4)),
                                   'kind': '평균', 'metric': 'pct', 'note': '국·수·탐 백분위 산술평균(가산점 미적용)',
                                   'source': '광운대학교 %s학년도 정시모집 입시결과' % year, 'url': url})
            n += 1
        else:
            buf = l if (l and len(l) < 30 and not re.search(r'\d', l) and not l.startswith('=')) else ''
    return n


# ---------- 숭실대 : 3개년 수능백분위평균(국수탐) 추이표 ----------
def soongsil_trend(path, fallback_years, url):
    lines = [l.strip() for l in read(path).splitlines()]
    n = 0
    for i, l in enumerate(lines):
        if '수능백분위평균(국수탐)' not in l:
            continue
        head = lines[i + 1] if i + 1 < len(lines) else ''
        years = re.findall(r'20\d\d', head)[-3:] or fallback_years
        for l2 in lines[i + 2:]:
            if not l2 or l2.startswith('=====') or '전형' in l2:
                break
            toks = l2.split()
            if len(toks) < 10:
                continue
            vals = toks[-3:]
            name = ' '.join(toks[:len(toks) - 9])
            if not name or re.search(r'\d', name.replace('IT', '')):
                continue
            for y, v in zip(years, vals):
                if not re.match(r'^\d+\.\d+$', v):
                    continue
                put('soongsil', name, y, {'avg': float(v), 'kind': '평균', 'metric': 'pct',
                                          'note': '수능 백분위 평균(국·수·탐)',
                                          'source': '숭실대학교 %s학년도 입학전형 통계(3개년 추이)' % years[-1], 'url': url})
                n += 1
    return n


# ---------- 숭실대 : 해당 연도 수능 백분위 평균·70%컷 ----------
def soongsil_cut(path, year, url):
    lines = [l.strip() for l in read(path).splitlines()]
    n, on = 0, False
    for l in lines:
        if l.startswith('수능(백분위)'):
            on = True
            continue
        if not on:
            continue
        m = re.match(r'^([가-힣A-Za-z0-9·・·\s()]+?)\s+(\d{2}\.\d\d)\s+(\d{2}\.\d\d)$', l)
        if m:
            put('soongsil', m.group(1), year, {'avg': float(m.group(2)), 'cut70': float(m.group(3)),
                                               'kind': '70%컷', 'metric': 'pct', 'note': '수능 백분위 평균·70%컷',
                                               'source': '숭실대학교 %s학년도 입학전형 통계' % year, 'url': url})
            n += 1
        elif l.startswith('=====') or '전형' in l:
            on = False
    return n


# ---------- 경희대 : 국/수/탐 백분위 70%CUT (모집단위 이름 + 숫자 9줄) ----------
def khu(path, year, url):
    """모집단위 이름 뒤에 숫자 8줄(2025: 70%cut·총점·…) 또는 9줄(2026: 50%cut·70%cut·총점·…)이 온다."""
    lines = [l.strip() for l in read(path).splitlines()]
    n, i = 0, 0
    while i < len(lines) - 11:
        name = lines[i]
        if not (name and not NUMTOK.match(name) and re.match(r'^[가-힣A-Za-z0-9·・·()/&\s]+$', name)):
            i += 1
            continue
        matched = False
        for size in (9, 8):
            block = lines[i + 1:i + 1 + size]
            if len(block) != size or not all(NUMTOK.match(x) for x in block):
                continue
            v = [float(x) for x in block]
            t = 2 if size == 9 else 1
            if v[t] not in (600.0, 700.0, 800.0, 1000.0):
                continue
            cut70, avg80, eng = v[t + 1], v[t + 5], v[t + 6]
            if not (30 <= cut70 <= 100 and 30 <= avg80 <= 100 and 1 <= eng <= 9):
                continue
            put('khu', name, year, {'cut70': cut70, 'avg80': avg80, 'score70': v[t - 1], 'total': v[t],
                                    'kind': '70%컷', 'metric': 'pct', 'note': '국/수/탐 백분위 70%컷',
                                    'source': '경희대학교 %s학년도 입학전형 통계자료' % year, 'url': url})
            n += 1
            i += 1 + size
            matched = True
            break
        if not matched:
            i += 1
    return n


# ---------- 이화여대 : 국·수·탐 백분위 50%/70% cut (2025·2026) ----------
def ewha(path, url):
    lines = [l.strip() for l in read(path).splitlines()]
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith('Ⅳ. 수능(수능전형)') and i > 100)
    except StopIteration:
        return 0
    n, i = 0, start
    while i < len(lines) - 12:
        l = lines[i]
        nxt = lines[i + 1]
        if (l and not NUMTOK.match(l) and re.match(r'^[가-힣A-Za-z0-9·・·()\s]+$', l)
                and nxt in ('인문', '자연', '예체능', '인문/자연', '자연/인문')):
            v, k = [], i + 2
            while k < len(lines) and len(v) < 10:
                t = lines[k]
                if NUMTOK.match(t):
                    v.append(float(t))
                elif re.match(r'^[\d.]+\s*:\s*1$', t):
                    v.append(None)
                else:
                    break
                k += 1
            plain = [x for x in v if x is not None]
            if len(plain) >= 6:
                c50, c70 = plain[2:4], plain[4:6]
                for yr, a, b in (('2025', c50[0], c70[0]), ('2026', c50[1], c70[1])):
                    if 30 <= b <= 100 and 30 <= a <= 100:
                        put('ewha', l, yr, {'cut70': b, 'cut50': a, 'kind': '70%컷', 'metric': 'pct',
                                            'note': '국·수·탐 백분위 70%컷', 'track': nxt,
                                            'source': '이화여자대학교 %s학년도 수능전형 입시결과' % yr, 'url': url})
                        n += 1
            i = max(k, i + 1)
        else:
            i += 1
    return n


# ---------- 삼육대 : 수능 백분위 최고/평균 (일반전형) ----------
def syu(path, year, url):
    lines = [l.strip() for l in read(path).splitlines()]
    n, name = 0, ''
    for l in lines:
        m = re.match(r'^(.*?)일반\s+(\d+)\s+([\d,]+)\s+(\d+\.\d\d)\s+(\d+)\s+(\d\.\d\d)\s+(\d\.\d\d)\s+(\d+\.\d\d)\s+(\d+\.\d\d)$', l)
        if m:
            nm = re.sub(r'\s+', '', (name + ' ' + m.group(1)).strip())
            nm = re.sub(r'^(가|나|다)군', '', nm)
            if nm:
                put('syu', nm, year, {'avg': float(m.group(9)), 'max': float(m.group(8)),
                                      'kind': '평균', 'metric': 'pct', 'note': '수능 백분위 평균(가산점 포함)',
                                      'source': '삼육대학교 %s학년도 정시모집 입시결과' % year, 'url': url})
                n += 1
            name = ''
        elif l and not re.search(r'\d', l) and len(l) < 20 and re.match(r'^[가-힣A-Za-z()·년제\s]+$', l):
            name = (name + l).strip()
        elif re.search(r'\d', l):
            name = ''
    return n


# ---------- 동국대 : 최종등록자 상위 80% 국·수·탐 백분위 평균 ----------
def dongguk(path, year, url):
    lines = [l.strip() for l in read(path).splitlines()]
    heads = [i for i, l in enumerate(lines) if '전형별 수능 성적' in l]
    if not heads:
        return 0
    start, end = heads[0], heads[1] if len(heads) > 1 else len(lines)
    n = 0
    for l in lines[start:end]:
        m = re.search(r'([가-힣A-Za-z0-9·・·ㄱ-ㆎ()\s]+?)\s+([가나다])\s+(\d+)\s+(\d+\.\d\d)\s+(\d+\.\d\d)\s+(\d\.\d\d)\s+(\d+\.\d\d)\s+(\d+\.\d\d)\s+(\d+\.\d\d)(?:\s+(\d+\.\d\d))?\s*$', l)
        if not m:
            continue
        name = re.sub(r'^(불교|문과|이과|법과|사회과학|경찰사법|경영|바이오\s*시스템|사범|공과|AI융합|약학|미래융합|첨단융합|문화예술)\s+', '', m.group(1).strip())
        put('dongguk', name, year, {'avg': float(m.group(8)), 'group': m.group(2), 'quota': int(m.group(3)),
                                    'kor': float(m.group(4)), 'math': float(m.group(5)),
                                    'eng': float(m.group(6)), 'inq': float(m.group(7)),
                                    'kind': '80%평균', 'metric': 'pct',
                                    'note': '최종등록자 상위 80% 국·수·탐 백분위 평균',
                                    'source': '동국대학교(서울) %s학년도 입학전형 결과' % year, 'url': url})
        n += 1
    return n


# ---------- 성균관대 : 2025 어디가 공개표준안(70%컷 등록자의 과목별 백분위) ----------
def skku(path, year, url):
    lines = [l.strip() for l in read(path).splitlines()]
    n, i = 0, 0
    while i < len(lines) - 25:
        if lines[i] in ('가', '나', '다') and lines[i + 1] and not NUMTOK.match(lines[i + 1]) \
                and re.match(r'^[가-힣A-Za-z0-9·・()\s]+$', lines[i + 1]):
            v = []
            for t in lines[i + 2:i + 24]:
                if NUMTOK.match(t):
                    v.append(float(t))
                else:
                    break
            if len(v) >= 20:
                kor, math, i1, i2 = v[14], v[15], v[16], v[17]
                if all(0 <= x <= 100 for x in (kor, math, i1, i2)):
                    avg = round((kor + math + (i1 + i2) / 2) / 3, 2)
                    put('skku', lines[i + 1], year,
                        {'cut70': avg, 'kind': '70%컷', 'metric': 'pct', 'group': lines[i], 'adigaStandard': True,
                         'kor': kor, 'math': math, 'inq': round((i1 + i2) / 2, 2),
                         'note': '어디가 공개표준안 70%컷 등록자의 국·수·탐 백분위 평균',
                         'source': '성균관대학교 %s학년도 결과공개(공개표준안)' % year, 'url': url})
                    n += 1
                i += 24
                continue
        i += 1
    return n


URLS = {
    'dankook': 'https://ipsi.dankook.ac.kr/',
    'kw': 'https://iphak.kw.ac.kr/',
    'soongsil': 'https://admission.ssu.ac.kr/',
    'khu': 'https://iphak.khu.ac.kr/',
    'ewha': 'https://admission.ewha.ac.kr/',
    'syu': 'https://ipsi.syu.ac.kr/',
    'dongguk': 'https://ipsi.dongguk.edu/',
    'skku': 'https://admission.skku.edu/',
}

report = [
    ('dankook 2024', dankook('dl/dk2024j.txt', '2024', URLS['dankook'])),
    ('dankook 2025', dankook('dl/dk2025j.txt', '2025', URLS['dankook'])),
    ('dankook 2026', dankook('dl/dk2026j.txt', '2026', URLS['dankook'])),
    ('kw 2024', kwangwoon('dl/kw2024.txt', '2024', URLS['kw'])),
    ('kw 2025', kwangwoon('dl/kw2025.txt', '2025', URLS['kw'])),
    ('kw 2026', kwangwoon('dl/kw2026.txt', '2026', URLS['kw'])),
    ('soongsil trend(2023-2025)', soongsil_trend('dl/ssu2025.txt', ['2023', '2024', '2025'], URLS['soongsil'])),
    ('soongsil trend(2024-2026)', soongsil_trend('dl/ssu2026.txt', ['2024', '2025', '2026'], URLS['soongsil'])),
    ('soongsil cut 2026', soongsil_cut('dl/ssu2026.txt', '2026', URLS['soongsil'])),
    ('khu 2025', khu('raw/khu_2025_stats.fitz.txt', '2025', URLS['khu'])),
    ('khu 2026', khu('raw/khu_2026_stats.fitz.txt', '2026', URLS['khu'])),
    ('ewha 2025+2026', ewha('raw/ewha_2024_2026.fitz.txt', URLS['ewha'])),
    ('syu 2025', syu('raw/neg_삼육대학교_2025_정시입시결과.txt', '2025', URLS['syu'])),
    ('dongguk 2024', dongguk('raw/dongguk2024j.txt', '2024', URLS['dongguk'])),
    ('dongguk 2025', dongguk('raw/dongguk2025.txt', '2025', URLS['dongguk'])),
    ('dongguk 2026', dongguk('raw/dongguk2026.txt', '2026', URLS['dongguk'])),
    ('skku 2025', skku('src/skku2025_adiga.txt', '2025', URLS['skku'])),
]
for r in report:
    print(r)
json.dump(out, open('scripts/source-parsers/official.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print({k: len(v) for k, v in out.items()})


# ---------- 명지대 : 정시 수능(일반전형) 백분위 70%cut·평균 (2024·2025·2026) ----------
def myongji(path, year, url):
    text = open(path, encoding='utf8').read()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    n, name, buf = 0, None, []
    for l in lines:
        if NUMTOK.match(l):
            if name:
                buf.append(float(l.replace(',', '')))
            continue
        if name and len(buf) >= 14:
            put('mju', name, year, {'cut70': buf[11], 'avg': buf[10], 'max': buf[9], 'min': buf[12],
                                    'score70': buf[6], 'quota': int(buf[0]), 'rate': buf[2],
                                    'kind': '70%컷', 'metric': 'pct', 'adigaStandard': True,
                                    'note': '최종등록자 국어·수학·탐구(상위 1과목) 백분위 평균의 70%컷',
                                    'source': '명지대학교 %s학년도 정시모집 수능(일반전형) 입시결과' % year, 'url': url})
            n += 1
        name, buf = (l, []) if re.match(r'^[가-힣A-Za-z0-9·・()\s]+$', l) and len(l) <= 30 else (None, [])
    if name and len(buf) >= 14:
        put('mju', name, year, {'cut70': buf[11], 'avg': buf[10], 'max': buf[9], 'min': buf[12],
                                'score70': buf[6], 'quota': int(buf[0]), 'rate': buf[2],
                                'kind': '70%컷', 'metric': 'pct', 'adigaStandard': True,
                                'note': '최종등록자 국어·수학·탐구(상위 1과목) 백분위 평균의 70%컷',
                                'source': '명지대학교 %s학년도 정시모집 수능(일반전형) 입시결과' % year, 'url': url})
        n += 1
    return n


MJ = 'https://ipsi.mju.ac.kr/'
D = '/tmp/claude-0/-home-user-hvsdcm1/d70081a4-a2de-5ad6-975e-a9922b212bab/scratchpad/research/dl/'
for _y, _f in (('2024', 'mj24j.bin.txt'), ('2025', 'mj25j.bin.txt'), ('2026', 'mj26j_a.bin.txt')):
    print(('mju ' + _y, myongji(D + _f, _y, MJ)))
json.dump(out, open('scripts/source-parsers/official.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
