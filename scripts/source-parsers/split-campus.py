# -*- coding: utf-8 -*-
# 캠퍼스가 다른 모집단위가 한 항목에 섞이지 않게 하는 기록이다.
# (1) 한국외국어대학교를 서울캠퍼스와 글로벌캠퍼스(용인) 두 항목으로 가른다.
# (2) 한양대 서울캠퍼스와 ERICA에 같은 이름의 모집단위가 있으면 ERICA 쪽에 캠퍼스를 붙인다.
# 어디가(학점나비) 페이지는 두 캠퍼스를 '한국외국어대학교[본교]' 하나로 묶어 싣는데, 두 캠퍼스는
# 모집단위도 수능 반영비율도 다르다. 캠퍼스 배정과 영역별 반영비율은 아래 한 자료에서만 옮겼다:
#   한국외국어대학교 2027학년도 대학입학전형시행계획
#     · 3. 모집단위 및 모집인원(안) — '캠퍼스' 열
#     · 10. 정시 수능(일반전형) 2-가. 전형요소 및 반영비율 — 모집단위별 국/수/영/탐 비율표
# 한양대는 학점나비도 '한양대학교[본교]'와 '한양대학교(ERICA)[분교]'로 따로 싣는다 — 두 페이지에서
# 온 이름이 같을 때만 뒤에 (ERICA)를 붙이고, 값 자체는 건드리지 않는다.
# 다시 돌리려면 python3 scripts/source-parsers/split-campus.py 뒤에 npm run build.
import json, re, unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / 'source' / 'results.json'
RULES = ROOT / 'source' / 'rules-2027.json'
PLAN = 'https://adms.hufs.ac.kr/'

# 반영비율표의 세 묶음. (국어, 수학, 영어, 탐구) — 총점 1,000점.
GROUPS = {
    '인문': (30, 30, 20, 20),
    '상경': (30, 35, 15, 20),
    '자연': (20, 35, 15, 30),
}

SEOUL = {
    '인문': ['영미문학·문화학과', '영어통번역학과', '프랑스어학부', '독일어과', '노어과', '스페인어과',
             '이탈리아어과', '포르투갈어과', '네덜란드어과', '스칸디나비아어과', '말레이·인도네시아어과',
             '태국학과', '베트남어과', '인도어과', '아랍어과', '튀르키예·아제르바이잔학과',
             '페르시아어·이란학과', '몽골어과', '중국언어문화학부', '중국외교통상학부', '일본언어문화학부',
             '융합일본지역학부', '영어교육과', '한국어교육과', '영어대학[통합모집]', '핵심외국어계열',
             '특수외국어(유럽지역)계열', '특수외국어(인도·아세안지역)계열', '특수외국어(중동지역)계열',
             '중국학대학[통합모집]', '일본학대학[통합모집]', '자유전공학부(서울)'],
    '상경': ['ELLT학과', '정치외교학과', '행정학과', '미디어커뮤니케이션학부', '국제통상학과', '경제학부',
             'Social Science & AI융합학부', '경영학부', '국제학부', 'Language & Diplomacy학부',
             'Language & Trade학부', '사회과학대학[통합모집]', '상경대학[통합모집]'],
    '자연': ['Language & AI융합학부'],
}
GLOBAL = {
    '인문': ['철학과', '사학과', '언어인지과학과', '폴란드학과', '루마니아학과', '체코·슬로바키아학과',
             '헝가리학과', '세르비아·크로아티아학과', '그리스·불가리아학과', '중앙아시아학과', '아프리카학부',
             '우크라이나학과', '한국학과', '디지털콘텐츠학부', '투어리즘 & 웰니스학부', '인문대학[통합모집]',
             '국가전략언어계열', 'Culture & Technology융합대학[통합모집]', '자유전공학부(글로벌)'],
    '상경': ['Global Business & Technology학부', '국제금융학과', '글로벌스포츠산업학부',
             'Finance & AI융합학부', '융합인재학부', '경상대학[통합모집]'],
    '자연': ['수학과', '통계학과', '전자물리학과', '환경학과', '생명공학과', '화학과', '컴퓨터공학부',
             '정보통신공학과', '반도체전자공학부(반도체공학전공)', '반도체전자공학부(전자공학전공)',
             '산업경영공학과', 'AI데이터융합학부', '바이오메디컬공학부', '기후변화융합학부',
             '자연과학대학[통합모집]', '공과계열', 'AI융합대학[통합모집]'],
}

SEP = '·・･ㆍ‧∙⋅.&'


def norm(name):
    text = unicodedata.normalize('NFKC', str(name))
    text = re.sub(r'[%s]' % re.escape(SEP), '', text)
    return re.sub(r'\s+', '', text)


