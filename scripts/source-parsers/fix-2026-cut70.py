# -*- coding: utf-8 -*-
# source/results.json의 2026학년도 정시 70%컷을 대학 공식 입시결과의 소수 값으로 바꾼 기록이다.
# 학점나비(어디가 집계 페이지)가 싣는 백분위는 정수로 반올림돼 있고, 표본 대조에서 반올림으로
# 설명되지 않는 차이도 나왔다. 그래서 대학이 스스로 낸 표에 "최종등록자 70%컷, 국·수·탐(2)
# 백분위 평균"이 그대로 있는 대학만 골라 원값으로 바꾼다. 정의가 다른 값(평균·상위80% 평균 등)은
# 70%컷 자리에 넣지 않고 dept['official']에 kind와 함께 남긴다.
#
# 입력은 각 대학이 낸 PDF를 텍스트로 뽑아 둔 파일이며 저장소에 담지 않는다(용량·재배포 권한).
# 다시 돌리려면 아래 R 경로에 원문 텍스트를 놓고
#   python3 scripts/source-parsers/fix-2026-cut70.py
#   npm run build
# 순서로 실행한다. 값은 파일에 적힌 숫자만 옮기고, 없는 값은 만들지 않는다.
import json, re, sys, unicodedata
from pathlib import Path

R = Path('/tmp/claude-0/-home-user-hvsdcm1/d70081a4-a2de-5ad6-975e-a9922b212bab/scratchpad/research')
ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / 'source' / 'results.json'

NUM = re.compile(r'^\d{1,3}(?:,\d{3})*(?:\.\d+)?$')


def read(rel):
    path = R / rel
    if not path.exists():
        sys.exit('원문 텍스트가 없다: %s' % path)
    return path.read_text(encoding='utf8', errors='replace')


# ---------------------------------------------------------------- 경희대
# 2026학년도 입학전형 통계자료. 정시 「가」/「나」군 표에 최종등록자 백분위 70%CUT(국/수/탐 평균)이
# 그대로 실려 있다. 같은 표의 '상위 80% 평균'은 정의가 달라 official로만 남긴다.
def khu():
    lines = [l.strip() for l in read('raw/khu_2026_stats.fitz.txt').split('\n')]
    head = ['50%CUT', '70%CUT', '총점', '70%CUT', '국어', '수학', '탐구', '국/수/탐', '평균', '영어']
    out, i = {}, 0
    while i < len(lines):
        if lines[i:i + len(head)] != head:
            i += 1
            continue
        i += len(head)
        while i < len(lines):
            name = lines[i]
            if name == '':
                i += 1
                continue
            if NUM.match(name) or name.startswith('==='):
                break
            nums, j = [], i + 1
            while j < len(lines) and len(nums) < 9:
                token = lines[j].replace(' ', '')
                if NUM.match(token):
                    nums.append(float(token.replace(',', '')))
                elif token != '':
                    break
                j += 1
            if len(nums) < 9:
                break
            # 정원 내 「가」/「나」군 표가 먼저 나온다. 뒤의 정원 외 특별전형 표는 덮어쓰지 않는다.
            out.setdefault(name, {'cut70': nums[3], 'avg80': nums[7], 'score70': nums[1]})
            i = j
    return out


