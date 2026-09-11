// 입시 진단 데이터 생성기.
//   source/results.json      (연도별 정시·수시 입시결과 — 어디가 공개값과 각 대학 공식 입시결과)
//   source/rules-2027.json   (2027학년도 정시 수능 반영 방법 — 각 대학 시행계획)
//   source/scales-2026.json  (수능 등급컷 기준표)
// 를 합쳐 assets/data.js(window.IPSI_DATA)를 만든다. 생성물은 손으로 고치지 않는다 —
// 소스를 고치고 `npm run build`를 다시 돌린다. tests/*.test.mjs가 생성물의 범위·출처
// 불변식을 검사한다.
//
// 계열 분류는 모집단위 이름의 키워드로 정한다. 어디가 표에는 계열이 없으므로 여기서 도출하고,
// 애매한 이름은 인문으로 둔다(자연계 가산점을 잘못 얹는 쪽보다 안전하다).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { computeAccuracy } from './accuracy-report.mjs';
import { normalizeDept } from './source-parsers/dept-name.mjs';
import { TYPE_KINDS, TYPE_LABEL, classifyType, compareTypeRows } from './source-parsers/admission-type.mjs';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source');
const OUTPUT = path.join(ROOT, 'assets/data.js');

const read = (file) => JSON.parse(readFileSync(path.join(SOURCE, file), 'utf8'));
// 아직 만들어지지 않은 소스는 없는 채로 둔다 — 산식(rules-2026)·검산(formula-check)이 없으면
// 판정이 L3(정의별 백분위 비교)에서 나올 뿐, 빌드는 그대로 끝난다 (docs/MODEL.md §3).
const readOptional = (file) => (existsSync(path.join(SOURCE, file)) ? read(file) : null);

// 대학이 실제로 반영하는 지표(rules[].basis 한 줄)를 화면이 쓸 수 있는 짧은 라벨로 바꾼다.
//   metric  'std' 표준점수 · 'pct' 백분위 · 'grade' 등급 배점 · null 미확인
//   inquiry 'conv' 변환표준점수 · 'std' 표준점수 · 'pct' 백분위 · null 적혀 있지 않음
// 우리 판정은 언제나 백분위 척도에서 하므로, metric 'std' 대학에는 화면이 '백분위 근사'를 덧붙인다.
export function summarizeBasis(text) {
  const raw = String(text || '').trim();
  if (raw === '' || /미확인/u.test(raw)) {
    return { metric: null, inquiry: null, short: '미확인', label: '반영 지표 미확인', text: raw, approxPercentile: false };
  }
  if (/등급\s*환산\s*배점/u.test(raw)) {
    return { metric: 'grade', inquiry: null, short: '등급 배점', label: '등급 배점 반영', text: raw, approxPercentile: true };
  }
  const lead = raw.split(/[(,—]/u)[0];
  const metric = /백분위/u.test(lead) ? 'pct' : /표준점수|변환점수/u.test(lead) ? 'std' : /백분위/u.test(raw) ? 'pct' : 'std';
  const inquiry = /탐구\s*변환\s*없음/u.test(raw) ? 'std'
    : /탐구[^,)]*변환|변환표준점수|자체변환/u.test(raw) ? 'conv'
      : /탐구[^,)]*백분위/u.test(raw) ? 'pct' : null;
  const mixed = metric === 'pct' && /표준점수/u.test(raw);
  const base = metric === 'pct' ? '백분위 반영' : '표점 반영';
  const tail = metric === 'std'
    ? (inquiry === 'conv' ? ' · 탐구 변환표점' : inquiry === 'pct' ? ' · 탐구 백분위' : inquiry === 'std' ? ' · 탐구 표점' : '')
    : (mixed ? ' · 일부 표점' : '');
  // short 는 뱃지처럼 좁은 자리에 넣는 두 글자짜리다 — 긴 label 은 부제·설명 줄에 쓴다.
  return { metric, inquiry, short: metric === 'pct' ? '백분위' : '표점', label: `${base}${tail}`, text: raw, approxPercentile: metric !== 'pct' };
}

// 유명 대학 라인(서열 묶음). 화면의 대학 순서·머리글·필터가 모두 이 표 하나를 따른다.
// 순서는 통용 라인 순위다 — 컷 중앙값이 아니라 이 표가 대학 정렬의 1차 키다 (docs/FRAME.md §8.3).
export const LINES = [
  { label: '서연고', ids: ['snu', 'yonsei', 'korea'] },
  { label: '서성한', ids: ['sogang', 'skku', 'hanyang'] },
  { label: '중경외시', ids: ['cau', 'khu', 'hufs', 'uos'] },
  { label: '건동홍', ids: ['konkuk', 'dongguk', 'hongik'] },
  { label: '국숭세단', ids: ['kookmin', 'soongsil', 'sejong', 'dankook'] },
  { label: '광명상가', ids: ['kw', 'mju', 'smu', 'catholic'] },
  { label: '한서삼', ids: ['hansung', 'skuniv', 'syu'] },
  { label: '인하아주', ids: ['inha', 'ajou'] },
  { label: '경기·인천', ids: ['hanyang-erica', 'kau', 'hufs-global', 'kyonggi', 'gachon', 'incheon'] },
  { label: '지거국', ids: ['pnu', 'knu', 'jnu', 'jbnu', 'cnu', 'cbnu', 'kangwon', 'gnu', 'jejunu'] },
  { label: '여대', ids: ['ewha', 'sookmyung'] },
];
const SHORT = {
  snu: '서울대', yonsei: '연세대', korea: '고려대', sogang: '서강대', skku: '성균관대', hanyang: '한양대 서울',
  cau: '중앙대', khu: '경희대', hufs: '한국외대 서울', 'hufs-global': '한국외대 글로벌', uos: '서울시립대',
  konkuk: '건국대', dongguk: '동국대', hongik: '홍익대',
  kookmin: '국민대', soongsil: '숭실대', sejong: '세종대', dankook: '단국대',
  kw: '광운대', mju: '명지대', smu: '상명대', catholic: '가톨릭대',
  hansung: '한성대', skuniv: '서경대', syu: '삼육대',
  inha: '인하대', ajou: '아주대', incheon: '인천대', gachon: '가천대', kyonggi: '경기대',
  'hanyang-erica': '한양대 ERICA', kau: '한국항공대',
  pnu: '부산대', knu: '경북대', jnu: '전남대', jbnu: '전북대', cnu: '충남대',
  cbnu: '충북대', kangwon: '강원대', gnu: '경상국립대', jejunu: '제주대',
  ewha: '이화여대', sookmyung: '숙명여대',
};

