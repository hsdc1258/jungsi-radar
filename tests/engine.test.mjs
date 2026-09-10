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
  // 비교값은 컷과 같은 정의 — 국·수·탐(2) 백분위 단순평균 (98 + 97 + 96) / 3 = 97.
  assert.equal(result.mine, 97);
  assert.equal(result.compare.basis, 'ksi-mean');
  // 대학 반영비율 가중 지수는 따로 들고 다니되 컷에서 빼지 않는다.
  assert.equal(result.index.basis, 'app-weighted');
  assert.notEqual(result.index.value, result.mine);
  assert.equal(result.gap, engine.round(97 - 94.67, 1));
  assert.equal(result.band.label, '안정');
  assert.equal(result.spread, 0.5);
  const weak = engine.normalizeProfile({ mode: 'pct', kor: 90, math: 90, eng: 3, inq1Subject: '사회문화', inq1: 90, inq2Subject: '생활과윤리', inq2: 90 });
  assert.equal(engine.evaluateJeongsi(weak, UNIVERSITY, DEPT, RULE).band.label, '위험');
});

test('score-only cuts are held back unless an estimate exists', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 98, math: 97, eng: 1, inq1Subject: '사회문화', inq1: 97, inq2Subject: '생활과윤리', inq2: 95 });
  const scoreDept = { name: '기계공학부', track: '자연', jeongsi: { 2026: { cut70: 655.2, metric: 'score', maxScore: 700 } } };
  // 환산점수 눈금은 백분위로 되돌릴 수 없다 — 유일하게 남는 '기준 불일치'다.
  assert.equal(engine.evaluateJeongsi(profile, UNIVERSITY, scoreDept, RULE).status, 'basis-mismatch');
  const withEstimate = { ...scoreDept, estimate: { 2026: { pct: 96.5, source: 'jinhak' } } };
  const result = engine.evaluateJeongsi(profile, UNIVERSITY, withEstimate, RULE);
  assert.equal(result.status, 'ok');
  assert.equal(result.cut.basis, 'estimate');
});

test('analyzeTarget ranks subjects by weight and headroom and sizes the needed rise', () => {
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 93, math: 90, eng: 2, inq1Subject: '사회문화', inq1: 92, inq2Subject: '생활과윤리', inq2: 90 });
  const target = engine.analyzeTarget(profile, UNIVERSITY, DEPT, RULE);
  assert.ok(target.plan.need > 0);
  // 상승폭은 비교 기준(국·수·탐 단순평균) 위에서 잰다 — 세 영역의 비중은 각각 1/3이다.
  assert.equal(target.plan.basis, 'ksi-mean');
  assert.equal(target.plan.best.key, 'math');
  const math = target.plan.subjects.find((row) => row.key === 'math');
  assert.equal(math.share, engine.round(1 / 3, 3));
  assert.equal(math.needed, engine.round(target.plan.need / (1 / 3), 1));
  // 영어는 비교 기준에 들어가지 않으므로 상승 효과를 계산하지 않는다.
  assert.equal(target.plan.english, null);
  assert.equal(target.plan.need, engine.round(Math.max(0, target.cut.value + engine.TARGET_MARGIN - target.mine), 2));
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
  // 비교값은 대학 반영비율과 무관하므로, 차이가 작은 순 = 컷이 높은 순이다.
  const byGap = engine.diagnose(profile, data, { sort: 'gap' });
  assert.deepEqual(byGap.map((row) => row.dept.name), ['경영학과', '경제학과', '기계공학부']);
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
  for (const label of ['인하아주', '경기·인천', '지거국', '여대']) assert.ok(lines.includes(label), `라인 ${label}`);
  // 라인 표는 통용 라인 순위 그대로다 (docs/FRAME.md §8.3).
  assert.deepEqual(lines, ['서연고', '서성한', '중경외시', '건동홍', '국숭세단', '광명상가', '한서삼',
    '인하아주', '경기·인천', '지거국', '여대'], '라인 순위');
  // 대학 순서는 컷 중앙값이 아니라 라인 순위다.
  const ordered = [...data.universities].sort((left, right) => left.order - right.order);
  assert.deepEqual(ordered.map((row) => row.id), data.universities.map((row) => row.id), 'order는 배열 순서와 같다');
  assert.deepEqual(ordered.map((row) => row.id), data.lines.flatMap((line) => line.ids), '대학 순서는 라인 표 순서');
  for (const university of data.universities) {
    const line = data.lines.find((row) => row.ids.includes(university.id));
    assert.equal(university.line, line.label, `${university.id}: 라인 이름`);
  }
  // 컷 중앙값은 값으로 남아 정보 탭 표가 쓴다.
  assert.ok(data.universities.filter((row) => typeof row.medianCut === 'number').length > 20, '대표 컷이 남아 있다');
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
        const sourced = typeof row.url === 'string' && /^https?:/u.test(row.url);
        assert.ok(sourced || /확인하지 못|비워/u.test(String(row.note || '')), `${university.id} ${dept.name} ${year}: jeongsi url`);
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
// 띠 표 + 단서 하나. "안정은 50% 지점도 넘어야 한다"(docs/MODEL.md §3)는 **환산점수**를 말하므로
// 눈금이 환산점수인 L1에서만 건다 — L2(지수)·L3(백분위)은 띠 표 그대로다.
const verdictOfRow = (result) => {
  const label = verdictOf(result.gap);
  if (label !== '안정' || result.level !== 'L1') return label;
  const mine = result.mineDetail?.score;
  const cut50 = result.cut?.score50;
  return typeof mine === 'number' && typeof cut50 === 'number' && mine < cut50 ? '적정' : label;
};

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
    const rows = engine.diagnose(profile, data).filter((row) => row.jeongsi.status === 'ok');
    assert.ok(rows.length >= 20, `${name}: 판정된 행이 20개 이상이어야 한다 (${rows.length})`);
    for (const row of rows.slice(0, 20)) {
      const { gap, band, mine, cut } = row.jeongsi;
      const where = `${name} · ${row.universityName} ${row.dept.name}`;
      assert.equal(gap, Math.round((mine - cut.value) * 10) / 10, `${where}: 차이 정의`);
      assert.equal(Number(gap.toFixed(1)), gap, `${where}: 소수 첫째 자리`);
      assert.equal(band.label, verdictOfRow(row.jeongsi), `${where}: 차이 ${gap} → ${band.label}`);
    }
    // 목록 전체에서도 뱃지와 차이가 어긋나지 않는다.
    for (const row of rows) {
      assert.equal(row.jeongsi.band.label, verdictOfRow(row.jeongsi),
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
    assert.equal(row.jeongsi.band.label, verdictOfRow(row.jeongsi),
      `${row.universityName} ${row.dept.name}: 오차 ${row.jeongsi.spread}가 판정에 섞였다`);
  }
});