# ---------------------------------------------------------------- 건국대
# 2026학년도 전형결과. 수능(KU일반학생)은 모집단위별 과목 백분위의 50%/70% Cut을 싣는다.
# 70%컷의 국어·수학·탐구평균을 산술평균해 국·수·탐 백분위 평균 70%컷을 만든다(대학이 미반영한
# 영역은 빼고 평균한다 — 수학 미반영 모집단위는 국어·탐구 둘의 평균). 베리타스알파가 옮긴
# 같은 대학 값(수의예 96.33·산업디자인 90.75)과 자릿수까지 맞는다.
# 50% Cut은 영역마다 다른 학생의 점수라 평균이 70%컷보다 낮아질 수 있어 옮기지 않는다.
def konkuk():
    text = read('raw/konkuk2026.txt')
    token = r'(?:-|\d{1,3}(?:,\d{3})*(?:\.\d+)?)'
    row = re.compile(r'^(?P<name>[^\d]+?)\s+(?P<rest>(?:' + token + r'\s+){20,}' + token + r')\s*$')
    college = re.compile(r'^(?:[가-힣]+대학|[가-힣]+과학원|[가-힣]+기술원)\s+')
    out = {}
    for section in re.split(r'▷\s*', text):
        head = section.split('\n', 1)[0]
        if '수능(KU일반학생)' not in head:
            continue
        group = next((g for g in '가나다' if g + '군' in head), None)
        for line in section.split('\n'):
            match = row.match(re.sub(r'\s+', ' ', line).strip())
            if not match:
                continue
            cells = match.group('rest').split()
            if len(cells) != 24:
                continue
            name = college.sub('', match.group('name').strip())
            value = lambda text: None if text == '-' else float(text.replace(',', ''))
            cut = [value(cells[15]), value(cells[16]), value(cells[21])]
            got = [v for v in cut if v is not None]
            if not got:
                continue
            out[name] = {
                'cut70': round(sum(got) / len(got), 2), 'group': group,
                'quota': value(cells[0]), 'rate': value(cells[2]), 'lastWait': value(cells[3]),
                'score70': value(cells[5]),
            }
    return out


# ---------------------------------------------------------------- 숭실대
# 2027학년도 입학전형 통계. 정시 일반전형 표가 '수능(백분위) 평균 / 70%'을 그대로 싣고,
# 표 아래에 "국어, 수학, 탐구(2과목) 단순평균"이라고 적혀 있다 — 어디가 70%컷과 같은 정의다.
def soongsil():
    lines = [re.sub(r'\s+', ' ', l).strip() for l in read('dl/ssu2026.txt').split('\n')]
    meta_row = re.compile(r'^(?P<name>.+?) (?P<group>[가나다]) (?P<quota>\d+) [\d,]+ (?P<rate>[\d.]+):1 '
                          r'\d+ (?P<fill>\d+) (?P<fillRate>-?\d+)% (?P<avg>\d+\.\d+) (?P<cut>\d+\.\d+)$')
    meta, inside = {}, False
    for line in lines:
        if line.startswith('정시 일반전형'):
            inside = True
        match = meta_row.match(line)
        if inside and match:
            meta.setdefault(match.group('name'), {
                'group': match.group('group'), 'quota': int(match.group('quota')),
                'rate': float(match.group('rate')), 'fill': int(match.group('fill')),
                'fillRate': int(match.group('fillRate')), 'score70': float(match.group('cut')),
            })
    out, i = {}, 0
    while i < len(lines):
        if not lines[i].startswith('수능(백분위) 수능(백분위)'):
            i += 1
            continue
        j = i + 1
        if lines[j].startswith('평균'):
            j += 1
        while j < len(lines):
            match = re.match(r'^(?P<name>.+?) (?P<avg>\d+\.\d+) (?P<cut>\d+\.\d+)$', lines[j])
            if not match:
                break
            row = {'cut70': float(match.group('cut')), 'avg': float(match.group('avg'))}
            row.update(meta.get(match.group('name'), {}))
            out[match.group('name')] = row
            j += 1
        i = j
    return out


# ---------------------------------------------------------------- 이름 맞추기
SEP = '·・･ㆍ‧∙⋅/,-–—〮&'


def norm(name, drop_paren=False):
    """공백·구분점·괄호·'학부/학과/전공' 같은 꼬리를 지운 비교용 이름."""
    text = unicodedata.normalize('NFKC', str(name))
    if drop_paren:
        text = re.sub(r'\([^)]*\)', '', text)
    text = re.sub(r'[%s()\[\]]' % re.escape(SEP), '', text)
    text = re.sub(r'\s+', '', text)
    for suffix in ('학부', '학과', '전공', '계열'):
        text = text.replace(suffix, '')
    return text