// 여자대학교. 화면의 '여대 제외' 토글이 이 표를 본다 — 생성물에서 빼지 않고 숨김만 한다.
export const WOMEN_ONLY = new Set(['ewha', 'sookmyung']);

const SEPARATORS = /[·・･ㆍ‧∙⋅\s]/gu;
// 계열 판정용 정규화. 구분점·공백만 지운다. '전공'을 통째로 떼면 '안전공학과'가 '안학과'가 되어
// 공학 규칙을 빠져나가므로, '전공'은 이름 끝(괄호 닫힘 포함)에서만 떼어 stem 을 따로 만든다.
const baseName = (text) => String(text || '').replace(SEPARATORS, '');
// 끝에 붙은 세부전공 꼬리만 떼어 '…섬유공학전공'이 '공학$' 규칙에 걸리게 한다.
const stemName = (base) => base.replace(/전공\)?$/u, '');
// 자유전공 계열 이름에서 '자유전공' 자체를 떼어 '자유전공학부'가 '공학'에 걸리지 않게 한다.
const freeName = (base) => base.replace(/자유전공|자율전공|열린전공|무전공|융합자유|창의융합자유/gu, '');

const MEDICAL = /의예|의학|치의|한의|약학|수의|간호|물리치료|임상병리|방사선|치위생|작업치료|응급구조|보건/u;
// 이름에 '의학'이 들어가도 의약 계열이 아닌 모집단위. 식물의학·수산생명의학·해양식품생명의학은 농·수산계다.
const MEDICAL_EXCEPT = /보건행정|보건관리|의료경영|의료산업|보건정책|보건환경|환경보건|스포츠의학|의학공학|식물의학|수산생명의학|해양식품생명의학|바이오의약/u;
const ARTS = /음악|미술|디자인|회화|동양화|서양화|한국화|판화|조소|조형|무용|체육|스포츠|연극|영화|연기|뮤지컬|작곡|성악|피아노|관현악|국악|공예|도예|사진|애니메이션|만화|패션|뷰티|모델|실용음악|예술|골프|경기지도|아트|서예|의상|공연|태권도/u;
// 예체능 키워드가 들어가도 실기 없이 수능으로 뽑는 모집단위.
const ARTS_EXCEPT = /스포츠경영|공연기획|예술경영|문화예술경영|영상학과|미디어|고고미술사|미술사학|음악학과\(인문\)|패션산업|패션의류|의류산업|생태조경/u;
const FREE = /자유전공|자율전공|열린전공|광역|무전공|혁신칼리지|융합자유|창의융합자유/u;
// 자연계 키워드. '화학'은 '문화학과'에 걸리지 않도록 앞 글자가 '문'이 아닐 때만 본다.
const SCIENCE = /공학|공과|과학|물리|(?<!문)화학|생명|생물|지구|천문|수학|통계|전자|전기|기계|컴퓨터|컴퓨팅|소프트웨어|정보|데이터|인공지능|AI|ICT|반도체|신소재|재료|건축|토목|환경|에너지|화공|산업공|산업경영|산업시스템|산업데이터|산업정보|산업보안|시스템|로봇|항공|자동차|조선|해양|원자력|바이오|식품|농|원예|산림|축산|동물|의생명|나노|모빌리티|자연|IT|메카|보안|디스플레이|스마트|기술|섬유|영양|가정|간호|수의|약학|이과|공대|SW|테크|지능|네트워크|배터리|양자|우주|사이버|전산|조경|기후|첨단융합|식물|작물|전지|의약/u;
// 이름에 자연계 키워드가 있어도 인문계인 모집단위들 (대학이 인문으로 모집한다).
const HUMAN_OVERRIDE = /경영정보|정보사회|문헌정보|정보문화|언론정보|사회언론정보|기술경영|식품자원경제|농경제|사회복지|아동가족|아동학|아동복지|의류|소비자|주거환경|가족자원|사회과학|인문과학|인문사회|언어인지|통번역|식품산업관리|영어산업|문화산업|산업심리|국제물류|물류학|언어정보|Language&|SocialScience&|Finance&|글로벌한국학/u;
const ENGINEERING = /공학부|공학과|공학$|공과대학|공학계열/u;
const BUSINESS = /경영|경제|무역|금융|회계|세무|통상|상경|비즈니스|글로벌경영|경상|국제통상|재무|마케팅|유통|물류|호텔|관광|부동산|광고|핀테크/u;

export function classifyTrack(name) {
  const text = String(name || '');
  const base = baseName(text);
  const stem = stemName(base);
  if (FREE.test(text)) {
    const free = freeName(base);
    // 인문·사회를 먼저 본다 — '사회과학대학 자유전공학과'의 '과학'이 자연으로 끌고 가지 않게.
    if (/예체능|미술|음악|디자인/u.test(text)) return { track: '예체능', ruleTrack: null };
    if (/인문|사회|경영|경제/u.test(free)) return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
    if (/자연|이공|공학|공과|IT|과학|SCIENCE|AI|전자|반도체|소재|컴퓨터|모빌리티/u.test(free)) return { track: '자연', ruleTrack: null };
    return { track: '자유전공', ruleTrack: null };
  }
  if (MEDICAL.test(text) && !MEDICAL_EXCEPT.test(base)) return { track: '의약', ruleTrack: null };
  // 공학으로 끝나는 이름은 디자인·조형이 붙어 있어도 자연계다(예: 시스템디자인공학과).
  if (ENGINEERING.test(stem) && !/\(인문\)/u.test(text)) return { track: '자연', ruleTrack: null };
  // 대학이 이름에 (인문)/(자연)을 박아 둔 모집단위는 실기 없는 수능 전형이다 — 예체능으로 접지 않는다.
  if (ARTS.test(text) && !ARTS_EXCEPT.test(text) && !/\(인문\)|\(자연\)|\(인문계열\)|\(자연계열\)/u.test(text)) return { track: '예체능', ruleTrack: null };
  if (HUMAN_OVERRIDE.test(base)) return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
  if (/\(인문\)|\(문\)|\(인문계열\)/u.test(text)) return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
  if (/\(자연\)|\(이\)|\(자연계열\)/u.test(text)) return { track: '자연', ruleTrack: null };
  if (SCIENCE.test(base)) return { track: '자연', ruleTrack: null };
  return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
}

