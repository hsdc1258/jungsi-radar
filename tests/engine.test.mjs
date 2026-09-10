// 입시 진단 엔진과 생성 데이터의 계약 테스트.
//   - 엔진: 등급↔백분위, 반영비율 가중, 가감점 환산, 판정 띠, 목표 학과 계획.
//   - 데이터: ipsi/assets/js/data.js가 소스 JSON에서 생성됐고 범위·출처 불변식을 지키는지.
// vm 컨텍스트가 만든 배열은 프로토타입이 달라 strict deepEqual이 실패한다 — 느슨한 assert를 쓴다.
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = process.cwd();
const load = (file, name) => {
  const context = { globalThis: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context[name];
};
const engine = load('assets/engine.js', 'IPSI_ENGINE');

const RULE = {
  id: 'demo',
  tracks: [
    { name: '인문', unit: 'points', weights: { kor: 200, math: 200, eng: 0, inq: 100 }, english: { method: '감산', table: { 1: 0, 2: -5, 3: -10 }, total: 500 }, inquiry: { count: 2 } },
    { name: '자연', unit: 'points', weights: { kor: 200, math: 300, eng: 0, inq: 200 }, english: { method: '감산', table: { 1: 0, 2: -5 }, total: 700 }, inquiry: { count: 2, scienceBonus: 0.05 }, mathBonus: 0.03 },
  ],
};
const DEPT = {
  name: '경영학과', track: '인문',
  jeongsi: { 2026: { cut70: 95.0, metric: 'pct', group: '가' }, 2025: { cut70: 94.0, metric: 'pct' } },
  gyogwa: { 2026: { cut70: 1.6, typeName: '추천' } },
};
const UNIVERSITY = { id: 'demo', name: '데모대학교', short: '데모대', departments: [DEPT] };

test('grade boundaries follow the fixed relative-grading percentiles', () => {
  assert.equal(engine.gradeFromPercentile(100), 1);
  assert.equal(engine.gradeFromPercentile(96), 1);
  assert.equal(engine.gradeFromPercentile(95.9), 2);
  assert.equal(engine.gradeFromPercentile(89), 2);
  assert.equal(engine.gradeFromPercentile(77), 3);
  assert.equal(engine.gradeFromPercentile(3), 9);
  assert.equal(engine.percentileFromGrade(1), 98);
  assert.equal(engine.percentileFromGrade(5), 50);
  assert.equal(engine.gradeFromPercentile(engine.percentileFromGrade(4)), 4);
});

test('raw scores interpolate between grade-cut rows', () => {
  const rows = [{ grade: 1, raw: 88, pct: 96 }, { grade: 2, raw: 80, pct: 89 }, { grade: 3, raw: 70, pct: 77 }];
  assert.equal(engine.percentileFromRaw(84, rows), 92.5);
  assert.equal(engine.percentileFromRaw(100, rows), 100);
  assert.equal(engine.percentileFromRaw(70, rows), 77);
  assert.equal(engine.percentileFromRaw(35, rows), 38.5);
});

test('normalizeProfile converts grade input and classifies inquiry subjects', () => {
  const profile = engine.normalizeProfile({ mode: 'grade', kor: 1, math: 2, eng: 2, hist: 3, korElective: '언어와매체', mathElective: '미적분', inq1Subject: '생활과윤리', inq1: 1, inq2Subject: '물리학I', inq2: 3, gpa: '2.4' });
  assert.equal(profile.kor.pct, 98);
  assert.equal(profile.math.pct, 92.5);
  assert.equal(profile.eng.grade, 2);
  assert.deepEqual(profile.inquiries.map((row) => row.kind), ['social', 'science']);
  assert.equal(profile.gpa, 2.4);
  assert.equal(engine.profileComplete(profile), true);
  assert.equal(engine.simpleAverage(profile), 93.67);
});

test('universityScore applies weights, english deduction and elective penalties', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 96, math: 90, eng: 2, hist: 1, mathElective: '확률과통계', inq1Subject: '사회문화', inq1: 94, inq2Subject: '생활과윤리', inq2: 90 });
  const humanities = engine.universityScore(profile, RULE, '인문');
  // (96*200 + 90*200 + 92*100) / 500 = 92.8, 영어 2등급 -5/500 = -1.0
  assert.equal(humanities.weighted, 92.8);
  assert.equal(humanities.value, 91.8);
  assert.equal(humanities.adjustments.length, 1);
  const natural = engine.universityScore(profile, RULE, '자연');
  const keys = natural.adjustments.map((row) => row.key).sort();
  assert.deepEqual(keys, ['eng', 'inq-science', 'math-elective']);
  assert.ok(natural.value < natural.weighted);
});