def keys_of(name):
    """표 이름의 1차 비교 키들(괄호 있는 그대로 / 괄호를 뺀 것)."""
    return [k for k in dict.fromkeys([norm(name), norm(name, drop_paren=True)]) if k]


def tail_key(name):
    """'컴퓨터공학부 인공지능학과'처럼 앞에 소속이 붙은 이름의 마지막 토막. 1차 키가 빗나갈 때만 쓴다."""
    parts = name.strip().split()
    return norm(parts[-1]) if len(parts) > 1 else None


def merge(university, table, source, url, kind_note, type_name):
    """table의 값을 university['departments']에 붙이고 (바꾼 수, 못 붙인 이름들)을 돌려준다."""
    index, tails = {}, {}
    for name, row in table.items():
        for key in keys_of(name):
            index.setdefault(key, (name, row))
    for name, row in table.items():
        key = tail_key(name)
        if key and key not in index:
            tails.setdefault(key, (name, row))
    used, changed, deltas, added = set(), 0, [], []
    for dept in university['departments']:
        jeongsi = dept.get('jeongsi', {}).get('2026')
        key = norm(dept['name'])
        if not jeongsi and key not in index:
            # 어디가에도 없고 이름도 정확히 맞지 않으면 건드리지 않는다.
            continue
        hit = index.get(key) or index.get(norm(dept['name'], drop_paren=True)) or tails.get(key)
        if hit is None:
            loose = [k for k in index if k and (k.startswith(key) or key.startswith(k)) and abs(len(k) - len(key)) <= 3]
            hit = index[loose[0]] if len(loose) == 1 else None
            if hit:
                key = loose[0]
        if hit is None:
            continue
        used.add(key)
        used.add(norm(hit[0]))
        name, row = hit
        if jeongsi is None:
            # 어디가에 정시 결과가 없던 모집단위. 대학 표에 있으면 그 표만으로 한 해를 채운다.
            if row.get('cut70') is None or row.get('quota') is None:
                continue
            jeongsi = {'typeName': type_name, 'group': None, 'quota': None, 'rate': None,
                       'fill': None, 'pct70': None, 'pct50': None, 'score70': None}
            dept.setdefault('jeongsi', {})['2026'] = jeongsi
            added.append(dept['name'])
        before = jeongsi.get('pct70')
        if row.get('cut70') is None:
            continue
        jeongsi['pct70'] = row['cut70']
        for field in ('group', 'quota', 'rate', 'fill', 'fillRate', 'lastWait'):
            if row.get(field) is not None:
                jeongsi[field] = row[field]
        if row.get('score70') is not None:
            jeongsi['score70'] = row['score70']
        # 학점나비의 50%컷은 70%컷과 출처가 달라 섞으면 50%컷이 70%컷보다 낮아지는 행이 생긴다.
        # 대체한 행에서는 같은 표가 준 값만 남긴다.
        jeongsi['pct50'] = row.get('cut50')
        jeongsi['source'] = source
        jeongsi['url'] = url
        jeongsi['note'] = ('학점나비 정수 %s 대체' % (('%g' % before) if before is not None else '없음')) + kind_note
        if before is not None:
            deltas.append((abs(row['cut70'] - before), dept['name'], before, row['cut70']))
        changed += 1
        if row.get('avg80') is not None:
            dept.setdefault('official', {}).setdefault('2026', {}).update({
                'avg': row['avg80'], 'kind': '상위80% 평균', 'metric': 'pct', 'adigaStandard': False,
                'note': '국·수·탐 백분위 상위 80% 평균 (70%컷과 정의가 다르다)', 'source': source, 'url': url,
            })
        if row.get('avg') is not None:
            dept.setdefault('official', {}).setdefault('2026', {}).update({
                'avg': row['avg'], 'kind': '등록자 평균', 'metric': 'pct', 'adigaStandard': False,
                'note': '국·수·탐(2) 백분위 등록자 평균 (70%컷과 정의가 다르다)', 'source': source, 'url': url,
            })
    missed = sorted({name for key, (name, _) in index.items() if key not in used}
                    - {name for key, (name, _) in index.items() if key in used})
    return changed, missed, deltas, added