// 이름만으로는 계열을 맞힐 수 없는 모집단위. 대학 시행계획·공식 입시결과 원문을 근거로 못박는다.
// (전에는 source/results.json 의 모집단위 객체에 `track` 을 박아 두었다 — 소스는 원자료만 담고,
// 우리가 내린 판단은 이 표 하나에 모은다. 근거 없는 항목은 넣지 않는다: docs/AUDIT.md §9·§12.)
// 고려대 학부대학은 보류한다 — 2027 시행계획 PDF에 인문/자연 두 모집단위로 갈려 있어 한 계열로 못박을 수 없다.
export const TRACK_OVERRIDES = [
  { id: 'skku', name: '의상학과', track: '인문', why: '가군 수능 100% 모집단위. 시행계획 인문 트랙이 「사회과학계열·의상학과」로 묶는다' },
  { id: 'khu', name: '의상학과', track: '인문', why: '생활과학대학 — 경희대 인문 트랙(문과·외국어·생활과학)' },
  { id: 'khu', name: '조리&푸드디자인학과', track: '인문', why: '호텔관광대학 수능 100% 모집단위' },
  { id: 'konkuk', name: '의상디자인학과(수능)', track: '인문', why: '공식 표의 「의상디자인학과-인문계」 행' },
  { id: 'cbnu', name: '고고미술사학과', track: '인문', why: '이름의 「미술」이 걸렸다. 인문대학 모집단위' },
  { id: 'jejunu', name: '수산생명의학과', track: '자연', why: '이름의 「의학」이 걸렸다. 해양과학대학' },
  { id: 'jejunu', name: '패션의류학과', track: '자연', why: '생활과학 계열' },
  { id: 'incheon', name: '패션산업학과', track: '자연', why: '생활과학 계열' },
  { id: 'kangwon', name: '생태조경디자인학과', track: '자연', why: '산림환경과학대학' },
  { id: 'kau', name: '자유전공학부(이학적성)', track: '자연', why: '이학적성 — 자연계 반영비율을 쓴다' },
  { id: 'hongik', name: '예술학과', track: '인문', why: '2027 시행계획이 「인문계열·자연계열·예술학과」로 묶고 미술계열은 「예술학과 제외」라고 적는다 — 실기 없음' },
  { id: 'kookmin', name: 'AI빅데이터융합경영학과', track: '인문', why: '시행계획 「인문계와 자연계로 분리 모집」 — 자연계는 (자연) 표기 모집단위가 따로 있다' },
  { id: 'knu', name: '자율미래인재학부', track: '자유전공', why: '계열 구분 없이 뽑는 자율전공 모집단위 — 인문 반영비율을 못박지 않는다' },
];
const TRACK_OVERRIDE_MAP = new Map(TRACK_OVERRIDES.map((row) => [`${row.id}::${row.name}`, row.track]));
export const overrideTrack = (universityId, name) => TRACK_OVERRIDE_MAP.get(`${universityId}::${name}`) || null;
// 계열은 오버라이드 표 → 이름 규칙 순으로 정한다.
export const resolveTrack = (universityId, name) => overrideTrack(universityId, name) || classifyTrack(name).track;

// 실기 없이 수능 성적만으로 뽑는 예체능 모집단위. 트랙은 예체능이되 `실기` 뱃지가 없고
// 화면의 '예체능 제외'에도 걸리지 않는다 (docs/FRAME.md §9.4).
export const PRACTICAL_EXEMPT = [
  {
    id: 'khu',
    why: '경희대 정시 실기 폐지 — 체육대학·예술디자인대학 모집단위를 수능 100%로 뽑는다',
    names: ['체육학과', '스포츠의학과', '태권도학과', '골프산업학과', '연극영화학과', '의류디자인학과', '산업디자인학과'],
  },
  {
    id: 'sejong',
    why: '세종대 정시 일반학생전형 수능 100%',
    names: ['창의소프트학부(디자인이노베이션전공)', '창의소프트학부(만화애니메이션텍전공)'],
  },
];
const PRACTICAL_EXEMPT_MAP = new Map(PRACTICAL_EXEMPT.map((row) => [row.id, new Set(row.names)]));
// 이름 규칙으로 이미 걸러지는 것들(ARTS_EXCEPT·이름에 박힌 (인문)/(자연))은 애초에 예체능 트랙이
// 아니지만, 규칙이 바뀌어 예체능으로 흘러와도 실기로 잘못 표시되지 않도록 여기서도 같이 본다.
const EXEMPT_BY_NAME = /\(인문\)|\(자연\)|\(인문계열\)|\(자연계열\)/u;
export function isPractical(universityId, name, track) {
  if (track !== '예체능') return false;
  if (PRACTICAL_EXEMPT_MAP.get(universityId)?.has(name)) return false;
  if (ARTS_EXCEPT.test(name) || EXEMPT_BY_NAME.test(name)) return false;
  return true;
}

// 컷의 **통계 정의**. 정의마다 눈금(scale)이 다르므로 한 모집단위의 비교 계열(series)에는
// 같은 눈금의 연도값만 넣는다. 정의가 표준(국·수·탐(2) 평균)과 달라도 버리지 않는다 —
// 엔진(comparableScore)이 그 정의 그대로 내 성적을 계산해 같은 눈금에서 뺀다.
// assets/engine.js의 CUT_DEFS와 같은 표다(생성물에 def로 실린다).
export const CUT_DEFS = Object.freeze({
  'ksi-mean': { label: '국·수·탐(2) 백분위 단순평균', scale: 'ksi', comparable: true, approx: false },
  // 과목별 70%컷을 먼저 내고 평균한 값. 같은 과목·같은 척도이지만 산식 순서가 다르다 —
  // 어디가 집계 정수와의 실측 평균 절대차가 0.28점(docs/ACCURACY.md §2)이라 비교는 하되 '근사'로 적는다.
  'subject-mean70': { label: '과목별 70%컷의 국·수·탐 산술평균', scale: 'ksi', comparable: true, approx: true },
  // 국·수·탐 중 상위 2개만 평균한 값(서경대). 내 성적도 같은 규칙으로 상위 2개를 평균해 뺀다.
  'top2-mean': { label: '국·수·탐(2) 중 상위 2개 영역 백분위 평균', scale: 'top2', comparable: true, approx: false },
  // 수학을 반영하지 않는 예체능 모집단위(건국대). 내 성적도 국·탐 둘만 평균해 뺀다.
  'kor-inq-mean': { label: '국·탐 2영역 백분위 평균(수학 미반영)', scale: 'kor-inq', comparable: true, approx: false },
  // 국어·수학·탐구 상위 1과목만 평균한 값(명지대). 내 성적도 탐구 상위 1과목으로 뺀다.
  'ksi1-mean': { label: '국·수·탐(상위 1과목) 백분위 평균', scale: 'ksi1', comparable: true, approx: false },
  // 환산점수 눈금으로만 공개된 컷. 백분위로 되돌릴 수 없어 계산 자체가 불가능하다.
  score: { label: '대학 환산점수', scale: 'score', comparable: false, approx: false },
});
// 이 눈금 위에서만 대학끼리 순서를 매긴다(medianCut). 정의가 다르면 비교하지 않고 비운다.
export const ORDER_SCALE = 'ksi';
export const scaleOf = (def) => CUT_DEFS[def]?.scale || ORDER_SCALE;
export function cutDefinition(row) {
  const note = String(row?.note || '');
  if (/상위\s*2\s*개\s*영역/u.test(note)) return 'top2-mean';
  if (/수학\s*미반영|국·탐\s*2영역/u.test(note)) return 'kor-inq-mean';
  if (/상위\s*1\s*과목/u.test(note)) return 'ksi1-mean';
  if (/과목별\s*70%\s*Cut/iu.test(note)) return 'subject-mean70';
  return 'ksi-mean';
}