// ---------------------------------------------------------------- 표준점수
const STD = JSON.parse(readFileSync(path.join(ROOT, 'source/std-2026.json'), 'utf8'));
const CONV = JSON.parse(readFileSync(path.join(ROOT, 'source/conv-2026.json'), 'utf8'));
const RULES_2027 = JSON.parse(readFileSync(path.join(ROOT, 'source/rules-2027.json'), 'utf8')).universities;

test('도수분포가 평가원 원자료와 어긋나지 않는다 (인원 합 = 응시자, 백분위 정의)', () => {
  for (const [key, subject] of Object.entries(STD.subjects)) {
    const sum = subject.rows.reduce((total, row) => total + row[1], 0);
    assert.equal(sum, subject.n, `${key}: 인원 합 ${sum} ≠ ${subject.n}`);
    assert.equal(subject.rows[0][0], subject.maxStd, `${key}: 첫 줄이 만점 표준점수가 아니다`);
    // 백분위 = (미만 인원 + 동점 인원/2) / 전체 × 100, 반올림.
    const ascending = [...subject.rows].reverse();
    let below = 0;
    for (const [std, count, pct] of ascending) {
      assert.equal(pct, Math.round((below + count / 2) / subject.n * 100), `${key} 표준점수 ${std}`);
      below += count;
    }
    // 표준점수가 오르면 백분위도 오른다.
    for (let index = 0; index < subject.rows.length - 1; index += 1) {
      assert.ok(subject.rows[index][2] >= subject.rows[index + 1][2], `${key}: 백분위가 뒤집혔다`);
    }
  }
});

