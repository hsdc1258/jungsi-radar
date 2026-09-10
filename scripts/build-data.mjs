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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source');
const OUTPUT = path.join(ROOT, 'assets/data.js');

const read = (file) => JSON.parse(readFileSync(path.join(SOURCE, file), 'utf8'));

// 유명 대학 라인(서열 묶음). 화면의 대학 순서와 필터 묶음이 이 표를 쓴다.
export const LINES = [
  { label: '서연고', ids: ['snu', 'yonsei', 'korea'] },
  { label: '서성한', ids: ['sogang', 'skku', 'hanyang'] },
  { label: '중경외시이', ids: ['cau', 'khu', 'hufs', 'uos', 'ewha'] },
  { label: '건동홍숙', ids: ['konkuk', 'dongguk', 'hongik', 'sookmyung'] },
  { label: '국숭세단', ids: ['kookmin', 'soongsil', 'sejong', 'dankook'] },
  { label: '광명상가', ids: ['kw', 'mju', 'smu', 'catholic'] },
  { label: '한서삼', ids: ['hansung', 'skuniv', 'syu'] },
];
const SHORT = {
  snu: '서울대', yonsei: '연세대', korea: '고려대', sogang: '서강대', skku: '성균관대', hanyang: '한양대',
  cau: '중앙대', khu: '경희대', hufs: '한국외대', uos: '서울시립대', ewha: '이화여대',
  konkuk: '건국대', dongguk: '동국대', hongik: '홍익대', sookmyung: '숙명여대',
  kookmin: '국민대', soongsil: '숭실대', sejong: '세종대', dankook: '단국대',
  kw: '광운대', mju: '명지대', smu: '상명대', catholic: '가톨릭대',
  hansung: '한성대', skuniv: '서경대', syu: '삼육대',
};

const SEPARATORS = /[·・･ㆍ‧∙⋅\s]/gu;
// 계열 판정용 정규화. 구분점·공백을 지우고 '전공'을 떼어 '자유전공학'이 '공학'에 걸리지 않게 한다.
const baseName = (text) => String(text || '').replace(SEPARATORS, '').replace(/전공/gu, '');

const MEDICAL = /의예|의학|치의|한의|약학|수의|간호|물리치료|임상병리|방사선|치위생|작업치료|응급구조|보건/u;
const MEDICAL_EXCEPT = /보건행정|보건관리|의료경영|의료산업|보건정책|보건환경|환경보건|스포츠의학|의학공학/u;
const ARTS = /음악|미술|디자인|회화|조소|조형|무용|체육|스포츠|연극|영화|연기|뮤지컬|작곡|성악|피아노|관현악|국악|공예|도예|사진|애니메이션|만화|패션|뷰티|모델|실용음악|예술|골프|경기지도|아트|서예|의상|공연|태권도/u;
const ARTS_EXCEPT = /스포츠경영|공연기획|예술경영|문화예술경영|영상학과|미디어/u;
const FREE = /자유전공|자율전공|열린전공|광역|무전공|혁신칼리지|융합자유|창의융합자유/u;
// 자연계 키워드. '화학'은 '문화학과'에 걸리지 않도록 앞 글자가 '문'이 아닐 때만 본다.
const SCIENCE = /공학|공과|과학|물리|(?<!문)화학|생명|생물|지구|천문|수학|통계|전자|전기|기계|컴퓨터|컴퓨팅|소프트웨어|정보|데이터|인공지능|AI|ICT|반도체|신소재|재료|건축|토목|환경|에너지|화공|산업공|산업경영|산업시스템|산업데이터|산업정보|산업보안|시스템|로봇|항공|자동차|조선|해양|원자력|바이오|식품|농|원예|산림|축산|동물|의생명|나노|모빌리티|자연|IT|메카|보안|디스플레이|스마트|기술|섬유|영양|가정|간호|수의|약학|이과|공대|SW|테크|지능|네트워크|배터리|양자|우주|사이버|전산|조경|기후|첨단융합/u;
// 이름에 자연계 키워드가 있어도 인문계인 모집단위들 (대학이 인문으로 모집한다).
const HUMAN_OVERRIDE = /경영정보|정보사회|문헌정보|정보문화|언론정보|사회언론정보|기술경영|식품자원경제|농경제|사회복지|아동가족|아동학|아동복지|의류|소비자|주거환경|가족자원|사회과학|인문과학|인문사회|언어인지|통번역|식품산업관리|영어산업|문화산업|산업심리|국제물류|물류학|Language&|SocialScience&|Finance&|글로벌한국학/u;
const ENGINEERING = /공학부|공학과|공학$|공과대학|공학계열/u;
const BUSINESS = /경영|경제|무역|금융|회계|세무|통상|상경|비즈니스|글로벌경영|경상|국제통상|재무|마케팅|유통|물류|호텔|관광|부동산|광고|핀테크/u;