// 대학이 스스로 낸 값의 통계 종류. 이름이 달라도 같은 통계인 것만 한 이름으로 묶는다.
const AVG_KINDS = Object.freeze({
  '평균': '등록자 평균', '등록자 평균': '등록자 평균', '등록자평균': '등록자 평균',
  '80%평균': '상위80% 평균', '상위80% 평균': '상위80% 평균', '상위 80% 평균': '상위80% 평균',
});
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
// 연도 평행이동에 쓸 짝. **같은 통계끼리만** 뺀다 — 70%컷에서 평균을 빼면 그 차이는
// 연도 변화가 아니라 통계 종류의 차이라서, 평균값이 이름만 바꿔 70%컷으로 들어가 버린다.
export function matchOfficial(row, anchor) {
  if (!row || !anchor) return null;
  if (isNum(row.cut70) && isNum(anchor.cut70)) return { statistic: '70%컷', value: row.cut70, anchor: anchor.cut70 };
  const kind = AVG_KINDS[String(row.kind || '').trim()];
  const anchorKind = AVG_KINDS[String(anchor.kind || '').trim()];
  if (isNum(row.avg) && isNum(anchor.avg) && kind && kind === anchorKind) {
    return { statistic: kind, value: row.avg, anchor: anchor.avg };
  }
  return null;
}

function buildSeries(jeongsi, official) {
  const series = [];
  const allPct = Object.keys(jeongsi)
    .filter((year) => jeongsi[year].metric === 'pct' && jeongsi[year].cut70 !== null)
    .sort();
  // 이 모집단위의 눈금은 **최근 연도의 정의**가 정한다. 눈금이 다른 해는 계열에 넣지 않는다 —
  // 상위 2개 평균과 세 영역 평균을 한 줄에 세우면 연도 변화가 아니라 산식 차이를 재게 된다.
  const anchorScale = allPct.length > 0 ? scaleOf(jeongsi[allPct.at(-1)].def) : null;
  const pctYears = anchorScale === null ? [] : allPct.filter((year) => scaleOf(jeongsi[year].def) === anchorScale);
  const anchorYear = pctYears.at(-1) || null;
  for (const year of pctYears) {
    series.push({
      year, value: jeongsi[year].cut70, kind: jeongsi[year].kind || '70%컷', def: jeongsi[year].def,
      basis: jeongsi[year].basis || 'adiga', source: jeongsi[year].source, url: jeongsi[year].url,
      sourceGrade: jeongsi[year].sourceGrade || 'E',
    });
  }
  const anchorRow = anchorYear ? official[anchorYear] : null;
  for (const [year, row] of Object.entries(official).sort()) {
    if (series.some((entry) => entry.year === year)) continue;
    if (row.metric && row.metric !== 'pct') continue;
    if (row.adigaStandard) {
      const value = row.cut70 ?? row.avg ?? null;
      // 통계 정의는 어디가 표준이라고 적혀 있어도 행의 note 가 말하는 대로 정한다 —
      // 비교할 수 없는 정의(탐구 1과목 평균 등)는 계열에 넣지 않는다.
      const def = cutDefinition(row);
      // 계열의 눈금이 정해져 있으면 그 눈금만, 아직 없으면 이 행이 눈금을 정한다.
      if (value === null || (anchorScale !== null && scaleOf(def) !== anchorScale)) continue;
      if (!CUT_DEFS[def]?.comparable) continue;
      series.push({ year, value: round2(value), kind: row.kind || '70%컷', def, basis: 'official', source: row.source, url: row.url, sourceGrade: row.sourceGrade || 'E' });
      continue;
    }
    if (!anchorYear || !anchorRow) continue;
    const pair = matchOfficial(row, anchorRow);
    if (!pair) continue;
    // 기준 연도 대비 **같은 통계의** 변화량만 옮긴다.
    series.push({
      year, value: round2(jeongsi[anchorYear].cut70 + (pair.value - pair.anchor)), kind: '70%컷 환산', basis: 'derived',
      def: jeongsi[anchorYear].def,
      from: {
        kind: row.kind, statistic: pair.statistic, value: pair.value,
        anchorYear, anchorValue: pair.anchor, anchorKind: anchorRow.kind || null,
      },
      source: row.source, url: row.url, sourceGrade: row.sourceGrade || 'E',
    });
  }
  return series.sort((left, right) => left.year.localeCompare(right.year));
}
const round2 = (value) => Math.round(value * 100) / 100;


// 컷의 연도별 흔들림. 학과별 표준편차의 중앙값을 대학의 대표 변동폭으로 쓴다 —
// 연도 값이 한 해뿐인 학과의 오차범위는 이 값으로 대신한다.
function stdev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function volatilityOf(departments) {
  const spreads = departments
    .map((dept) => stdev((dept.series || []).map((row) => row.value)))
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  // 어디가는 직전 학년도 하나만 공개하므로 연도가 두 해 이상 있는 모집단위가 대학마다 적다.
  // 표본이 둘 이하인 대학의 '흔들림 0'은 흔들리지 않았다는 뜻이 아니라 잰 적이 없다는 뜻이라
  // 값으로 내지 않는다 — 그런 대학은 전체 대표값(data.volatility)을 오차범위로 쓴다.
  if (spreads.length < 3) return null;
  const value = median(spreads);
  return value === null ? null : round2(value);
}

// 대학의 대표 컷. 예체능·의약을 뺀 일반 모집단위의 2026학년도 정시 70%컷(백분위) 중앙값이다.
// 화면의 대학 순서를 이 값으로 정한다 — 라인 이름은 참고 라벨로만 남긴다.
const ORDER_EXCLUDED_TRACKS = new Set(['예체능', '의약']);
function medianCutOf(departments) {
  const values = [];
  for (const dept of departments) {
    if (ORDER_EXCLUDED_TRACKS.has(dept.track)) continue;
    const years = Object.keys(dept.jeongsi || {}).sort().reverse();
    // 대학 순서는 하나의 눈금(국·수·탐(2) 평균) 위에서만 잰다 — 다른 정의의 값은 섞지 않는다.
    const year = years.find((key) => dept.jeongsi[key].metric === 'pct'
      && typeof dept.jeongsi[key].cut70 === 'number'
      && scaleOf(dept.jeongsi[key].def) === ORDER_SCALE);
    if (year) values.push(dept.jeongsi[year].cut70);
  }
  const value = median(values);
  return value === null ? null : round2(value);
}