test('percentileFromStd가 연세대 2026 산출 안내의 예시를 그대로 낸다', () => {
  // 안내문이 표준점수와 백분위를 나란히 적어 둔 여섯 점 — 우리 표가 그 값을 그대로 내야 한다.
  const cases = [['국어', 131, 94], ['수학', 128, 96], ['탐구-생활과윤리', 65, 92],
    ['탐구-한국지리', 67, 94], ['탐구-물리학I', 63, 88], ['탐구-화학II', 68, 96]];
  for (const [key, std, pct] of cases) {
    const read = engine.percentileFromStd(key, std, STD);
    assert.equal(read.pct, pct, `${key} 표준점수 ${std}`);
    assert.equal(read.exact, true, `${key}: 원자료에 있는 점수인데 근사로 나왔다`);
  }
  // 등급 구분 표준점수는 그대로 그 등급의 첫 점이다.
  assert.equal(engine.percentileFromStd('국어', 133, STD).grade, 1);
  assert.equal(engine.percentileFromStd('국어', 132, STD).grade, 2);
  // 표에 없는 점수는 근사로 표시한다.
  const between = engine.percentileFromStd('국어', 146, STD);
  assert.equal(between.exact, false);
  assert.ok(between.pct >= 99 && between.pct <= 100);
  // 없는 과목은 null.
  assert.equal(engine.percentileFromStd('탐구-없는과목', 60, STD), null);
});

test('표준점수 입력이 백분위로 흘러 기존 계산과 같은 길을 간다', () => {
  const profile = engine.normalizeProfile({
    mode: 'std', kor: 131, math: 128, eng: '2', hist: '1',
    inq1Subject: '생활과윤리', inq1: 65, inq2Subject: '한국지리', inq2: 67,
  }, null, STD);
  assert.equal(profile.kor.pct, 94);
  assert.equal(profile.math.pct, 96);
  assert.equal(profile.kor.std, 131);
  assert.equal(engine.simpleAverage(profile), engine.round((94 + 96 + 93) / 3, 2));
  assert.equal(profile.stdReads['탐구-한국지리'].pct, 94);
});

test('universityRawScore가 연세대 2026 산출 예시를 소수 넷째 자리까지 재현한다', () => {
  const options = { std: STD, conv: CONV, universityId: 'yonsei' };
  // 유형Ⅰ(인문): 국어 131 · 수학 128 · 영어 2등급 · 사탐 65/67 → (196.5+128+95+134.312) × 950/800
  const humanities = engine.normalizeProfile({
    mode: 'std', kor: 131, math: 128, eng: '2', hist: '3',
    inq1Subject: '생활과윤리', inq1: 65, inq2Subject: '한국지리', inq2: 67,
  }, null, STD);
  const first = engine.universityRawScore(humanities, RULES_2027.yonsei, '인문', options);
  assert.equal(first.basis, 'official');
  assert.equal(first.approx, false);
  assert.equal(first.value, 657.6518);
  // 유형Ⅱ(자연): 같은 성적에 영어 3등급 → (131+192+87.5+195.6) × 950/900
  const natural = engine.normalizeProfile({
    mode: 'std', kor: 131, math: 128, eng: '3', hist: '3',
    inq1Subject: '생활과윤리', inq1: 65, inq2Subject: '한국지리', inq2: 67,
  }, null, STD);
  assert.equal(engine.universityRawScore(natural, RULES_2027.yonsei, '자연', options).value, 639.7722);
  // 한국사 5등급이면 0.2점을 뺀다.
  const penalised = engine.normalizeProfile({
    mode: 'std', kor: 131, math: 128, eng: '2', hist: '5',
    inq1Subject: '생활과윤리', inq1: 65, inq2Subject: '한국지리', inq2: 67,
  }, null, STD);
  // 감점은 척도를 걸고 난 뒤에 뺀다 — (…)×950/800 = 657.65185 에서 0.2를 빼고 반올림한다.
  assert.equal(engine.universityRawScore(penalised, RULES_2027.yonsei, '인문', options).value, 657.4517);
});

test('입학처 산식이 없는 대학은 배점 근사값을 내고 근사라고 말한다', () => {
  const profile = engine.normalizeProfile({
    mode: 'std', kor: 131, math: 128, eng: '2', hist: '1',
    inq1Subject: '생활과윤리', inq1: 65, inq2Subject: '한국지리', inq2: 67,
  }, null, STD);
  // 한국외대는 입학처 산식도, 대학이 낸 탐구 변환표도 아직 못 구한 대학이다.
  const raw = engine.universityRawScore(profile, RULES_2027.hufs, '인문', { std: STD, conv: CONV, universityId: 'hufs' });
  assert.equal(raw.basis, 'rules');
  assert.equal(raw.approx, true);
  assert.ok(raw.value > 0 && raw.value <= raw.max, `${raw.value} / ${raw.max}`);
  // 탐구 변환표가 없는 대학은 통합 근사표를 쓴다.
  assert.equal(raw.conversion.kind, 'approx');
  // 만점 성적은 만점 근처를 낸다.
  const perfect = engine.normalizeProfile({
    mode: 'std', kor: STD.subjects['국어'].maxStd, math: STD.subjects['수학'].maxStd, eng: '1', hist: '1',
    inq1Subject: '생활과윤리', inq1: STD.subjects['탐구-생활과윤리'].maxStd,
    inq2Subject: '한국지리', inq2: STD.subjects['탐구-한국지리'].maxStd,
  }, null, STD);
  const top = engine.universityRawScore(perfect, RULES_2027.hufs, '인문', { std: STD, conv: CONV, universityId: 'hufs' });
  assert.ok(top.value > raw.value, '만점이 더 높아야 한다');
  assert.ok(top.value <= top.max + 0.01, `${top.value} > ${top.max}`);
});