export function classifyTrack(name) {
  const text = String(name || '');
  const base = baseName(text);
  if (FREE.test(text)) {
    if (/자연|이공|공학|공과|IT|과학|SCIENCE|AI/u.test(base)) return { track: '자연', ruleTrack: null };
    if (/예체능|미술|음악|디자인/u.test(text)) return { track: '예체능', ruleTrack: null };
    if (/인문|사회|경영|경제/u.test(text)) return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
    return { track: '자유전공', ruleTrack: null };
  }
  if (MEDICAL.test(text) && !MEDICAL_EXCEPT.test(base)) return { track: '의약', ruleTrack: null };
  // 공학으로 끝나는 이름은 디자인·조형이 붙어 있어도 자연계다(예: 시스템디자인공학과).
  if (ENGINEERING.test(base) && !/\(인문\)/u.test(text)) return { track: '자연', ruleTrack: null };
  if (ARTS.test(text) && !ARTS_EXCEPT.test(text)) return { track: '예체능', ruleTrack: null };
  if (HUMAN_OVERRIDE.test(base)) return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
  if (/\(인문\)|\(문\)|\(인문계열\)/u.test(text)) return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
  if (/\(자연\)|\(이\)|\(자연계열\)/u.test(text)) return { track: '자연', ruleTrack: null };
  if (SCIENCE.test(base)) return { track: '자연', ruleTrack: null };
  return { track: '인문', ruleTrack: BUSINESS.test(text) ? '상경' : null };
}

function buildSeries(jeongsi, official) {
  const series = [];
  const pctYears = Object.keys(jeongsi).filter((year) => jeongsi[year].metric === 'pct' && jeongsi[year].cut70 !== null).sort();
  const anchorYear = pctYears.at(-1) || null;
  for (const year of pctYears) {
    series.push({ year, value: jeongsi[year].cut70, kind: '70%컷', basis: 'adiga', source: jeongsi[year].source, url: jeongsi[year].url });
  }
  const officialValue = (row) => (row && row.metric === 'pct' ? (row.cut70 ?? row.avg ?? null) : null);
  const anchorOfficial = anchorYear ? officialValue(official[anchorYear]) : null;
  for (const [year, row] of Object.entries(official).sort()) {
    if (series.some((entry) => entry.year === year)) continue;
    const value = officialValue(row);
    if (value === null) continue;
    if (row.adigaStandard) {
      series.push({ year, value: round2(value), kind: row.kind || '70%컷', basis: 'official', source: row.source, url: row.url });
    } else if (anchorYear && anchorOfficial !== null) {
      // 기준 연도 대비 변화량만 옮긴다.
      series.push({
        year, value: round2(jeongsi[anchorYear].cut70 + (value - anchorOfficial)), kind: '70%컷 환산', basis: 'derived',
        from: { kind: row.kind, value, anchorYear, anchorValue: anchorOfficial }, source: row.source, url: row.url,
      });
    }
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
  const value = median(spreads);
  return value === null ? null : round2(value);
}

function buildUniversities(adiga, rules) {
  const byId = new Map(adiga.map((row) => [row.id, row]));
  const universities = [];
  let order = 0;
  for (const line of LINES) {
    for (const id of line.ids) {
      const source = byId.get(id);
      const rule = rules.universities[id];
      order += 1;
      const departments = (source?.departments || [])
        .filter((dept) => Object.keys(dept.jeongsi || {}).length > 0)
        .map((dept) => {
          const { track, ruleTrack } = classifyTrack(dept.name);
          const jeongsi = {};
          for (const [year, row] of Object.entries(dept.jeongsi)) {
            if (year === 'alts') continue;
            jeongsi[year] = {
              cut70: row.pct70 ?? null, cut50: row.pct50 ?? null, score70: row.score70 ?? null,
              metric: row.pct70 !== null && row.pct70 !== undefined ? 'pct' : 'score',
              kind: '70%컷', basis: 'adiga',
              group: row.group || null, quota: row.quota ?? null, rate: row.rate ?? null, fill: row.fill ?? null,
              typeName: row.typeName || '', source: row.source, url: row.url,
            };
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
          return { name: dept.name, track, ruleTrack, jeongsi, official, series, gyogwa: susi('gyogwa'), hakjong: susi('hakjong') };
        })
        .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
      universities.push({
        id, name: rule?.name || source?.name || id, short: SHORT[id] || id, line: line.label, order,
        resultUrl: source?.url || null, volatility: volatilityOf(departments), departments,
      });
    }
  }
  return universities;
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
  const universities = buildUniversities(adiga, rules);
  const ruleMap = {};
  for (const [id, rule] of Object.entries(rules.universities)) ruleMap[id] = rule;
  const volatilities = universities.map((university) => university.volatility).filter((value) => typeof value === 'number');
  return {
    generatedAt: generatedAt(),
    volatility: volatilities.length > 0 ? round2(median(volatilities)) : 1,
    lines: LINES,
    universities,
    rules: ruleMap,
    scales,
    sources: {
      results: { title: '대입정보포털 어디가 2026학년도 입시결과(학점나비 집계 페이지 경유)', url: 'https://www.adiga.kr/', note: '최종등록자 상위 70% 컷. 정시는 국·수·탐(2) 백분위 평균, 수시는 학생부 등급.' },
      rules: { title: '각 대학 2027학년도 대학입학전형 시행계획(2025.4~5)', url: 'https://www.kcue.or.kr/', note: '영역별 반영비율·영어/한국사 처리·선택과목 가산.' },
    },
  };
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