// ── 어디가 원값 (source/adiga/<학년도>.json) ─────────────────────────────────
// scripts/source-parsers/fetch-adiga.mjs 가 어디가에서 직접 받아 둔 행. docs/MODEL.md §1.1 이
// 형식을 정한다. 같은 모집단위에 이 행이 있으면 **이 값이 1차 자료**이고, 학점나비 전사값을 덮는다.
export const ADIGA_SOURCE = '대입정보포털 어디가 대학별 입시결과(직접 수집)';
const PERIOD_GROUP = { '정시(가)': '가', '정시(나)': '나', '정시(다)': '다' };

// 한 모집단위·한 해에 어디가 행이 여럿일 때(모집시기·전형이 갈릴 때) 무엇을 대표로 쓸지.
// 컷이 공개된 행 > 영역별 값만 있는 행 > 모집인원만 있는 행 순이고, 같으면 모집인원이 큰 쪽이다.
export function rankAdigaRow(row) {
  if (!row) return -1;
  if (typeof row.score?.p70 === 'number') return 3;
  if (row.student?.p70) return 2;
  if ((row.quota?.final ?? 0) > 0) return 1;
  return 0;
}
export function preferAdigaRow(left, right) {
  const gap = rankAdigaRow(right) - rankAdigaRow(left);
  if (gap !== 0) return gap > 0 ? right : left;
  return (right.quota?.final ?? 0) > (left.quota?.final ?? 0) ? right : left;
}

// 어디가가 컷을 공개한 행인가 (§1.1 — 선발인원 3명 이하면 공개하지 않는다).
export const hasAdigaCut = (row) => typeof row?.score?.p70 === 'number' || typeof row?.student?.p70?.avg === 'number';

// 같은 모집단위·학년도의 전 행 중 **대표 행**(dept.jeongsi[year] 자체)을 고른다 (§1.1-2).
//   컷이 있는 general 행(가군 우선) > 컷이 있는 첫 행(kind 우선순위·모집시기 순) >
//   컷이 아예 없으면 종전 순위(preferAdigaRow — 영역별 값 > 모집인원 > 큰 모집인원).
// 순서가 이미 compareTypeRows(kind 우선순위 → 모집시기 → 모집인원 많은 순)로 정렬된 배열을 받는다.
export function pickRepresentative(sorted) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  const general = sorted.find((row) => row.typeKind === 'general' && hasAdigaCut(row));
  if (general) return general;
  const withCut = sorted.find((row) => hasAdigaCut(row));
  if (withCut) return withCut;
  return sorted.reduce((best, row) => (best ? preferAdigaRow(best, row) : row), null);
}

export function indexAdiga(files) {
  const index = new Map();
  const years = new Set();
  let rows = 0;
  for (const file of files) {
    for (const row of file.rows || []) {
      rows += 1;
      const year = String(row.year);
      years.add(year);
      const key = `${row.university}::${normalizeDept(row.dept)}`;
      if (!index.has(key)) index.set(key, new Map());
      const byYear = index.get(key);
      if (!byYear.has(year)) byYear.set(year, []);
      // 분류는 여기서 한 번만 하고 아래 전부가 그 값을 쓴다 (§1.1-2).
      const { kind, label } = classifyType(row.typeName);
      byYear.get(year).push({ ...row, typeKind: kind, typeLabel: label });
    }
  }
  // 학년도마다 kind 우선순위·모집시기 순으로 세우고 대표 행을 정해 둔다.
  for (const byYear of index.values()) {
    for (const [year, list] of byYear) {
      const sorted = [...list].sort(compareTypeRows);
      byYear.set(year, { rows: sorted, best: pickRepresentative(sorted) });
    }
  }
  return { index, years: [...years].sort(), rows };
}

function readAdiga() {
  const dir = path.join(SOURCE, 'adiga');
  if (!existsSync(dir)) return indexAdiga([]);
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}\.json$/u.test(name))
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
  return indexAdiga(files);
}

// 생성물은 브라우저가 통째로 내려받는 파일이라, 값이 없는 칸(80·90·100% cut 은 대학별 선택공개라
// 대부분 비어 있다)은 키째 뺀다. 소스 파일(source/adiga/*.json)은 MODEL §1.1 대로 null 을 남긴다.
const compact = (value) => {
  if (!value) return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) if (item !== null && item !== undefined) out[key] = item;
  return Object.keys(out).length > 0 ? out : null;
};

// types[] 는 한 모집단위·학년도마다 여러 행이라 생성물에서 가장 무거운 덩어리다(4900행 남짓).
// 그래서 대표 행과 달리 **읽는 쪽이 실제로 쓰는 지점만** 싣는다.
//   - 학생 성적표: 50·70% 지점(표·판정)과 100% 지점(engine cut100 의 바닥선)만.
//   - 환산점수: 50·70% 지점만. 총점(total)은 화면도 엔진도 읽지 않는다.
const TYPE_STUDENT_KEYS = ['p50', 'p70', 'p100'];
const TYPE_SCORE_KEYS = ['p50', 'p70'];
const pickKeys = (value, keys) => {
  if (!value) return null;
  const out = {};
  for (const key of keys) if (value[key] !== null && value[key] !== undefined) out[key] = value[key];
  return Object.keys(out).length > 0 ? out : null;
};