test('탐구 변환표는 백분위가 오르면 값도 오른다', () => {
  const entries = [['approx', CONV.approx.table]];
  for (const [key, row] of Object.entries(CONV.universities)) {
    if (row.table) entries.push([key, row.table]);
    // 사탐·과탐 표를 따로 낸 대학은 표마다 확인한다.
    for (const [kind, table] of Object.entries(row.tables || {})) entries.push([`${key}.${kind}`, table]);
  }
  for (const [id, table] of entries) {
    for (let pct = 0; pct < 100; pct += 1) {
      assert.ok(Number(table[String(pct + 1)]) >= Number(table[String(pct)]), `${id}: 백분위 ${pct} → ${pct + 1}`);
    }
    assert.equal(engine.convertedStd(100, table), Number(table['100']));
  }
});

test('정확도 보고서 숫자가 데이터와 맞는다', () => {
  const accuracy = load(DATA_FILE, 'IPSI_DATA').accuracy;
  assert.ok(accuracy, 'data.accuracy 가 없다');
  const total = Object.values(accuracy.coverage).reduce((sum, row) => sum + row.count, 0);
  assert.equal(total, accuracy.departments);
  assert.ok(accuracy.gap.pairs > 0, '원값 ↔ 집계 정수 짝이 하나도 없다');
  assert.ok(accuracy.gap.meanAbs >= 0 && accuracy.gap.maxAbs >= accuracy.gap.meanAbs);
  assert.equal(accuracy.columns.rows > 0, true);
  assert.equal(accuracy.sensitivity.length, 3);
  for (const row of accuracy.sensitivity) {
    assert.ok(row.judged > 0);
    // 컷을 더 많이 흔들수록 판정이 바뀌는 곳이 늘어난다.
    assert.ok(row.shifts[1].changed >= row.shifts[0].changed, row.label);
  }
});

test('모든 대학에 반영 지표 요약이 붙는다', () => {
  for (const [id, rule] of Object.entries(load(DATA_FILE, 'IPSI_DATA').rules)) {
    const summary = rule.basisSummary;
    assert.ok(summary, `${id}: basisSummary 없음`);
    assert.ok(summary.label.length > 0, `${id}: 라벨이 비었다`);
    assert.ok([null, 'std', 'pct', 'grade'].includes(summary.metric), `${id}: metric ${summary.metric}`);
    // 백분위 반영 대학에는 '백분위 근사' 딱지를 붙이지 않는다.
    assert.equal(summary.approxPercentile, summary.metric !== null && summary.metric !== 'pct', id);
  }
});

// ---------------------------------------------------------------- 비교 기준 회귀 테스트
// (2026-09-10 검수) 서로 다른 눈금의 값을 빼서 '적정'을 만들던 문제를 막는다.

test('서로 다른 눈금을 빼지 않는다 — 컷 정의가 다르면 내 성적도 그 정의로 계산해 뺀다', () => {
  // 국 95 · 수 70 · 탐 90/80(평균 85). 눈금마다 내 값이 달라야 한다.
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 95, math: 70, eng: 2, inq1Subject: '사회문화', inq1: 90, inq2Subject: '생활과윤리', inq2: 80 });
  const at = (def) => engine.evaluateJeongsi(profile, UNIVERSITY, {
    name: '미래융합학부', track: '인문', jeongsi: { 2025: { cut70: 82.8, metric: 'pct', def } },
  }, RULE);
  // 국·수·탐(2) 평균 = (95+70+85)/3 = 83.33
  const ksi = at('ksi-mean');
  assert.equal(ksi.status, 'ok');
  assert.equal(ksi.mine, 83.33);
  assert.equal(ksi.gap, 0.5);
  // 상위 2개 영역 평균 = (95+85)/2 = 90 — 국·수·탐 평균을 이 컷에서 빼면 안 된다.
  const top2 = at('top2-mean');
  assert.equal(top2.status, 'ok');
  assert.equal(top2.def, 'top2-mean');
  assert.equal(top2.mine, 90);
  assert.equal(top2.gap, 7.2);
  assert.notEqual(top2.mine, ksi.mine, '다른 눈금이면 내 값도 달라야 한다');
  assert.notEqual(top2.gap, ksi.gap);
  // 국·탐 평균(수학 미반영) = (95+85)/2 = 90 · 상위 1과목 = (95+70+90)/3 = 85
  assert.equal(at('kor-inq-mean').mine, 90);
  assert.equal(at('ksi1-mean').mine, 85);
  // 과목별 70%컷 평균은 같은 눈금(근사)이라 국·수·탐 평균 그대로 뺀다.
  assert.equal(at('subject-mean70').mine, 83.33);
  assert.equal(at('subject-mean70').approxDef, true);
});