SOURCES = {
    'khu': (khu, '경희대학교 2026학년도 입학전형 통계자료(정시 수능위주 백분위 70%CUT)',
            'https://iphak.khu.ac.kr/', ' — 대학이 낸 국·수·탐 백분위 70%CUT', '수능위주'),
    'konkuk': (konkuk, '건국대학교 2026학년도 전형결과(수능 KU일반학생 과목별 백분위 70% Cut)',
               'https://enter.konkuk.ac.kr/', ' — 과목별 70%Cut의 국·수·탐 산술평균', '수능(KU일반학생)'),
    'soongsil': (soongsil, '숭실대학교 2027학년도 입학전형 통계(정시 일반전형 수능 백분위 70%)',
                 'https://admission.ssu.ac.kr/', ' — 국어·수학·탐구(2과목) 단순평균 70%', '수능(일반전형)'),
}


def drop_mixed_cut50(data):
    """70%컷을 대학 공식값으로 바꾼 행에 학점나비 50%컷이 남아 있으면 지운다(출처가 섞인다)."""
    dropped = 0
    for university in data:
        for dept in university['departments']:
            for row in (dept.get('jeongsi') or {}).values():
                if not isinstance(row, dict) or row.get('source') == 'adiga-hakjum':
                    continue
                if row.get('pct50') is not None and row.get('cut50Source') is None:
                    row['pct50'] = None
                    dropped += 1
    return dropped


def fill_floor(data):
    """대학이 낸 '최종등록자 최저' 백분위를 100%컷으로 옮긴다. 같은 해 70%컷보다 높으면
       두 값의 정의가 어긋난다는 뜻이라 옮기지 않는다."""
    filled = 0
    for university in data:
        for dept in university['departments']:
            official = dept.get('official') or {}
            for year, row in (dept.get('jeongsi') or {}).items():
                source = official.get(year)
                if not isinstance(row, dict) or not isinstance(source, dict):
                    continue
                low = source.get('min')
                if source.get('metric') != 'pct' or not isinstance(low, (int, float)):
                    continue
                cut = row.get('pct70')
                if not isinstance(cut, (int, float)) or low > cut:
                    continue
                row['pct100'] = low
                filled += 1
    return filled


def main():
    data = json.loads(RESULTS.read_text(encoding='utf8'))
    by_id = {row['id']: row for row in data}
    report = []
    for uid, (parse, source, url, note, type_name) in SOURCES.items():
        table = parse()
        changed, missed, deltas, added = merge(by_id[uid], table, source, url, note, type_name)
        total = sum(1 for d in by_id[uid]['departments'] if d.get('jeongsi', {}).get('2026'))
        deltas.sort(reverse=True)
        report.append((uid, changed, total, len(table),
                       round(sum(d[0] for d in deltas) / len(deltas), 2) if deltas else 0,
                       round(deltas[0][0], 2) if deltas else 0, missed, deltas[:3], added))
    dropped = drop_mixed_cut50(data)
    filled = fill_floor(data)
    RESULTS.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    print('출처가 섞인 50%%컷 %d개를 비웠고, 100%%컷 %d개를 채웠다.' % (dropped, filled))
    print('%-10s %6s %6s %6s %8s %8s' % ('대학', '대체', '전체', '표', '평균차', '최대차'))
    for uid, changed, total, rows, mean, worst, missed, top, added in report:
        print('%-10s %6d %6d %6d %8.2f %8.2f' % (uid, changed, total, rows, mean, worst))
        for gap, name, before, after in top:
            print('   최대차 %5.2f  %s  %g → %g' % (gap, name, before, after))
        if added:
            print('   새로 채운 모집단위:', ', '.join(added))
        if missed:
            print('   못 붙인 표 이름:', ', '.join(missed))


if __name__ == '__main__':
    main()