// 어디가 행을 results.json 의 정시 행 모양으로 옮긴다. 아래 매핑 코드가 한 갈래만 보도록,
// 어디가 값도 학점나비 값도 같은 모양으로 만들어 넘긴다.
export function mergeAdigaRow(base, hit) {
  if (!hit) return base ? { row: base, extra: { aggregation: 'unknown' } } : null;
  const student = hit.student || {};
  // 선발인원 3명 이하면 어디가가 컷을 공개하지 않는다(각주 원문) — 그 행은 컷을 덮지 않는다.
  const disclosed = typeof hit.score?.p70 === 'number' || typeof student.p70?.avg === 'number';
  const quota = (hit.quota?.final ?? 0) > 0 ? hit.quota.final : null;
  const extra = {
    aggregation: disclosed ? 'adiga-score-rank' : 'unknown',
    consistent: disclosed ? hit.consistent : null,
    period: hit.period || null,
    score: compact(hit.score),
    student: disclosed ? compact(student) : null,
    quotaDetail: compact(hit.quota),
    adigaNote: hit.note || '',
    fetchedOn: hit.source?.fetchedOn || null,
  };
  if (!disclosed) {
    // 컷은 없어도 모집인원·경쟁률·충원은 원문이 맞다 — 있으면 그 값으로 바꾼다.
    if (!base) return null;
    return {
      row: {
        ...base,
        quota: quota ?? base.quota ?? null,
        rate: quota === null ? base.rate ?? null : hit.rate ?? null,
        fill: quota === null ? base.fill ?? null : hit.fill ?? null,
        fillRate: quota === null ? base.fillRate ?? null : null,
      },
      extra,
    };
  }
  return {
    row: {
      typeName: hit.typeName || base?.typeName || '',
      group: PERIOD_GROUP[hit.period] ?? null,
      quota, rate: hit.rate ?? null, fill: hit.fill ?? null, fillRate: null,
      lastWait: base?.lastWait ?? null,
      // 어디가의 '평균백분위'는 환산점수 순 70% 지점 학생 한 명의 국·수·탐 평균이다(MODEL §0).
      pct70: student.p70?.avg ?? null, pct50: student.p50?.avg ?? null, pct100: student.p100?.avg ?? null,
      // 학점나비가 정수로 실었던 같은 값. 정확도 보고서가 원값과 짝지어 센다.
      adigaCut70: base?.adigaCut70 ?? (typeof base?.pct70 === 'number' && base?.source === 'adiga-hakjum' ? base.pct70 : null),
      score70: hit.score?.p70 ?? null,
      kind: '70%컷', note: '',
      source: ADIGA_SOURCE, url: hit.source?.url || null, sourceGrade: 'A',
    },
    extra,
  };
}

// 같은 모집단위·학년도의 **전 전형 행**(§1.1-2). 대표 행 하나만 남기던 것을 여기서 되살린다.
// 필드는 MODEL §1.1-2 그대로이고, 끝에 대표 행과 같은 눈금의 요약(cut70·cut50·score70)을 붙인다.
// 값이 없는 칸은 키째 뺀다 — 5천 행이 생성물에 들어가므로 빈 키 하나가 곧 수십 KB다.
// 같은 이유로 읽는 쪽이 없는 칸도 싣지 않는다: 모집인원 내역(quotaDetail)·환산점수 총점·
// 80·90% 지점 학생·원문 raw. 집계 방식은 'adiga-score-rank' 일 때만 적고, 없으면 unknown 이다.
export function typeRowsOf(sorted) {
  const out = [];
  for (const row of sorted || []) {
    const disclosed = hasAdigaCut(row);
    const student = row.student || {};
    const quota = (row.quota?.final ?? 0) > 0 ? row.quota.final : null;
    const entry = {
      kind: row.typeKind || classifyType(row.typeName).kind,
      label: row.typeLabel || classifyType(row.typeName).label,
      typeName: row.typeName || '',
      period: row.period || null,
      group: PERIOD_GROUP[row.period] ?? null,
      quota,
      rate: row.rate ?? null,
      fill: row.fill ?? null,
      score: pickKeys(row.score, TYPE_SCORE_KEYS),
      student: disclosed ? pickKeys(student, TYPE_STUDENT_KEYS) : null,
      aggregation: disclosed ? 'adiga-score-rank' : null,
      consistent: disclosed ? row.consistent ?? null : null,
      // 대표 행(dept.jeongsi[year])과 같은 이름·같은 눈금의 요약값.
      cut70: disclosed ? student.p70?.avg ?? null : null,
      cut50: disclosed ? student.p50?.avg ?? null : null,
      score70: row.score?.p70 ?? null,
    };
    for (const [key, value] of Object.entries(entry)) if (value === null || value === undefined) delete entry[key];
    out.push(entry);
  }
  return out;
}