test('evaluateJeongsi bands the gap and reports the multi-year spread', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 98, math: 97, eng: 1, inq1Subject: '사회문화', inq1: 97, inq2Subject: '생활과윤리', inq2: 95 });
  const result = engine.evaluateJeongsi(profile, UNIVERSITY, DEPT, RULE);
  assert.equal(result.status, 'ok');
  // 2026(95)·2025(94)의 최근 가중 평균 = (95*0.6 + 94*0.3) / 0.9 = 94.67.
  assert.equal(result.cut.value, 94.67);
  assert.equal(result.cut.kind, '2개년 가중 평균');
  assert.equal(result.mine, 97.2);
  assert.equal(result.band.label, '안정');
  assert.equal(result.spread, 0.5);
  const weak = engine.normalizeProfile({ mode: 'pct', kor: 90, math: 90, eng: 3, inq1Subject: '사회문화', inq1: 90, inq2Subject: '생활과윤리', inq2: 90 });
  assert.equal(engine.evaluateJeongsi(weak, UNIVERSITY, DEPT, RULE).band.label, '위험');
});

test('score-only cuts are held back unless an estimate exists', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 98, math: 97, eng: 1, inq1Subject: '사회문화', inq1: 97, inq2Subject: '생활과윤리', inq2: 95 });
  const scoreDept = { name: '기계공학부', track: '자연', jeongsi: { 2026: { cut70: 655.2, metric: 'score', maxScore: 700 } } };
  assert.equal(engine.evaluateJeongsi(profile, UNIVERSITY, scoreDept, RULE).status, 'no-cut');
  const withEstimate = { ...scoreDept, estimate: { 2026: { pct: 96.5, source: 'jinhak' } } };
  const result = engine.evaluateJeongsi(profile, UNIVERSITY, withEstimate, RULE);
  assert.equal(result.status, 'ok');
  assert.equal(result.cut.basis, 'estimate');
});

test('analyzeTarget ranks subjects by weight and headroom and sizes the needed rise', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 93, math: 90, eng: 2, inq1Subject: '사회문화', inq1: 92, inq2Subject: '생활과윤리', inq2: 90 });
  const target = engine.analyzeTarget(profile, UNIVERSITY, DEPT, RULE);
  assert.ok(target.plan.need > 0);
  // 수학이 국어와 같은 비중이지만 현재 점수가 낮아 여지가 더 크므로 앞선다.
  assert.equal(target.plan.best.key, 'math');
  const math = target.plan.subjects.find((row) => row.key === 'math');
  assert.equal(math.share, 0.4);
  assert.equal(math.needed, engine.round(target.plan.need / 0.4, 1));
  assert.ok(target.plan.english.steps.length === 1 && target.plan.english.steps[0].gain === 1);
  assert.equal(target.gyogwa, null);
});

test('susi evaluation compares gpa with the latest cut', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 90, math: 90, eng: 2, inq1Subject: '사회문화', inq1: 90, gpa: 1.4 });
  const result = engine.evaluateSusi(profile, DEPT, 'gyogwa');
  assert.equal(result.gap, 0.2);
  assert.equal(result.band.label, '적정');
});