test('컷 정의별 comparableScore는 손 계산과 같다 — 명지·서경', { skip: !existsSync(path.join(ROOT, DATA_FILE)) && 'data.js not generated' }, () => {
  const data = load(DATA_FILE, 'IPSI_DATA');
  // 국 78 · 수 62 · 탐 80/77 (탐구 2과목 평균 78.5 · 상위 1과목 80)
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 78, math: 62, eng: 2, hist: 3, inq1Subject: '생활과윤리', inq1: 80, inq2Subject: '사회문화', inq2: 77 }, data.scales, data.std);
  // 판정은 가장 최근 연도의 정의로 내리므로 고를 때도 최근 연도를 본다.
  const latest = (dept) => {
    const years = Object.keys(dept.jeongsi || {}).sort().reverse();
    return years.length > 0 ? dept.jeongsi[years[0]] : null;
  };
  const pick = (id, def) => {
    const university = data.universities.find((row) => row.id === id);
    const dept = university.departments.find((row) => latest(row)?.def === def);
    return dept ? engine.evaluateJeongsi(profile, university, dept, data.rules[id], university.volatility) : null;
  };
  // 명지대 — 국·수·탐(상위 1과목) 평균 = (78 + 62 + 80) / 3 = 73.33
  const mju = pick('mju', 'ksi1-mean');
  assert.equal(mju.def, 'ksi1-mean');
  assert.equal(mju.mine, 73.33);
  assert.equal(mju.status, 'ok');
  // 서경대 — 국·수·탐 중 상위 2개 평균 = (78.5 + 78) / 2 = 78.25
  const skuniv = pick('skuniv', 'top2-mean');
  assert.equal(skuniv.def, 'top2-mean');
  assert.equal(skuniv.mine, 78.25);
  assert.equal(skuniv.status, 'ok');
  // 건국대 예체능의 '국·탐 2영역 평균'은 이제 데이터에 없다 — 어디가 원값(평균백분위)이
  // 수학까지 넣은 국·수·탐(2) 평균이라 그 정의로 덮였다(docs/MODEL.md §0). 엔진의 계산 자체는
  // 위 '컷 정의별 내 점수' 테스트가 합성 입력으로 계속 검사한다.
  assert.equal(pick('konkuk', 'kor-inq-mean'), null, '건국대에 국·탐 2영역 평균 컷이 남아 있으면 안 된다');
  // 국·수·탐(2) 평균(72.83)을 두 곳 어디에도 그대로 쓰지 않는다.
  assert.equal(engine.simpleAverage(profile), 72.83);
  for (const result of [mju, skuniv]) assert.notEqual(result.mine, 72.83);
});

test('반영비율 가중 지수는 컷에서 빼지 않는다 (비교값은 국·수·탐 단순평균 하나뿐)', () => {
  // 영어 1등급이라 가중 지수는 크게 뜨지만, 비교값은 국·수·탐 평균 그대로여야 한다.
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 83, math: 68.5, eng: 1, hist: 1, inq1Subject: '사회문화', inq1: 83, inq2Subject: '정치와법', inq2: 83 });
  const ratioRule = {
    tracks: [{ name: '인문', unit: 'percent', total: 1000, weights: { kor: 35, math: 20, eng: 20, inq: 25 }, english: { method: '비율반영', table: { 1: 100, 2: 100, 3: 98.5 } }, inquiry: { count: 2 } }],
  };
  const dept = { name: '사회복지학부', track: '인문', jeongsi: { 2026: { cut70: 82.33, metric: 'pct', def: 'ksi-mean' } } };
  const result = engine.evaluateJeongsi(profile, UNIVERSITY, dept, ratioRule);
  assert.equal(result.mine, engine.simpleAverage(profile));
  assert.equal(result.mine, 78.17);
  assert.ok(result.index.value > 83, `가중 지수는 따로 남는다 (${result.index.value})`);
  assert.equal(result.gap, engine.round(78.17 - 82.33, 1));
  assert.notEqual(result.gap, engine.round(result.index.value - 82.33, 1));
});