function buildUniversities(adiga, rules, anomalies = new Map(), adigaRows = indexAdiga([])) {
  const byId = new Map(adiga.map((row) => [row.id, row]));
  const used = new Set();
  const compare = [];
  const oursOnly = [];
  const universities = [];
  for (const line of LINES) {
    for (const id of line.ids) {
      const source = byId.get(id);
      const rule = rules.universities[id];
      // 정시 결과가 없던 모집단위도 어디가에 행이 있으면 들어온다 — 그래서 거르는 일은
      // 값을 다 실어 본 **뒤에** 한다(아래 filter).
      const departments = (source?.departments || [])
        .map((dept) => {
          const guessed = classifyTrack(dept.name);
          // 자동 분류가 틀리는 이름은 TRACK_OVERRIDES 표가 못박는다.
          const track = overrideTrack(id, dept.name) || guessed.track;
          // 소스가 계열을 못박아 둔 모집단위(캠퍼스별 반영비율이 다른 한국외대)는 그 값을 쓴다.
          const ruleTrack = dept.ruleTrack || guessed.ruleTrack;
          // 어디가 원값이 있는 모집단위면 그 값이 이긴다. 연도는 두 출처의 합집합이다 —
          // 어디가에만 있는 해(2025·2024)도 그대로 싣는다.
          const key = `${id}::${normalizeDept(dept.name)}`;
          const adigaYears = adigaRows.index.get(key) || null;
          if (adigaYears) used.add(key);
          // 정시 결과가 있던 모집단위인데 어디가에서 짝을 못 찾은 것만 남긴다(이름 표기 차이).
          else if (Object.keys(dept.jeongsi || {}).length > 0) oursOnly.push({ id, dept: dept.name });
          const years = new Set(Object.keys(dept.jeongsi || {}).filter((name) => name !== 'alts'));
          if (adigaYears) for (const year of adigaYears.keys()) years.add(year);

          const jeongsi = {};
          for (const year of [...years].sort()) {
            const bucket = adigaYears?.get(year) || null;
            const merged = mergeAdigaRow(dept.jeongsi?.[year] || null, bucket?.best || null);
            if (!merged) continue;
            const { row, extra } = merged;
            const before = dept.jeongsi?.[year] || null;
            // 학점나비 전사값과 어디가 원값이 어긋난 행은 세어 둔다(docs/ACCURACY.md).
            if (before && extra.aggregation === 'adiga-score-rank') {
              const moved = (left, right) => (left ?? null) !== (right ?? null)
                && !(typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) < 0.005);
              if (moved(before.pct70, row.pct70) || moved(before.score70, row.score70)) {
                compare.push({
                  id, dept: dept.name, year,
                  hakjum: { pct70: before.pct70 ?? null, score70: before.score70 ?? null, source: before.source },
                  adiga: { pct70: row.pct70, score70: row.score70 },
                });
              }
            }
            const quota = row.quota ?? null;
            const fill = row.fill ?? null;
            jeongsi[year] = {
              ...extra,
              cut70: row.pct70 ?? null, cut50: row.pct50 ?? null, cut100: row.pct100 ?? null,
              // 같은 모집단위를 학점나비가 정수로 실은 값. 정확도 보고서가 원값과 짝지어 센다.
              adigaCut70: row.adigaCut70 ?? null,
              score70: row.score70 ?? null,
              metric: row.pct70 !== null && row.pct70 !== undefined ? 'pct' : 'score',
              // 통계 정의(무엇을 재서 낸 값인가). 비교 가능성은 여기서 갈린다.
              def: cutDefinition(row),
              kind: row.kind || '70%컷',
              basis: row.source === 'adiga-hakjum' || row.source === ADIGA_SOURCE ? 'adiga' : 'official',
              group: row.group || null, quota, rate: row.rate ?? null, fill,
              // 충원율은 대학이 낸 값을 그대로 쓰고, 없으면 추합 인원 ÷ 모집인원으로 만든다.
              fillRate: row.fillRate ?? (typeof fill === 'number' && typeof quota === 'number' && quota > 0
                ? Math.round((fill / quota) * 1000) / 10 : null),
              lastWait: row.lastWait ?? null,
              // docs/MODEL.md §1.1 — 환산점수와 그 지점 학생 한 명의 성적표. 어디가 원문 그대로다.
              score: extra.score ?? row.score ?? null,
              student: extra.student ?? row.student ?? null,
              // 집계 방식. 어디가 각주 정의(환산점수 순 정렬)가 아니면 'unknown' 이고,
              // unknown 인 행에는 정밀 판정(L1·L2)을 내리지 않는다.
              aggregation: extra.aggregation || row.aggregation || (row.source === 'adiga-hakjum' ? 'adiga-score-rank' : 'unknown'),
              typeName: row.typeName || '', note: row.note || '', source: row.source, url: row.url,
              sourceGrade: row.sourceGrade || 'E',
            };
            // 같은 모집단위·학년도의 전 전형 행(§1.1-2). general 을 포함하고, 대표 행도 이 안에 있다.
            // 어디가 행이 없는 해(학점나비 전사값만 있는 해)는 types 를 만들지 않는다.
            const typeRows = typeRowsOf(bucket?.rows);
            if (typeRows.length > 0) {
              jeongsi[year].types = typeRows;
              jeongsi[year].typeKind = bucket.best?.typeKind || classifyType(row.typeName).kind;
            }
          }
          const official = dept.official || {};
          const series = buildSeries(jeongsi, official);
          const susi = (kind) => {
            const out = {};
            for (const [year, row] of Object.entries(dept[kind] || {})) {
              out[year] = { cut70: row.cut70, cut50: row.cut50 ?? null, typeName: row.typeName || '', quota: row.quota ?? null, rate: row.rate ?? null, source: row.source, url: row.url };
            }
            return out;
          };
          return {
            name: dept.name, campus: dept.campus || null, track, ruleTrack,
            // 실기가 있는 예체능 모집단위만 true — 화면의 '실기' 뱃지와 '예체능 제외'가 이 값을 본다.
            practical: isPractical(id, dept.name, track),
            // 계열 중앙값에서 크게 떨어진 값. scripts/anomalies.mjs 가 미리 판정해 둔다.
            anomaly: anomalies.get(`${id}::${dept.name}`) || null,
            jeongsi, official, series, gyogwa: susi('gyogwa'), hakjong: susi('hakjong'),
          };
        })
        // 정시 값이 하나도 없는 모집단위는 이 화면이 다루지 않는다(수시만 뽑는 곳).
        .filter((dept) => Object.keys(dept.jeongsi).length > 0)
        .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
      universities.push({
        id, name: rule?.name || source?.name || id, short: SHORT[id] || id, line: line.label, order: 0,
        womenOnly: WOMEN_ONLY.has(id),
        medianCut: medianCutOf(departments),
        resultUrl: source?.url || null, volatility: volatilityOf(departments), departments,
      });
    }
  }
  // 순서는 라인 표 그대로다. 대표 컷(medianCut)은 값으로만 남겨 정보 탭 표가 쓴다.
  universities.forEach((university, index) => { university.order = index + 1; });
  // 이름이 맞지 않아 짝을 못 지은 행. 이름 정규화만으로는 못 잇는 곳을 눈에 보이게 남긴다.
  const adigaOnly = [];
  for (const [key, byYear] of adigaRows.index) {
    if (used.has(key)) continue;
    const sample = [...byYear.values()].map((bucket) => bucket.best).filter(Boolean)
      .sort((left, right) => rankAdigaRow(right) - rankAdigaRow(left))[0];
    if (!sample) continue;
    adigaOnly.push({
      id: key.split('::')[0], dept: sample.dept, years: [...byYear.keys()].sort(),
      period: sample.period, typeName: sample.typeName, score70: sample.score?.p70 ?? null,
    });
  }
  return { universities, unmatched: { adigaOnly, oursOnly, compare } };
}


// 어디가 행과 우리 모집단위가 이름으로 짝지어지지 않은 목록. 빌드마다 다시 쓴다 —
// 이 파일이 비어 갈수록 이름 표기를 맞춘 것이고, 남아 있는 줄이 곧 손볼 자리다.
function writeUnmatched(unmatched, adigaRows) {
  if (adigaRows.rows === 0) return;
  const file = path.join(SOURCE, 'adiga/unmatched.json');
  writeFileSync(file, `${JSON.stringify({
    note: '어디가 원값과 results.json 모집단위를 이름 정규화 뒤 정확히 맞춰 본 결과. scripts/build-data.mjs 가 만든다.',
    years: adigaRows.years,
    counts: {
      adigaRows: adigaRows.rows,
      adigaOnly: unmatched.adigaOnly.length,
      oursOnly: unmatched.oursOnly.length,
      moved: unmatched.compare.length,
    },
    adigaOnly: unmatched.adigaOnly,
    oursOnly: unmatched.oursOnly,
    moved: unmatched.compare,
  }, null, 1)}\n`);
}