test('diagnose sorts by expected cut (high first) by default and honours track filters', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 95, math: 95, eng: 1, inq1Subject: '사회문화', inq1: 95, inq2Subject: '생활과윤리', inq2: 95 });
  const data = { universities: [{ ...UNIVERSITY, departments: [DEPT, { name: '경제학과', track: '인문', jeongsi: { 2026: { cut70: 93, metric: 'pct' } } }, { name: '기계공학부', track: '자연', jeongsi: { 2026: { cut70: 93, metric: 'pct' } } }] }], rules: { demo: RULE } };
  // 기본 정렬은 "갈 수 있는 가장 높은 곳부터" — 예상 컷 내림차순, 같은 컷이면 대학 순 → 학과 이름 순.
  const rows = engine.diagnose(profile, data);
  assert.deepEqual(rows.map((row) => row.dept.name), ['경영학과', '경제학과', '기계공학부']);
  assert.ok(rows[0].jeongsi.cut.value >= rows[1].jeongsi.cut.value);
  // 'gap' 정렬은 판정별 묶음 안에서 쓰는 아슬아슬한 순이다.
  // 사탐 응시자라 과탐 가산 불이익을 받는 기계공학부의 차이가 가장 작다.
  const byGap = engine.diagnose(profile, data, { sort: 'gap' });
  assert.deepEqual(byGap.map((row) => row.dept.name), ['기계공학부', '경영학과', '경제학과']);
  assert.equal(engine.diagnose(profile, data, { track: '자연' }).length, 1);
});

test('등급 → 백분위 환산은 구간의 정확한 중앙값이다', () => {
  const expected = [98, 92.5, 83, 68.5, 50, 31.5, 17, 7.5, 2];
  assert.deepEqual([...engine.GRADE_MIDPOINTS], expected);
  assert.deepEqual([...engine.GRADE_FLOORS], [96, 89, 77, 60, 40, 23, 11, 4, 0]);
  for (let grade = 1; grade <= 9; grade += 1) {
    const low = engine.GRADE_FLOORS[grade - 1];
    const high = grade === 1 ? 100 : engine.GRADE_FLOORS[grade - 2];
    assert.equal(engine.percentileFromGrade(grade), (low + high) / 2, `${grade}등급`);
    assert.equal(engine.percentileFromGrade(grade), expected[grade - 1]);
    // 백분위 ↔ 등급을 오가도 같은 표를 쓴다.
    assert.equal(engine.gradeFromPercentile(engine.percentileFromGrade(grade)), grade);
  }
  // 등급으로 넣은 성적은 중앙값 백분위로 계산된다.
  const profile = engine.normalizeProfile({ mode: 'grade', kor: 2, math: 1, inq1Subject: '사회문화', inq1: 3, inq2Subject: '생활과윤리', inq2: 3 });
  assert.equal(profile.kor.pct, 92.5);
  assert.equal(profile.math.pct, 98);
  assert.equal(engine.simpleAverage(profile), Math.round(((92.5 + 98 + 83) / 3) * 100) / 100);
});

test('영어도 우수한 영역 순(bestOf) 그룹에 들어갈 수 있다', () => {
  // 가천대 정시 일반전형1: 국어·수학 중 우수한 순 40:30, 영어·탐구 중 우수한 순 20:10.
  const rule = { name: '데모', tracks: [{ name: '인문', unit: 'percent', total: 1000, weights: {},
    bestOf: [{ areas: ['kor', 'math'], weights: [40, 30] }, { areas: ['eng', 'inq'], weights: [20, 10] }],
    english: { method: '비율반영', table: { 1: 98, 2: 95, 3: 92, 4: 86, 5: 80, 6: 60, 7: 50, 8: 40, 9: 30 } },
    inquiry: { count: 1 } }] };
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 90, math: 80, eng: 1, inq1Subject: '사회문화', inq1: 70 });
  const score = engine.universityScore(profile, rule, '인문', null);
  // 영어 1등급 = 100, 탐구 70 → 영어가 위라 20:10. 국어 90 > 수학 80 → 40:30.
  const expected = (90 * 40 + 80 * 30 + 100 * 20 + 70 * 10) / 100;
  assert.equal(score.value, Math.round(expected * 100) / 100);
  assert.ok(score.bestOfNotes.some((note) => note.includes('영어')));
});