test('등급 입력은 구간 중앙 백분위로 판정한다 — 보류하지 않는다', () => {
  const grades = engine.normalizeProfile({ mode: 'grade', kor: 3, math: 4, eng: 2, hist: 4, inq1Subject: '정치와법', inq1: 3, inq2Subject: '사회문화', inq2: 3 });
  const exact = engine.normalizeProfile({ mode: 'pct', kor: 83, math: 68.5, eng: 2, hist: 4, inq1Subject: '정치와법', inq1: 83, inq2Subject: '사회문화', inq2: 83 });
  const dept = { name: '사회복지학부', track: '인문', jeongsi: { 2026: { cut70: 82.33, metric: 'pct', def: 'ksi-mean' } } };
  const guessed = engine.evaluateJeongsi(grades, UNIVERSITY, dept, RULE);
  const judged = engine.evaluateJeongsi(exact, UNIVERSITY, dept, RULE);
  // 대표 백분위가 같으니 판정도 같다 — 다른 것은 '추정'이라고 적는지뿐이다.
  assert.equal(guessed.mine, judged.mine);
  assert.equal(guessed.status, 'ok');
  assert.equal(guessed.band.label, judged.band.label);
  assert.equal(guessed.hold, null);
  assert.equal(guessed.estimated, true);
  assert.ok(guessed.compare.assumptions.length >= 4, '가정한 값을 그대로 보여 준다');
  // 구간은 그대로 돌려준다 — 판정을 접는 대신 하한·상한의 판정을 함께 알린다.
  assert.equal(guessed.bounds.min, 71.33);
  assert.equal(guessed.bounds.max, 84);
  assert.ok(guessed.gapRange.min < guessed.gapRange.max);
  assert.equal(guessed.gapRange.minBand.label, '위험');
  assert.equal(guessed.gapRange.maxBand.label, '적정');
  assert.equal(judged.estimated, false);
  assert.equal(judged.gapRange, null);
  // 등급 구간은 제도가 정한 경계 그대로다(3등급 = 백분위 77~88).
  assert.deepEqual({ ...engine.percentileRangeOfGrade(3) }, { min: 77, max: 88 });
  assert.deepEqual({ ...engine.percentileRangeOfGrade(1) }, { min: 96, max: 100 });
  // 중앙값은 구간의 정확한 가운데다.
  assert.equal(engine.percentileFromGrade(3), 83);
  assert.equal(engine.percentileFromGrade(4), 68.5);
});

test('등급 입력이라도 구간 전체가 한 판정에 들면 그 판정을 낸다', () => {
  const grades = engine.normalizeProfile({ mode: 'grade', kor: 1, math: 1, eng: 1, inq1Subject: '사회문화', inq1: 1, inq2Subject: '생활과윤리', inq2: 1 });
  // 컷 60이면 1등급 구간(96~100)의 어느 값을 넣어도 '안정'이다.
  const easy = { name: '컷낮은학과', track: '인문', jeongsi: { 2026: { cut70: 60, metric: 'pct', def: 'ksi-mean' } } };
  const result = engine.evaluateJeongsi(grades, UNIVERSITY, easy, RULE);
  assert.equal(result.status, 'ok');
  assert.equal(result.band.label, '안정');
  assert.equal(result.estimated, true);
});

test('필요한 영역이 비면 그때만 보류한다', () => {
  const partial = engine.normalizeProfile({ mode: 'pct', kor: 90, math: '', eng: 2, inq1Subject: '사회문화', inq1: 90 });
  const result = engine.evaluateJeongsi(partial, UNIVERSITY, DEPT, RULE);
  assert.equal(result.status, 'hold');
  assert.equal(result.hold.reason, '수학 미입력');
  assert.equal(result.mine, null);
  assert.equal(result.gap, null);
  assert.equal(engine.comparableScore(partial), null);
  assert.deepEqual([...engine.missingFor(partial, 'ksi-mean')], ['수학']);
  // 수학을 반영하지 않는 눈금이면 같은 성적으로도 판정한다.
  assert.deepEqual([...engine.missingFor(partial, 'kor-inq-mean')], []);
  assert.equal(engine.comparableScore(partial, 'kor-inq-mean').value, 90);
  // 아무것도 넣지 않았으면 보류가 아니라 '성적 미입력'이다.
  const empty = engine.normalizeProfile({ mode: 'pct' });
  assert.equal(engine.evaluateJeongsi(empty, UNIVERSITY, DEPT, RULE).status, 'no-profile');
});