// 전형 분류 표(§1.1-2). 어디가 전형명 전부를 kind 로 접어 학년도별 개수와 이름을 남긴다.
// **수동 검토용**이다 — `general` 목록에 일반전형이 아닌 이름이 보이면 분류 표를 고칠 자리다.
function writeTypes(adigaRows) {
  if (adigaRows.rows === 0) return;
  const perYear = new Map();
  for (const byYear of adigaRows.index.values()) {
    for (const [year, bucket] of byYear) {
      if (!perYear.has(year)) perYear.set(year, new Map());
      const names = perYear.get(year);
      for (const row of bucket.rows) {
        const name = row.typeName || '';
        if (!names.has(name)) names.set(name, { kind: row.typeKind, rows: 0 });
        names.get(name).rows += 1;
      }
    }
  }
  const years = {};
  for (const year of [...perYear.keys()].sort()) {
    const names = perYear.get(year);
    const counts = {};
    const byKind = {};
    for (const kind of TYPE_KINDS) { counts[kind] = { label: TYPE_LABEL[kind], names: 0, rows: 0 }; byKind[kind] = []; }
    for (const [name, info] of names) {
      counts[info.kind].names += 1;
      counts[info.kind].rows += info.rows;
      byKind[info.kind].push({ name, rows: info.rows });
    }
    for (const kind of TYPE_KINDS) byKind[kind].sort((left, right) => right.rows - left.rows || left.name.localeCompare(right.name, 'ko'));
    years[year] = { typeNames: names.size, counts, byKind, general: byKind.general };
  }
  writeFileSync(path.join(SOURCE, 'adiga/types.json'), `${JSON.stringify({
    note: '어디가 전형명을 docs/MODEL.md §1.1-2 우선순위 표로 접은 결과. scripts/build-data.mjs 가 만든다. general 목록은 사람이 훑어 분류 표를 고치는 자리다.',
    kinds: TYPE_KINDS.map((kind) => ({ kind, label: TYPE_LABEL[kind] })),
    years,
  }, null, 1)}\n`);
}

// 이상치 판정표. `npm run anomalies`(scripts/anomalies.mjs)가 먼저 돌아 source/anomalies.json 을
// 만들고, 여기서는 읽기만 한다 — 판정 규칙은 그 파일 하나에 있다. 파일이 없으면 anomaly 는 전부 null 이다.
function readAnomalies() {
  const file = path.join(SOURCE, 'anomalies.json');
  if (!existsSync(file)) return new Map();
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return new Map((parsed.items || []).map((row) => [
    `${row.id}::${row.name}`,
    {
      kind: row.kind, gap: row.gap, median: row.median, mad: row.mad,
      // 왜 그렇게 분류했는가(docs/MODEL.md §6). 화면이 값만 그대로 적는다.
      reasons: row.reasons || [], score70: row.score70 ?? null, score50: row.score50 ?? null,
      // 이 모집단위 자신의 이력. 판정(펑크·오류)은 계열이 아니라 이 값으로 내린다.
      priorMedian: row.priorMedian ?? null, priorGap: row.priorGap ?? null,
      priorCount: row.priorCount ?? 0, basis: row.basis || 'group',
    },
  ]));
}

// 생성일. 내용이 그대로면 지난 생성일을 그대로 둔다 — 같은 소스로 다시 빌드해도 파일이 바뀌지 않아야
// CI가 "생성물이 소스와 맞는가"를 diff 하나로 확인할 수 있다.
function previousData() {
  if (!existsSync(OUTPUT)) return null;
  const text = readFileSync(OUTPUT, 'utf8');
  const start = text.indexOf('window.IPSI_DATA = ');
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start + 'window.IPSI_DATA = '.length).replace(/;\s*$/u, ''));
  } catch (error) {
    return null;
  }
}
let previous;
function generatedAt() {
  previous = previous === undefined ? previousData() : previous;
  return previous?.generatedAt || new Date().toISOString().slice(0, 10);
}

export function buildData() {
  const adiga = read('results.json');
  const rules = read('rules-2027.json');
  const scales = read('scales-2026.json');
  const std = read('std-2026.json');
  const conv = read('conv-2026.json');
  const rules2026 = readOptional('rules-2026.json');
  const formulaCheck = readOptional('formula-check.json');
  const adigaRows = readAdiga();
  const built = buildUniversities(adiga, rules, readAnomalies(), adigaRows);
  const { universities } = built;
  writeUnmatched(built.unmatched, adigaRows);
  writeTypes(adigaRows);
  // 라인 표에 없는 대학만 생성물에서 빠진다. 여자대학교는 표에 있고, 화면이 토글로 숨긴다.
  const listed = new Set(LINES.flatMap((line) => line.ids));
  const ruleMap = {};
  for (const [id, rule] of Object.entries(rules.universities)) {
    if (listed.has(id)) ruleMap[id] = { ...rule, basisSummary: summarizeBasis(rule.basis) };
  }
  const volatilities = universities.map((university) => university.volatility).filter((value) => typeof value === 'number');
  const data = {
    generatedAt: generatedAt(),
    volatility: volatilities.length > 0 ? round2(median(volatilities)) : 1,
    lines: LINES,
    universities,
    rules: ruleMap,
    // 2026학년도 산식(scripts/merge-rules.mjs)과 그 검산(scripts/verify-formulas.mjs).
    // 없으면 null — 엔진이 L3로 내려간다.
    rules2026,
    formulaCheck,
    scales,
    std,
    conv,
    sources: {
      results: { title: '대입정보포털 어디가 2026학년도 입시결과(학점나비 집계 페이지 경유)', url: 'https://www.adiga.kr/', note: '최종등록자 상위 70% 컷. 정시는 국·수·탐(2) 백분위 평균, 수시는 학생부 등급.' },
      rules: { title: '각 대학 2027학년도 대학입학전형 시행계획(2025.4~5)', url: 'https://www.kcue.or.kr/', note: '영역별 반영비율·영어/한국사 처리·선택과목 가산.' },
      std: std.sources?.[0] || null,
    },
  };
  // 정확도 숫자는 데이터에서 세어 만든다 — 화면과 docs/ACCURACY.md 가 같은 값을 쓴다.
  data.accuracy = computeAccuracy(data);
  return data;
}

function render(data) {
  const universityCount = data.universities.length;
  const departmentCount = data.universities.reduce((sum, university) => sum + university.departments.length, 0);
  return `// 생성물 — scripts/ipsi/build-data.mjs가 scripts/ipsi/source/*.json에서 만든다. 손으로 고치지 않는다.
// 불변식: 대학 ${universityCount}개, 정시 결과가 있는 모집단위 ${departmentCount}개, 2027 반영 규칙 ${Object.keys(data.rules).length}개 대학.
// 내용은 공개 입시 통계(어디가·대학 입학처)라 보호 학습 콘텐츠가 아니며 정적으로 실린다.
window.IPSI_DATA = ${JSON.stringify(data)};
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/build-data.mjs')) {
  const data = buildData();
  // 내용이 달라졌으면 생성일을 오늘로 올린다.
  const old = previousData();
  if (old) {
    const strip = (value) => JSON.stringify({ ...value, generatedAt: null });
    if (strip(old) !== strip(data)) data.generatedAt = new Date().toISOString().slice(0, 10);
  }
  writeFileSync(OUTPUT, render(data), 'utf8');
  const departments = data.universities.reduce((sum, university) => sum + university.departments.length, 0);
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}: ${data.universities.length} universities, ${departments} departments`);
}
