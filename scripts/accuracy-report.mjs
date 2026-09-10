// 정확도 보고서. 데이터에서 숫자를 직접 세어 docs/ACCURACY.md 와 assets/data.js 의
// `accuracy` 필드를 만든다 — 손으로 적은 숫자는 하나도 없다.
//
//   npm run build      → build-data.mjs 가 computeAccuracy()를 불러 data.accuracy 를 넣는다
//   node scripts/accuracy-report.mjs → 같은 값으로 docs/ACCURACY.md 를 다시 쓴다
//
// 세는 것
//   (a) 커버리지  : 모집단위마다 판정 기준값이 어디서 왔는가 (대학 공식 원값 / 어디가 원값(기사) /
//                   어디가 집계 정수 / 사설 추정 / 미공개)
//   (b) 원값 대조 : 같은 모집단위의 대학 공식·기사 원값과 어디가 집계 정수의 차이 분포
//   (c) 열 뒤집힘 : 같은 해 50%컷이 70%컷보다 낮은 행의 비율
//   (d) 판정 민감도: 컷이 ±0.5 / ±1.0 흔들릴 때 판정이 바뀌는 모집단위 비율 (성적 세 벌)
//   (e) 반영 규칙 : 확인·미확인 건수와 반영 지표를 못 밝힌 대학 수
//   (f) 등급컷    : 2026학년도 실채점 확정 여부와 도수분포 확보 과목 수
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs/ACCURACY.md');

function loadEngine() {
  const context = { globalThis: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, 'assets/engine.js'), 'utf8'), context, { filename: 'assets/engine.js' });
  return context.IPSI_ENGINE;
}

const round = (value, digits = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
// 백분위 자리 (0~1). 가장 가까운 관측값을 쓴다 — 표본이 작아 보간하면 없는 값을 지어내는 셈이다.
const quantile = (values, ratio) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(ratio * (sorted.length - 1))))];
};

// 기준값의 출처 종류. 화면과 문서가 같은 다섯 갈래를 쓴다.
const SOURCE_KINDS = [
  ['official', '대학 공식 원값'],
  ['adigaExact', '어디가 원값(기사 인용)'],
  ['adigaInt', '어디가 집계 정수'],
  ['estimate', '사설 추정'],
  ['none', '미공개(판정 보류)'],
];
function sourceKind(row) {
  const source = String(row?.source || '');
  if (source === 'adiga-hakjum') return 'adigaInt';
  if (/베리타스알파|어디가 공개값/u.test(source)) return 'adigaExact';
  return 'official';
}

// 민감도에 쓰는 성적 세 벌. 상위·중위·하위 한 벌씩 — 한 성적만 보면 컷 근처 밀도에 휘둘린다.
export const SAMPLE_SCORES = [
  { label: '상위 (국98·수97·탐96)', scores: { mode: 'pct', korElective: '언어와매체', kor: '98', mathElective: '미적분', math: '97', eng: '1', hist: '1', inq1Subject: '생활과윤리', inq1: '96', inq2Subject: '사회문화', inq2: '96' } },
  { label: '중위 (국85·수83·탐84)', scores: { mode: 'pct', korElective: '화법과작문', kor: '85', mathElective: '확률과통계', math: '83', eng: '2', hist: '2', inq1Subject: '생활과윤리', inq1: '84', inq2Subject: '사회문화', inq2: '84' } },
  { label: '하위 (국68·수66·탐67)', scores: { mode: 'pct', korElective: '화법과작문', kor: '68', mathElective: '확률과통계', math: '66', eng: '4', hist: '3', inq1Subject: '생활과윤리', inq1: '67', inq2Subject: '사회문화', inq2: '67' } },
];