test('공식 환산표가 없으면 공식 환산점수라고 말하지 않는다', () => {
  const profile = engine.normalizeProfile({ mode: 'std', kor: 131, math: 128, eng: 2, hist: 1, korElective: '언어와매체', mathElective: '미적분', inq1Subject: '생활과윤리', inq1: 65, inq2Subject: '한국지리', inq2: 67 },
    null, load('assets/data.js', 'IPSI_DATA').std);
  const data = load('assets/data.js', 'IPSI_DATA');
  const yonsei = engine.universityRawScore(profile, data.rules.yonsei, '인문', { std: data.std, conv: data.conv, universityId: 'yonsei' });
  assert.equal(yonsei.basis, 'official');
  assert.equal(yonsei.approx, false);
  const soongsil = engine.universityRawScore(profile, data.rules.soongsil, '인문', { std: data.std, conv: data.conv, universityId: 'soongsil' });
  assert.equal(soongsil.basis, 'rules');
  assert.equal(soongsil.approx, true, '산출식을 못 구한 대학은 근사라고 말한다');
  assert.equal(soongsil.conversion.kind, 'official', '숭실대는 대학이 낸 변환표준점수 표를 쓴다');
  // 대학이 낸 변환표를 못 구한 대학은 통합 근사표라고 말한다.
  const hufs = engine.universityRawScore(profile, data.rules.hufs, '인문', { std: data.std, conv: data.conv, universityId: 'hufs' });
  assert.equal(hufs.conversion.kind, 'approx', '변환표를 못 구한 대학은 근사표다');
});

test('재현 입력(3·4·2·3·3·4)에서 숭실대에 근거 없는 적정이 다시 뜨지 않는다', { skip: !existsSync(path.join(ROOT, DATA_FILE)) && 'data.js not generated' }, () => {
  const data = load(DATA_FILE, 'IPSI_DATA');
  const profile = engine.normalizeProfile({
    mode: 'grade', kor: 3, korElective: '화법과작문', math: 4, mathElective: '확률과통계',
    eng: 2, hist: 4, inq1Subject: '정치와법', inq1: 3, inq2Subject: '사회문화', inq2: 3,
  }, data.scales, data.std);
  assert.equal(engine.simpleAverage(profile), 78.17);
  const soongsil = data.universities.find((row) => row.id === 'soongsil');
  for (const name of ['사회복지학부', '법학과', '국제법무학과', '평생교육학과']) {
    const dept = soongsil.departments.find((row) => row.name === name);
    const result = engine.evaluateJeongsi(profile, soongsil, dept, data.rules.soongsil, soongsil.volatility);
    assert.equal(result.mine, 78.17, `${name}: 비교값은 국·수·탐 평균이어야 한다`);
    assert.equal(result.status, 'ok', `${name}: 등급 입력도 구간 중앙값으로 판정한다 (지금 ${result.status})`);
    assert.equal(result.estimated, true, `${name}: 추정이라고 밝힌다`);
    assert.notEqual(result.band.label, '적정', `${name}: 적정이 다시 뜨면 안 된다`);
    assert.notEqual(result.band.label, '상향', `${name}: 상향도 아니다 — 차이가 −2.0보다 크게 벌어진다`);
    assert.ok(result.gap < 0, `${name}: 컷보다 낮다 (${result.gap})`);
    // 구간 하한·상한의 판정을 함께 돌려준다(화면이 한 줄로 적는다).
    assert.ok(result.gapRange && result.gapRange.minBand && result.gapRange.maxBand, `${name}: 구간 판정이 있어야 한다`);
    assert.ok(result.bounds.min < result.mine && result.mine < result.bounds.max, `${name}: 가정값은 구간 안이다`);
  }
  // 어디가 70% 학생의 영역별 성적표가 들어오면서 사회복지학부는 L2(반영비율 지수)로 올라갔다.
  // 컷은 그 학생을 숭실대 인문 비율(국35 수20 영20 탐25)로 매긴 지수 82.17(내 눈금 상당),
  // 내 지수는 83.5라 차이 −4.0 → 위험이다. 평균 백분위만 보던 −3.9와 값은 비슷해도 근거가 다르다.
  const welfare = soongsil.departments.find((row) => row.name === '사회복지학부');
  const result = engine.evaluateJeongsi(profile, soongsil, welfare, data.rules.soongsil, soongsil.volatility);
  assert.equal(result.level, 'L2');
  assert.equal(result.cut.value, 82.17);
  assert.equal(result.gap, -4);
  assert.equal(result.band.label, '위험');
  // 등급 입력의 구간은 세 점이다 — 하한·중앙·상한이 순서대로 놓인다 (docs/MODEL.md §4).
  assert.ok(result.gapRange.min < result.gap && result.gap < result.gapRange.max,
    `구간 하한·중앙·상한이 단조롭지 않다 (${result.gapRange.min} · ${result.gap} · ${result.gapRange.max})`);
});

