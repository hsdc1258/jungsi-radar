# -*- coding: utf-8 -*-
# 이 스크립트는 source/results.json 의 `official`(대학 공식 발표 정시 결과)을 만든 기록이다.
# 입력은 각 대학이 낸 입시결과 PDF·HTML을 텍스트로 뽑아 둔 파일들이며 저장소에 담지 않는다
# (용량이 크고 재배포 권한이 없다). 다시 돌리려면 아래 R 경로에 원문 텍스트를 놓고
#   python3 scripts/source-parsers/parse-official.py
#   python3 scripts/source-parsers/merge-official.py
#   npm run build
# 순서로 실행한다. 값은 파일에 적힌 숫자만 옮기고, 없는 값은 만들지 않는다.
"""official.json(대학 공식 발표값)을 source/results.json의 각 학과 `official`에 붙인다.
   학과명은 공백·구분점·괄호를 없앤 형태로 맞추고, 실패 목록을 보고한다."""
import json, re, unicodedata, statistics, sys

SEP = '·・･ㆍ‧∙⋅/,-–—〮'
def norm(s):
    s = unicodedata.normalize('NFKC', str(s))
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'[%s]' % re.escape(SEP), '', s)
    s = re.sub(r'\s+', '', s)
    s = s.replace('학부', '').replace('학과', '').replace('전공', '').replace('계열', '')
    return s

official = json.load(open('scripts/source-parsers/official.json', encoding='utf8'))
data = json.load(open('source/results.json', encoding='utf8'))
by_id = {u['id']: u for u in data}

report = {}
for uid, depts in official.items():
    uni = by_id.get(uid)
    if not uni:
        continue
    index = {}
    for name, years in depts.items():
        index.setdefault(norm(name), []).append((name, years))
    used = set()
    matched = 0
    for dept in uni['departments']:
        key = norm(dept['name'])
        cand = index.get(key)
        if not cand:
            # 부분 일치(한쪽이 다른 쪽을 포함)로 한 번 더 시도한다.
            hits = [k for k in index if k and (k.startswith(key) or key.startswith(k)) and abs(len(k) - len(key)) <= 4]
            cand = index[hits[0]] if len(hits) == 1 else None
            if cand:
                key = hits[0]
        if not cand:
            continue
        used.add(key)
        merged = {}
        for _, years in cand:
            for y, row in years.items():
                merged.setdefault(y, {}).update(row)
        dept['official'] = merged
        matched += 1
    report[uid] = {
        'depts': len(uni['departments']),
        'matched': matched,
        'unmatched_source': sorted(k for k in index if k not in used),
    }

json.dump(data, open('source/results.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)

for uid, r in report.items():
    print('%-9s 학과 %3d 중 %3d 매칭, 미사용 공식자료 %d개: %s'
          % (uid, r['depts'], r['matched'], len(r['unmatched_source']), ', '.join(r['unmatched_source'][:8])))

# ---- 어디가 2026값과 공식 2026값의 수준 차이(보정 계수 진단) ----
print('\n[2026년 어디가 70%컷 대비 공식값 차이]')
for uid in report:
    diffs = []
    for dept in by_id[uid]['departments']:
        j = (dept.get('jeongsi') or {}).get('2026') or {}
        o = (dept.get('official') or {}).get('2026') or {}
        a = j.get('pct70')
        b = o.get('cut70', o.get('avg'))
        if a is not None and b is not None:
            diffs.append(round(b - a, 2))
    if diffs:
        diffs.sort()
        print('  %-9s n=%2d 중앙값 %+.2f  사분위폭 %.2f  (최소 %+.2f, 최대 %+.2f)'
              % (uid, len(diffs), statistics.median(diffs),
                 diffs[int(len(diffs) * .75)] - diffs[int(len(diffs) * .25)], diffs[0], diffs[-1]))

# ---- 명지대 보강: 어디가에 정시 결과가 없는 단과대학은 대학 공식 발표값을 정시 결과로 직접 넣는다 ----
mju = by_id['mju']
have = {norm(d['name']) for d in mju['departments'] if [k for k in d.get('jeongsi', {}) if k != 'alts']}
added = []
for name, years in official.get('mju', {}).items():
    if norm(name) in have:
        continue
    dept = next((d for d in mju['departments'] if norm(d['name']) == norm(name)), None)
    if dept is None:
        dept = {'name': name, 'jeongsi': {}, 'gyogwa': {}, 'hakjong': {}}
        mju['departments'].append(dept)
    for y, row in years.items():
        dept['jeongsi'][y] = {
            'typeName': '수능(일반전형)', 'group': None, 'quota': row.get('quota'), 'rate': row.get('rate'),
            'fill': None, 'pct70': row['cut70'], 'pct50': None, 'score70': row.get('score70'),
            'source': row['source'], 'url': row['url'],
        }
    added.append(name)
json.dump(data, open('source/results.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print('\n명지대 보강: %d개 모집단위 추가 — %s' % (len(added), ', '.join(added)))