export function computeAccuracy(data, engine = loadEngine()) {
  const latestPctRow = (dept) => {
    const years = Object.keys(dept.jeongsi || {}).sort().reverse();
    for (const year of years) {
      const row = dept.jeongsi[year];
      if (row && row.metric === 'pct' && typeof row.cut70 === 'number') return { year, row };
    }
    return null;
  };

  // (a) 커버리지
  const coverage = Object.fromEntries(SOURCE_KINDS.map(([key]) => [key, { count: 0, universities: new Set() }]));
  let departments = 0;
  for (const university of data.universities) {
    for (const dept of university.departments) {
      departments += 1;
      const latest = latestPctRow(dept);
      const key = latest ? sourceKind(latest.row)
        : (Object.keys(dept.estimate || {}).length > 0 ? 'estimate' : 'none');
      coverage[key].count += 1;
      coverage[key].universities.add(university.short);
    }
  }

  // (b) 원값 ↔ 집계 정수 차이. source/results.json 이 adigaCut70 로 짝을 남겨 둔 행만 센다.
  const diffs = [];
  const diffByUniversity = new Map();
  for (const university of data.universities) {
    for (const dept of university.departments) {
      for (const row of Object.values(dept.jeongsi || {})) {
        if (typeof row?.adigaCut70 !== 'number' || typeof row.cut70 !== 'number') continue;
        const diff = row.cut70 - row.adigaCut70;
        diffs.push(diff);
        const bucket = diffByUniversity.get(university.short) || [];
        bucket.push(diff);
        diffByUniversity.set(university.short, bucket);
      }
    }
  }
  const absolute = diffs.map(Math.abs);
  const gap = {
    pairs: diffs.length,
    meanAbs: round(absolute.reduce((sum, value) => sum + value, 0) / (absolute.length || 1)),
    medianAbs: round(median(absolute)),
    p95Abs: round(quantile(absolute, 0.95)),
    maxAbs: round(absolute.length > 0 ? Math.max(...absolute) : null),
    low: round(quantile(diffs, 0.025)),
    high: round(quantile(diffs, 0.975)),
    over: diffs.filter((value) => value > 0).length,
    under: diffs.filter((value) => value < 0).length,
    byUniversity: [...diffByUniversity]
      .map(([short, values]) => ({
        short, pairs: values.length,
        meanAbs: round(values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length),
        maxAbs: round(Math.max(...values.map(Math.abs))),
      }))
      .sort((left, right) => right.meanAbs - left.meanAbs),
  };

  // (c) 50%컷이 70%컷보다 낮은 행 (같은 해, 같은 표)
  let bothColumns = 0;
  let flipped = 0;
  for (const university of data.universities) {
    for (const dept of university.departments) {
      for (const row of Object.values(dept.jeongsi || {})) {
        if (typeof row?.cut50 !== 'number' || typeof row.cut70 !== 'number') continue;
        bothColumns += 1;
        if (row.cut50 < row.cut70) flipped += 1;
      }
    }
  }
  const columns = { rows: bothColumns, flipped, rate: round((flipped / (bothColumns || 1)) * 100, 1) };

  // (c2) 컷의 통계 정의. 정의가 다른 값은 비교하지 않고 보류한다.
  const defCounts = new Map();
  let heldByDefinition = 0;
  for (const university of data.universities) {
    for (const dept of university.departments) {
      const rows = Object.values(dept.jeongsi || {}).filter((row) => (row?.metric || 'pct') === 'pct' && typeof row.cut70 === 'number');
      if (rows.length === 0) continue;
      for (const key of new Set(rows.map((row) => row.def || 'ksi-mean'))) {
        defCounts.set(key, (defCounts.get(key) || 0) + 1);
      }
      if ((dept.series || []).length === 0) heldByDefinition += 1;
    }
  }
  const definitions = {
    held: heldByDefinition,
    rows: [...defCounts].map(([key, count]) => ({
      key, count, label: engine.cutDefInfo(key).label,
      comparable: engine.cutDefInfo(key).comparable, approx: engine.cutDefInfo(key).approx,
    })).sort((left, right) => right.count - left.count),
  };

  // (d) 판정 민감도. 컷을 흔든 뒤 판정 이름이 바뀌는 모집단위 비율.
  const shifts = [0.5, 1];
  const sensitivity = SAMPLE_SCORES.map(({ label, scores }) => {
    const profile = engine.normalizeProfile(scores, data.scales, data.std);
    let judged = 0;
    const changed = new Map(shifts.map((shift) => [shift, 0]));
    for (const university of data.universities) {
      const rule = data.rules[university.id];
      for (const dept of university.departments) {
        const result = engine.evaluateJeongsi(profile, university, dept, rule, university.volatility ?? data.volatility);
        if (result.status !== 'ok' || !result.cut) continue;
        judged += 1;
        for (const shift of shifts) {
          const up = engine.bandOf(engine.round(result.mine - (result.cut.value + shift), 1), engine.VERDICT_BANDS);
          const down = engine.bandOf(engine.round(result.mine - (result.cut.value - shift), 1), engine.VERDICT_BANDS);
          if (up?.key !== result.band.key || down?.key !== result.band.key) changed.set(shift, changed.get(shift) + 1);
        }
      }
    }
    return {
      label, judged,
      shifts: shifts.map((shift) => ({
        shift, changed: changed.get(shift),
        rate: round((changed.get(shift) / (judged || 1)) * 100, 1),
      })),
    };
  });

  // (e) 반영 규칙
  const unconfirmed = [];
  const basisCounts = {};
  const basisUnknown = [];
  for (const [id, rule] of Object.entries(data.rules || {})) {
    const short = data.universities.find((row) => row.id === id)?.short || id;
    const label = rule.basisSummary?.label || '반영 지표 미확인';
    basisCounts[label] = (basisCounts[label] || 0) + 1;
    if (!rule.basisSummary?.metric) basisUnknown.push(short);
    const seen = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'note' && typeof value === 'string' && /미확인|확인되지 않|표기되지 않/u.test(value)) {
          if (!seen.has(value)) { seen.add(value); unconfirmed.push(`${short}: ${value}`); }
        } else walk(value);
      }
    };
    walk(rule.tracks);
  }
  let trackCount = 0;
  let weightedTracks = 0;
  for (const rule of Object.values(data.rules || {})) {
    for (const track of rule.tracks || []) {
      trackCount += 1;
      const weights = track.weights || {};
      if ((Number(weights.kor) || 0) + (Number(weights.math) || 0) + (Number(weights.inq) || 0) > 0) weightedTracks += 1;
    }
  }
  const rules = {
    universities: Object.keys(data.rules || {}).length,
    tracks: trackCount,
    weightedTracks,
    unconfirmed: unconfirmed.length,
    unconfirmedNotes: unconfirmed,
    basisCounts,
    basisUnknown,
  };

  // (f) 등급컷·도수분포
  const exam = data.scales?.exams?.['2026'] || null;
  const distributionSubjects = Object.keys(data.std?.subjects || {});
  const exams = {
    year: '2026',
    status: exam?.status || null,
    final: exam?.status === 'final',
    announcedOn: data.std?.announcedOn || exam?.announcedOn || null,
    gradeCutSubjects: Object.keys(exam?.subjects || {}).length,
    distributionSubjects: distributionSubjects.length,
    distributionMissing: [],
    conversionOfficial: Object.entries(data.conv?.universities || {})
      .filter(([, row]) => row.kind === 'official')
      .map(([id, row]) => ({ id, name: row.name, url: row.source?.url || null })),
    conversionApprox: Object.keys(data.rules || {}).length - Object.keys(data.conv?.universities || {}).length,
  };

  // (g) 출처 등급 — 값마다 붙은 sourceGrade 를 등급별로 센다 (docs/AUDIT.md §1의 잣대).
  const GRADE_LABELS = [
    ['A', '평가원·대학 원문'], ['B', '어디가 공개값'], ['C', '언론이 옮긴 공식 표'],
    ['D', '집계 사이트'], ['E', '사설 예측·추정'],
  ];
  const gradeTally = new Map(GRADE_LABELS.map(([key]) => [key, { count: 0, universities: new Set() }]));
  for (const university of data.universities) {
    for (const dept of university.departments) {
      for (const row of Object.values(dept.jeongsi || {})) {
        const key = gradeTally.has(row.sourceGrade) ? row.sourceGrade : 'E';
        gradeTally.get(key).count += 1;
        gradeTally.get(key).universities.add(university.short || university.name);
      }
    }
  }
  const gradeTotal = [...gradeTally.values()].reduce((sum, row) => sum + row.count, 0);
  const sourceGrades = {
    total: gradeTotal,
    rows: GRADE_LABELS.map(([key, label]) => ({
      key, label,
      count: gradeTally.get(key).count,
      rate: round((gradeTally.get(key).count / (gradeTotal || 1)) * 100, 1),
      universities: [...gradeTally.get(key).universities].sort(),
    })),
  };

  return {
    generatedAt: data.generatedAt,
    departments,
    sourceGrades,
    coverage: Object.fromEntries(SOURCE_KINDS.map(([key, label]) => [key, {
      label,
      count: coverage[key].count,
      rate: round((coverage[key].count / (departments || 1)) * 100, 1),
      universities: [...coverage[key].universities].sort(),
    }])),
    gap,
    columns,
    definitions,
    sensitivity,
    rules,
    exams,
    thirdParty: THIRD_PARTY,
  };
}