test('상태 집계 회귀 — 등급 입력에서 보류·기준 불일치가 남지 않는다', { skip: !existsSync(path.join(ROOT, DATA_FILE)) && 'data.js not generated' }, () => {
  const data = load(DATA_FILE, 'IPSI_DATA');
  const base = { eng: 2, hist: 3, korElective: '화법과작문', mathElective: '미적분', inq1Subject: '물리학I', inq2Subject: '화학I' };
  const cases = [
    ['pct', { kor: 96, math: 93, inq1: 95, inq2: 92 }],
    ['pct', { kor: 78, math: 62, inq1: 80, inq2: 77 }],
    ['grade', { kor: 1, math: 2, inq1: 2, inq2: 2 }],
    ['grade', { kor: 3, math: 4, inq1: 3, inq2: 3 }],
    ['grade', { kor: 5, math: 5, inq1: 5, inq2: 5 }],
    ['std', { kor: 131, math: 128, inq1: 65, inq2: 67 }],
  ];
  for (const [mode, scores] of cases) {
    const profile = engine.normalizeProfile({ mode, ...base, ...scores }, data.scales, data.std);
    const counts = {};
    for (const row of engine.diagnose(profile, data, {})) {
      counts[row.jeongsi.status] = (counts[row.jeongsi.status] || 0) + 1;
    }
    const label = `${mode} ${JSON.stringify(scores)}`;
    assert.equal(counts.hold ?? 0, 0, `${label}: 보류가 남으면 안 된다`);
    assert.equal(counts['basis-mismatch'] ?? 0, 0, `${label}: 기준 불일치가 남으면 안 된다`);
    assert.equal(counts['no-cut'] ?? 0, 0, `${label}: 컷 없음이 남으면 안 된다`);
    assert.equal(counts['no-profile'] ?? 0, 0, `${label}: 성적 미입력이 남으면 안 된다`);
    // 과탐 필수 모집단위는 과탐을 넣었으므로 막히지 않는다.
    assert.equal(counts.blocked ?? 0, 0, `${label}: 과탐 입력이면 불가가 없다`);
    assert.ok(counts.ok > 1900, `${label}: 판정한 곳 ${counts.ok}`);
  }
  // 사탐만 넣으면 과탐 필수 모집단위는 정당하게 '불가'로 남는다.
  const social = engine.normalizeProfile({ mode: 'grade', ...base, inq1Subject: '생활과윤리', inq2Subject: '사회문화', kor: 3, math: 4, inq1: 3, inq2: 3 }, data.scales, data.std);
  const blocked = engine.diagnose(social, data, {}).filter((row) => row.jeongsi.status === 'blocked');
  assert.ok(blocked.length > 0, '과탐 필수 모집단위는 불가로 남는다');
  assert.match(blocked[0].jeongsi.score.blockers[0], /과탐/u);
});

test('반올림 경계값은 표시와 판정이 같은 값에서 나온다', () => {
  const dept = (cut) => ({ name: '경계', track: '인문', jeongsi: { 2026: { cut70: cut, metric: 'pct', def: 'ksi-mean' } } });
  const profile = engine.normalizeProfile({ mode: 'pct', kor: 90, math: 90, eng: 1, inq1Subject: '사회문화', inq1: 90, inq2Subject: '생활과윤리', inq2: 90 });
  // 90 − 89.3 = 0.7 → 적정(경계 포함). 90 − 89.35 = 0.65 → 반올림 0.7 → 적정.
  assert.equal(engine.evaluateJeongsi(profile, UNIVERSITY, dept(89.3), RULE).gap, 0.7);
  assert.equal(engine.evaluateJeongsi(profile, UNIVERSITY, dept(89.3), RULE).band.label, '적정');
  const rounded = engine.evaluateJeongsi(profile, UNIVERSITY, dept(89.35), RULE);
  assert.equal(rounded.gap, 0.7);
  assert.equal(rounded.band.label, '적정', '화면에 +0.7이라 적고 소신이라 부르지 않는다');
  const below = engine.evaluateJeongsi(profile, UNIVERSITY, dept(89.36), RULE);
  assert.equal(below.gap, 0.6);
  assert.equal(below.band.label, '소신');
});