const DATA_FILE = 'assets/data.js';
test('generated data.js exists, parses, and respects value ranges', { skip: !existsSync(path.join(ROOT, DATA_FILE)) && 'data.js not generated' }, () => {
  const data = load(DATA_FILE, 'IPSI_DATA');
  // 주요 40개 대학에 한국외대 캠퍼스 분리(+1)와 여자대학교 2곳(+2)을 더해 43곳이다.
  assert.equal(data.universities.length, 43, 'university count');
  assert.equal(Object.keys(data.rules).length, 43, 'rule count matches the university list');
  const ids = new Set(data.universities.map((row) => row.id));
  // 여자대학교는 생성물에 그대로 두고 화면의 '여대 제외' 토글이 숨긴다.
  for (const id of ['ewha', 'sookmyung']) {
    assert.ok(ids.has(id), `여자대학교 ${id}는 생성물에 있어야 한다`);
    assert.ok(id in data.rules, `여자대학교 ${id}의 규칙도 있어야 한다`);
    assert.equal(data.universities.find((row) => row.id === id).womenOnly, true, `${id}: womenOnly 표시`);
  }
  for (const row of data.universities) {
    if (['ewha', 'sookmyung'].includes(row.id)) continue;
    assert.notEqual(row.womenOnly, true, `${row.id}: 여대가 아니다`);
  }
  for (const id of ['inha', 'ajou', 'incheon', 'gachon', 'kyonggi', 'hanyang-erica', 'kau', 'hufs', 'hufs-global',
    'pnu', 'knu', 'jnu', 'jbnu', 'cnu', 'cbnu', 'kangwon', 'gnu', 'jejunu']) assert.ok(ids.has(id), `${id}가 있어야 한다`);
  const lines = data.lines.map((row) => row.label);
  assert.ok(lines.includes('중경외시') && !lines.includes('중경외시이'), '중경외시');
  assert.ok(lines.includes('건동홍') && !lines.includes('건동홍숙'), '건동홍');
  for (const label of ['인가경', '인하아주', '경기·인천', '지거국']) assert.ok(lines.includes(label), `라인 ${label}`);
  // 대학 순서는 대표 컷(예체능·의약 제외 2026 70%컷 중앙값) 내림차순이다.
  const ordered = [...data.universities].sort((left, right) => left.order - right.order);
  assert.deepEqual(ordered.map((row) => row.id), data.universities.map((row) => row.id), 'order는 배열 순서와 같다');
  const cuts = ordered.map((row) => row.medianCut).filter((value) => typeof value === 'number');
  for (let index = 1; index < cuts.length; index += 1) {
    assert.ok(cuts[index] <= cuts[index - 1], `대표 컷 내림차순 (${cuts[index - 1]} → ${cuts[index]})`);
  }
  let departments = 0;
  for (const university of data.universities) {
    assert.ok(university.id && university.name && university.short, `university identity ${university.id}`);
    assert.ok(university.departments.length >= 5, `${university.id}: at least 5 departments`);
    for (const dept of university.departments) {
      departments += 1;
      assert.ok(['인문', '자연', '의약', '예체능', '자유전공'].includes(dept.track), `${university.id} ${dept.name}: track ${dept.track}`);
      for (const [year, row] of Object.entries(dept.jeongsi || {})) {
        assert.match(year, /^20\d\d$/u);
        // 실기 비중이 큰 예체능은 수능 백분위 컷이 아주 낮게 잡힌다.
        if (row.metric === 'pct') assert.ok(row.cut70 > 0 && row.cut70 <= 100, `${university.id} ${dept.name} ${year}: pct cut ${row.cut70}`);
        if (row.metric === 'score') assert.ok(row.cut70 > 0 && row.maxScore >= row.cut70, `${university.id} ${dept.name} ${year}: score cut`);
        assert.ok(typeof row.url === 'string' && /^https?:/u.test(row.url), `${university.id} ${dept.name} ${year}: jeongsi url`);
      }
      for (const kind of ['gyogwa', 'hakjong']) {
        for (const [year, row] of Object.entries(dept[kind] || {})) {
          assert.ok(row.cut70 >= 1 && row.cut70 <= 9, `${university.id} ${dept.name} ${kind} ${year}: grade cut ${row.cut70}`);
        }
      }
    }
  }
  assert.ok(departments >= 1500, `at least 1500 departments (found ${departments})`);
  for (const [id, rule] of Object.entries(data.rules)) {
    assert.ok(Array.isArray(rule.tracks) && rule.tracks.length >= 1, `${id}: tracks`);
    for (const track of rule.tracks) {
      const weights = track.weights || {};
      const bestOf = (track.bestOf || []).flatMap((group) => group.weights || []).reduce((sum, weight) => sum + weight, 0);
      const total = (weights.kor || 0) + (weights.math || 0) + (weights.inq || 0) + bestOf;
      // 비율을 못 찾은 규칙은 비워 둘 수 있지만, 반드시 '미확인'이라고 적어야 한다
      // (정보 탭의 '아직 확인하지 못한 규칙' 목록이 그 문구를 센다).
      const unconfirmed = JSON.stringify(track).includes('미확인');
      assert.ok(total > 0 || unconfirmed, `${id} ${track.name}: weights 가 없으면 미확인이라고 적어야 한다`);
    }
  }
  assert.ok(data.scales?.exams?.['2026']?.subjects, 'scales for the 2026 exam');
});