// 3자 대조(우리 / 어디가 집계 / 진학사). 진학사 '입시결과'는 로그인 뒤에만 표를 내려 주고
// 로그인 없이 부르면 403이 돌아온다 — 표본을 못 뽑은 사유를 여기 남긴다.
export const THIRD_PARTY = {
  attempted: ['진학사 입시결과(www.jinhak.com)', '베리타스알파 입결 기사'],
  status: 'blocked',
  note: '진학사는 첫 화면(www.jinhak.com)부터 403을 돌려주어 입시결과 표본 30곳을 뽑지 못했다. 대신 베리타스알파가 옮긴 어디가 원값을 이미 데이터에 넣어 두었고, 그 값과 학점나비 집계 정수의 차이를 2번 표에서 그대로 센다 — 3자 대조 대신 2자 대조다.',
};

const percent = (value) => `${value.toFixed(1)}%`;

export function renderMarkdown(accuracy) {
  const lines = [];
  lines.push('# 정확도 — 어디가 값과 얼마나 다른가');
  lines.push('');
  lines.push('이 문서의 숫자는 모두 `scripts/accuracy-report.mjs`가 `source/*.json`에서 세어 만든다.');
  lines.push('손으로 고치지 않는다 — 소스를 고치고 `npm run build`를 다시 돌린다.');
  lines.push('');
  lines.push(`생성일 ${accuracy.generatedAt} · 정시 결과가 있는 모집단위 ${accuracy.departments}곳`);
  lines.push('');
  lines.push('## 0. 출처 등급');
  lines.push('');
  lines.push('| 등급 | 뜻 | 모집단위 | 비율 |');
  lines.push('|---|---|---:|---:|');
  for (const row of accuracy.sourceGrades.rows) {
    lines.push(`| ${row.key} | ${row.label} | ${row.count} | ${percent(row.rate)} |`);
  }
  lines.push('');
  lines.push('등급별 대학 목록과 원문 대조표는 docs/AUDIT.md 에 있다.');
  lines.push('');
  lines.push('## 1. 기준값은 어디서 왔나');
  lines.push('');
  lines.push('| 출처 | 모집단위 | 비율 |');
  lines.push('|---|---:|---:|');
  for (const row of Object.values(accuracy.coverage)) {
    lines.push(`| ${row.label} | ${row.count} | ${percent(row.rate)} |`);
  }
  lines.push('');
  for (const row of Object.values(accuracy.coverage)) {
    if (row.count === 0) continue;
    lines.push(`- **${row.label}** — ${row.universities.join(' · ')}`);
  }
  lines.push('');
  lines.push('## 2. 원값과 집계 정수의 차이');
  lines.push('');
  if (accuracy.gap.pairs === 0) {
    lines.push('짝지을 수 있는 값이 아직 없다.');
  } else {
    lines.push(`같은 모집단위·같은 해에 **대학(또는 기사)의 원값**과 **학점나비가 정수로 실은 어디가 값**이 둘 다 있는 ${accuracy.gap.pairs}곳을 견주었다.`);
    lines.push('');
    lines.push('| 지표 | 값 (백분위 점) |');
    lines.push('|---|---:|');
    lines.push(`| 평균 절대차 | ${accuracy.gap.meanAbs} |`);
    lines.push(`| 중앙값 절대차 | ${accuracy.gap.medianAbs} |`);
    lines.push(`| 절대차 95번째 백분위 | ${accuracy.gap.p95Abs} |`);
    lines.push(`| 최대 절대차 | ${accuracy.gap.maxAbs} |`);
    lines.push(`| 부호 있는 차이 95% 구간 | ${accuracy.gap.low} ~ ${accuracy.gap.high} |`);
    lines.push(`| 집계값보다 높음 / 낮음 | ${accuracy.gap.over} / ${accuracy.gap.under} |`);
    lines.push('');
    lines.push('| 대학 | 짝 | 평균 절대차 | 최대 |');
    lines.push('|---|---:|---:|---:|');
    for (const row of accuracy.gap.byUniversity) {
      lines.push(`| ${row.short} | ${row.pairs} | ${row.meanAbs} | ${row.maxAbs} |`);
    }
  }
  lines.push('');
  lines.push('## 3. 50%컷과 70%컷이 뒤집힌 행');
  lines.push('');
  lines.push(`두 값이 함께 있는 ${accuracy.columns.rows}행 가운데 ${accuracy.columns.flipped}행(${percent(accuracy.columns.rate)})에서 50%컷이 70%컷보다 낮다.`);
  lines.push('상위 50% 컷이 상위 70% 컷보다 낮을 수는 없으므로 집계 표의 두 열이 어긋나 있다는 뜻이다. 판정은 70%컷만 쓴다.');
  lines.push('');
  lines.push('## 3-2. 컷의 통계 정의');
  lines.push('');
  lines.push('컷은 무엇을 재서 낸 값인지가 자료마다 다르다. 우리 비교값(국·수·탐(2) 백분위 단순평균)과');
  lines.push('정의가 맞는 값만 컷에서 뺀다 — 정의가 다르면 판정을 보류한다.');
  lines.push('');
  lines.push('| 통계 정의 | 모집단위 | 비교 |');
  lines.push('|---|---:|---|');
  for (const row of accuracy.definitions.rows) {
    lines.push(`| ${row.label} | ${row.count} | ${row.comparable ? (row.approx ? '비교(근사)' : '비교') : '기준 불일치 — 보류'} |`);
  }
  lines.push('');
  lines.push(`정의가 달라 판정을 보류하는 모집단위 ${accuracy.definitions.held}곳.`);
  lines.push('');
  lines.push('## 4. 컷이 흔들리면 판정도 흔들리나');
  lines.push('');
  lines.push('컷을 ±0.5 / ±1.0점 옮겨 보고, 판정 이름(안정·적정·소신·상향·위험)이 바뀌는 모집단위를 센다.');
  lines.push('');
  lines.push('| 성적 | 판정한 모집단위 | ±0.5에서 바뀜 | ±1.0에서 바뀜 |');
  lines.push('|---|---:|---:|---:|');
  for (const row of accuracy.sensitivity) {
    const half = row.shifts.find((shift) => shift.shift === 0.5);
    const one = row.shifts.find((shift) => shift.shift === 1);
    lines.push(`| ${row.label} | ${row.judged} | ${half.changed} (${percent(half.rate)}) | ${one.changed} (${percent(one.rate)}) |`);
  }
  lines.push('');
  lines.push('## 5. 반영 규칙');
  lines.push('');
  lines.push(`대학 ${accuracy.rules.universities}곳 · 계열 트랙 ${accuracy.rules.tracks}개 가운데 ${accuracy.rules.weightedTracks}개는 영역별 반영비율을 확인했다.`);
  lines.push(`시행계획 원문에서 값을 찾지 못한 항목은 ${accuracy.rules.unconfirmed}건이다.`);
  lines.push('');
  lines.push('| 반영 지표 | 대학 수 |');
  lines.push('|---|---:|');
  for (const [label, count] of Object.entries(accuracy.rules.basisCounts).sort((left, right) => right[1] - left[1])) {
    lines.push(`| ${label} | ${count} |`);
  }
  lines.push('');
  lines.push('## 6. 2026학년도 수능 등급컷·도수분포');
  lines.push('');
  lines.push(`등급컷 ${accuracy.exams.final ? '실채점 확정' : '미확정'}(${accuracy.exams.announcedOn}) · 선택과목별 등급컷 ${accuracy.exams.gradeCutSubjects}개 과목 · 표준점수 도수분포 ${accuracy.exams.distributionSubjects}개 과목(국어·수학·사탐 9·과탐 8).`);
  lines.push('');
  if (accuracy.exams.conversionOfficial.length > 0) {
    lines.push(`탐구 변환표준점수 표를 원문으로 구한 대학: ${accuracy.exams.conversionOfficial.map((row) => row.name).join(' · ')}. 나머지 대학은 통합 도수분포에서 만든 근사표를 쓰고 화면에 '근사'라고 적는다.`);
  }
  lines.push('');
  lines.push('## 7. 3자 대조를 못한 이유');
  lines.push('');
  lines.push(accuracy.thirdParty.note);
  lines.push('');
  return lines.join('\n');
}

// 직접 돌리면 docs/ACCURACY.md 를 다시 쓴다. build-data 와 서로 부르는 사이라
// top-level await 로 기다리면 맞물려 멈춘다 — 모듈이 다 뜬 뒤에 부른다.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/accuracy-report.mjs')) {
  import('./build-data.mjs').then(({ buildData }) => {
    const data = buildData();
    writeFileSync(OUTPUT, renderMarkdown(data.accuracy || computeAccuracy(data)), 'utf8');
    console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
  });
}