def english_table(ratio):
    """영어 등급 환산점수. 시행계획은 반영비율 20%와 15% 두 표만 싣는다."""
    if ratio == 20:
        return {'1': 200, '2': 198, '3': 194, '4': 188, '5': 180, '6': 170, '7': 150, '8': 120, '9': 0}
    return {'1': 150, '2': 148.5, '3': 145.5, '4': 141, '5': 135, '6': 127.5, '7': 112.5, '8': 90, '9': 0}


HISTORY = {'1': 0, '2': -0.2, '3': -0.4, '4': -0.6, '5': -0.8, '6': -1, '7': -2, '8': -2, '9': -2}


def tracks_for(campus):
    out = []
    for name, (kor, math, eng, inq) in GROUPS.items():
        out.append({
            'name': name,
            'appliesTo': '%s 모집단위 (국 %d·수 %d·영 %d·탐 %d)' % (campus, kor, math, eng, inq),
            'unit': 'percent',
            'weights': {'kor': kor, 'math': math, 'eng': eng, 'inq': inq},
            'english': {'method': '비율반영', 'table': english_table(eng),
                        'note': '영어 반영비율 %d%% 모집단위 표' % eng},
            'history': {'method': '감산', 'table': dict(HISTORY), 'total': 1000,
                        'note': '시행계획 표가 7등급까지만 보여 8·9등급은 7등급 값(-2)을 이어 적었다(미확인).'},
            'inquiry': {'count': 2, 'allowed': '사탐/과탐 모두'},
        })
    return out


def mark_hanyang(data):
    """한양대 서울/ERICA에 같은 이름이 있으면 ERICA 쪽 이름에 캠퍼스를 붙인다."""
    seoul = next(row for row in data if row['id'] == 'hanyang')
    erica = next(row for row in data if row['id'] == 'hanyang-erica')
    for dept in seoul['departments']:
        dept['campus'] = '서울캠퍼스'
    names = {dept['name'] for dept in seoul['departments']}
    renamed = []
    for dept in erica['departments']:
        dept['campus'] = 'ERICA캠퍼스'
        if dept['name'] in names and not dept['name'].endswith('(ERICA)'):
            renamed.append(dept['name'])
            dept['name'] = '%s(ERICA)' % dept['name']
    print('한양대 ERICA에서 이름이 겹쳐 캠퍼스를 붙인 모집단위: %s' % (', '.join(renamed) or '없음'))


def main():
    data = json.loads(RESULTS.read_text(encoding='utf8'))
    rules = json.loads(RULES.read_text(encoding='utf8'))
    hufs = next(row for row in data if row['id'] == 'hufs')

    plan = {}
    for campus, groups in (('서울', SEOUL), ('글로벌', GLOBAL)):
        for track, names in groups.items():
            for name in names:
                plan[norm(name)] = (campus, track)

    seoul, glob, unknown = [], [], []
    for dept in hufs['departments']:
        hit = plan.get(norm(dept['name']))
        if hit is None:
            unknown.append(dept['name'])
            continue
        campus, track = hit
        dept['campus'] = '서울캠퍼스' if campus == '서울' else '글로벌캠퍼스'
        dept['ruleTrack'] = track
        (seoul if campus == '서울' else glob).append(dept)
    if unknown:
        raise SystemExit('시행계획 표에 없는 모집단위: %s' % ', '.join(unknown))

    hufs['name'] = '한국외국어대학교(서울캠퍼스)'
    hufs['departments'] = seoul
    data.insert(data.index(hufs) + 1, {
        'id': 'hufs-global', 'name': '한국외국어대학교(글로벌캠퍼스)', 'url': hufs['url'],
        'departments': glob,
    })
    mark_hanyang(data)
    RESULTS.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf8')

    source = [{'title': '한국외국어대학교 2027학년도 입학전형 시행계획', 'url': PLAN}]
    rules['universities']['hufs'] = {
        'name': '한국외국어대학교(서울캠퍼스)', 'year': 2027, 'basis': '표준점수(탐구 변환표준점수)',
        'tracks': tracks_for('서울캠퍼스'),
        'changes2027': '서울캠퍼스 — 어문·사범 국30·수30·영20·탐20, 상경/사회 국30·수35·영15·탐20, '
                       'Language & AI융합 국20·수35·영15·탐30. 총점 1,000점.',
        'sources': source,
    }
    rules['universities']['hufs-global'] = {
        'name': '한국외국어대학교(글로벌캠퍼스)', 'year': 2027, 'basis': '표준점수(탐구 변환표준점수)',
        'tracks': tracks_for('글로벌캠퍼스'),
        'changes2027': '글로벌캠퍼스 — 인문·국가전략언어 국30·수30·영20·탐20, 경상·융합인재 국30·수35·영15·탐20, '
                       '자연·공과 국20·수35·영15·탐30. 총점 1,000점.',
        'sources': source,
    }
    RULES.write_text(json.dumps(rules, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    print('서울 %d개, 글로벌 %d개 모집단위' % (len(seoul), len(glob)))


if __name__ == '__main__':
    main()