// ---------------------------------------------------------------- 판정 정의 고정
// 정의는 하나뿐이다: 차이 = 내 환산 백분위 − 예상 컷(오차 반영 전), 소수 첫째 자리 반올림.
// 안정 ≥ +2.0 / 적정 +0.7~+2.0 / 소신 −0.7~+0.7 / 상향 −2.0~−0.7 / 위험 < −2.0 / 불가 = 자격 미충족.
const verdictOf = (gap) => (gap >= 2 ? '안정' : gap >= 0.7 ? '적정' : gap >= -0.7 ? '소신' : gap >= -2 ? '상향' : '위험');

test('판정 띠 표와 경계값 포함 관계가 정의 그대로다', () => {
  assert.deepEqual(engine.VERDICT_BANDS.map((band) => [band.key, band.label, band.min]),
    [['safe', '안정', 2], ['fit', '적정', 0.7], ['reach', '소신', -0.7], ['stretch', '상향', -2], ['risky', '위험', -Infinity]]);
  assert.equal(engine.VERDICT_DIGITS, 1);
  // 경계값은 위쪽 판정에 든다.
  for (const [gap, label] of [[2, '안정'], [1.9, '적정'], [0.7, '적정'], [0.6, '소신'], [-0.7, '소신'],
    [-0.8, '상향'], [-2, '상향'], [-2.1, '위험'], [0, '소신']]) {
    assert.equal(engine.bandOf(gap, engine.VERDICT_BANDS).label, label, `차이 ${gap}`);
    assert.equal(verdictOf(gap), label, `표 정의 ${gap}`);
  }
});

test('차이는 소수 첫째 자리로 반올림한 값이고 그 값으로 판정한다', () => {
  // 0.67을 "+0.7"로 적어 놓고 소신이라 부르면 안 된다.
  const dept = { name: '경계학과', track: '인문', jeongsi: { 2026: { cut70: 90, metric: 'pct' } } };
  const rule = { name: '데모', tracks: [{ name: '인문', unit: 'percent', weights: { kor: 1, math: 1, inq: 1 } }] };
  const cases = [[90.67, 0.7, '적정'], [90.64, 0.6, '소신'], [91.95, 2, '안정'], [91.94, 1.9, '적정'],
    [89.33, -0.7, '소신'], [89.24, -0.8, '상향'], [88.0, -2, '상향'], [87.9, -2.1, '위험']];
  for (const [mine, gap, label] of cases) {
    // 국·수·탐을 모두 같은 값으로 주면 가중 평균이 그 값이 된다.
    const profile = engine.normalizeProfile({ mode: 'pct', kor: mine, math: mine, eng: 1, inq1Subject: '사회문화', inq1: mine });
    const result = engine.evaluateJeongsi(profile, { id: 'demo', short: '데모' }, dept, rule, 1);
    assert.equal(result.gap, gap, `내 환산 ${mine}`);
    assert.equal(result.band.label, label, `내 환산 ${mine}`);
    // 화면이 적는 숫자(소수 첫째 자리)와 뱃지가 같은 값에서 나온다.
    assert.equal(Number(result.gap.toFixed(1)), result.gap);
  }
});

const VERDICT_CASES = [
  ['백분위 · 사탐 2과목', { mode: 'pct', kor: 96, math: 93, eng: '2', hist: '1', inq1Subject: '사회문화', inq1: 95, inq2Subject: '생활과윤리', inq2: 92 }],
  ['등급 입력', { mode: 'grade', kor: '2', math: '1', eng: '1', hist: '1', inq1Subject: '물리학I', inq1: '2', inq2Subject: '화학I', inq2: '3' }],
  ['탐구 1과목만', { mode: 'pct', kor: 88, math: 91, eng: '3', hist: '2', inq1Subject: '지구과학I', inq1: 90, inq2Subject: '', inq2: '' }],
  ['영어 미입력', { mode: 'pct', kor: 80, math: 78, eng: '', hist: '', inq1Subject: '사회문화', inq1: 82, inq2Subject: '경제', inq2: 79 }],
  ['과탐 2과목 · 미적분', { mode: 'pct', kor: 99, math: 100, eng: '1', hist: '1', mathElective: '미적분', inq1Subject: '물리학II', inq1: 98, inq2Subject: '화학I', inq2: 97 }],
];

test('성적 다섯 세트의 상위 20행에서 (차이, 뱃지)가 정의와 100% 일치한다', { skip: !existsSync(path.join(ROOT, DATA_FILE)) && 'data.js not generated' }, () => {
  const data = load(DATA_FILE, 'IPSI_DATA');
  for (const [name, scores] of VERDICT_CASES) {
    const profile = engine.normalizeProfile(scores, data.scales);
    assert.ok(engine.profileComplete(profile), `${name}: 프로필이 완성돼야 한다`);
    const rows = engine.diagnose(profile, data).filter((row) => row.jeongsi.status === 'ok' || row.jeongsi.status === 'blocked');
    assert.ok(rows.length >= 20, `${name}: 판정된 행이 20개 이상이어야 한다 (${rows.length})`);
    for (const row of rows.slice(0, 20)) {
      const { gap, band, mine, cut } = row.jeongsi;
      const where = `${name} · ${row.universityName} ${row.dept.name}`;
      assert.equal(gap, Math.round((mine - cut.value) * 10) / 10, `${where}: 차이 정의`);
      assert.equal(Number(gap.toFixed(1)), gap, `${where}: 소수 첫째 자리`);
      assert.equal(band.label, verdictOf(gap), `${where}: 차이 ${gap} → ${band.label}`);
    }
    // 목록 전체에서도 뱃지와 차이가 어긋나지 않는다.
    for (const row of rows) {
      assert.equal(row.jeongsi.band.label, verdictOf(row.jeongsi.gap),
        `${name} · ${row.universityName} ${row.dept.name}: 차이 ${row.jeongsi.gap}`);
    }
  }
});

test('오차(spread)는 판정을 바꾸지 않는다', { skip: !existsSync(path.join(ROOT, DATA_FILE)) && 'data.js not generated' }, () => {
  const data = load(DATA_FILE, 'IPSI_DATA');
  const profile = engine.normalizeProfile(VERDICT_CASES[0][1], data.scales);
  const rows = engine.diagnose(profile, data).filter((row) => row.jeongsi.status === 'ok');
  const withSpread = rows.filter((row) => typeof row.jeongsi.spread === 'number' && row.jeongsi.spread > 0);
  assert.ok(withSpread.length > 50, '오차가 붙은 행이 많아야 한다');
  for (const row of withSpread.slice(0, 200)) {
    assert.equal(row.jeongsi.band.label, verdictOf(row.jeongsi.gap));
  }
});
