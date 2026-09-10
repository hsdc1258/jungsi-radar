// 이상치 탐지·분류(scripts/anomalies.mjs)의 순수 함수 검사. 실제 데이터가 아니라 합성 입력을 쓴다 —
// 규칙이 무엇을 잡고 무엇을 놓치는지가 소스 값이 바뀌어도 흔들리지 않아야 한다.
// 규칙 정본은 docs/MODEL.md §6이다.
import assert from 'node:assert';
import test from 'node:test';
import {
  classifyAnomaly, detect, errorReasons, isCandidate, isError, isPriorCandidate, isPunk,
  mad, median, priorStats, punkReasons, sameConditions, threshold,
} from '../scripts/anomalies.mjs';

const row = (over = {}) => ({
  id: 'test', name: '가나학과', track: '자연', practical: false,
  value: 80, cut50: null, cut100: null,
  score70: null, score50: null, total: null,
  group: '가', quota: 20, rate: 5, fill: 3,
  prior: null, series: [],
  ...over,
});
// 펑크 신호(경쟁률 하락)를 갖춘 전년 행.
const priorRow = (over = {}) => ({ year: '2025', group: '가', quota: 20, rate: 7, value: null, score70: null, ...over });

test('중앙값과 MAD', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  // 200 하나가 크게 튀어도 MAD 는 1 그대로다(표준편차와 다른 점).
  assert.equal(mad([80, 81, 82, 79, 78]), 1);
  assert.equal(mad([80, 81, 82, 79, 200]), 1);
});

test('문턱은 절대 하한 3과 2.5 × MAD 중 큰 쪽이다', () => {
  assert.equal(threshold(0), 3);
  assert.equal(threshold(1), 3);
  assert.equal(threshold(2), 5);
  assert.equal(threshold(null), 3);
});

test('계열 후보는 중앙값보다 문턱 이상 낮은 값뿐이다 — 높은 값은 잡지 않는다', () => {
  assert.equal(isCandidate(76, 80, 1), true);
  assert.equal(isCandidate(77, 80, 1), false, '차 3.0 은 문턱과 같아 후보가 아니다');
  assert.equal(isCandidate(75, 80, 2), false, '차 5.0 은 문턱 5.0 과 같아 후보가 아니다');
  assert.equal(isCandidate(74.9, 80, 2), true);
  assert.equal(isCandidate(95, 80, 1), false, '중앙값보다 높은 값은 후보가 아니다');
  assert.equal(isCandidate(null, 80, 1), false);
});

test('이력 후보는 양쪽을 본다 — 이력이 없으면 후보가 아니다', () => {
  const stats = priorStats(row({ series: [{ year: '2024', value: 85 }, { year: '2025', value: 85 }] }));
  assert.equal(stats.center, 85);
  assert.equal(stats.spread, 0);
  assert.equal(stats.count, 2);
  assert.equal(isPriorCandidate(81, stats), true, '이력보다 4점 낮다');
  assert.equal(isPriorCandidate(89, stats), true, '이력보다 4점 높다');
  assert.equal(isPriorCandidate(82, stats), false, '차 3.0 은 문턱과 같다');
  assert.equal(isPriorCandidate(50, null), false, '이력이 없으면 견줄 것이 없다');
  // 2026 자신의 값은 이력으로 세지 않는다.
  assert.equal(priorStats(row({ series: [{ year: '2026', value: 80 }] })), null);
});

test('평균백분위 50% < 70% 는 오류가 아니다 — 환산 50% < 70% 만 오류다 (§6)', () => {
  // 미래융합전공(C)처럼 국어 배점이 큰 모집단위는 국어가 강한 학생이 평균은 낮아도 위에 선다.
  const futureFusion = row({ name: '미래융합대학(C)', value: 78, cut50: 68 });
  assert.deepEqual(errorReasons(futureFusion), []);
  assert.equal(classifyAnomaly(futureFusion), 'undetermined');
  // 환산점수는 순서가 정해져 있다 — 50% 지점이 70% 지점보다 낮을 수 없다.
  assert.deepEqual(errorReasons(row({ score70: 659, score50: 655 })), ['환산 50% < 70%']);
  assert.equal(classifyAnomaly(row({ score70: 659, score50: 655 })), 'error');
  // 총점 초과와 백분위 범위 밖.
  assert.deepEqual(errorReasons(row({ score70: 1200, total: 1000 })), ['70% 환산점수가 총점 초과']);
  assert.deepEqual(errorReasons(row({ value: 101 })), ['70%컷 백분위 범위 밖']);
  assert.deepEqual(errorReasons(row({ value: -1 })), ['70%컷 백분위 범위 밖']);
  // 값이 아예 없는 것은 오류가 아니다(환산점수로만 공개된 행이 있다).
  assert.equal(isError(row({ value: null })), false);
});

test('펑크는 하락 하나로 부르지 않는다 — 경쟁률 하락이나 충원 ≥ 모집인원이 함께 있어야 한다', () => {
  const dropped = { value: 80, series: [{ year: '2024', value: 85 }, { year: '2025', value: 84 }] };
  // 하락은 있는데 경쟁률이 오르고 충원도 모자라면 판단 불가다.
  assert.equal(classifyAnomaly(row({ ...dropped, rate: 9, fill: 3, prior: priorRow({ rate: 7 }) })), 'undetermined');
  // 경쟁률이 떨어졌으면 펑크 의심.
  const punk = row({ ...dropped, rate: 4, fill: 3, prior: priorRow({ rate: 7 }) });
  assert.deepEqual(punkReasons(punk), ['전년 대비 하락', '경쟁률 하락']);
  assert.equal(classifyAnomaly(punk), 'punk');
  // 충원이 모집인원 이상이어도 펑크 의심.
  const filled = row({ ...dropped, rate: 9, quota: 20, fill: 24, prior: priorRow({ rate: 7 }) });
  assert.deepEqual(punkReasons(filled), ['전년 대비 하락', '충원 ≥ 모집인원']);
  // 환산점수 하락으로도 잡는다(총점의 0.5%, 최소 1점).
  const byScore = row({
    value: null, score70: 640, total: 1000, rate: 4,
    prior: priorRow({ score70: 659, rate: 7 }),
  });
  assert.equal(isPunk(byScore), true);
});

test('선발 조건이 바뀌면 연속 비교를 끊는다 (§5)', () => {
  const base = { value: 80, series: [{ year: '2025', value: 90 }], rate: 4 };
  assert.equal(sameConditions(row({ ...base, group: '나', prior: priorRow({ group: '가' }) })), false);
  assert.equal(sameConditions(row({ ...base, quota: 40, prior: priorRow({ quota: 20 }) })), false);
  assert.equal(sameConditions(row({ ...base, quota: 22, prior: priorRow({ quota: 20 }) })), true);
  // 조건이 달라졌으면 하락이 있어도 펑크로 부르지 않는다.
  assert.equal(classifyAnomaly(row({ ...base, group: '나', prior: priorRow({ group: '가', rate: 7 }) })), 'undetermined');
});

test('분류 — 실기 예체능은 오류·펑크가 아닐 때만 실기로 남는다', () => {
  assert.equal(classifyAnomaly(row({ track: '예체능', practical: true, value: 40 })), 'practical');
  // 이력이 크게 낮고 신호가 있으면 실기 여부와 무관하게 펑크다.
  assert.equal(classifyAnomaly(row({
    track: '예체능', practical: true, value: 40, rate: 3,
    series: [{ year: '2025', value: 60 }], prior: priorRow({ rate: 6 }),
  })), 'punk');
});

test('분류 — 근거가 없으면 판단 불가다(뱃지 없음). unverified·normal 은 없앴다', () => {
  assert.equal(classifyAnomaly(row({ value: 52, series: [] })), 'undetermined');
  assert.equal(classifyAnomaly(row({ value: 90, series: [{ year: '2025', value: 80 }] })), 'undetermined');
  assert.equal(classifyAnomaly(row({ value: 80, series: [{ year: '2025', value: 80.5 }] })), 'undetermined');
});

test('묶음 탐지 — 대학×계열 안에서만 견주고, 셋 미만 묶음은 계열 기준을 쓰지 않는다', () => {
  const rows = [
    // 자연 묶음 여섯: 하나만 크게 낮고, 경쟁률도 떨어졌다.
    row({ id: 'a', name: '가', value: 80 }),
    row({ id: 'a', name: '나', value: 81 }),
    row({ id: 'a', name: '다', value: 82 }),
    row({ id: 'a', name: '라', value: 79 }),
    row({ id: 'a', name: '마', value: 78 }),
    row({ id: 'a', name: '바', value: 60, rate: 3, series: [{ year: '2025', value: 79 }], prior: priorRow({ rate: 6 }) }),
    // 다른 대학의 같은 값은 서로의 기준이 되지 않는다.
    row({ id: 'b', name: '가', value: 60 }),
    row({ id: 'b', name: '나', value: 61 }),
    // 둘뿐인 묶음은 서로를 이상치로 만들지 않는다.
    row({ id: 'c', track: '인문', name: '가', value: 90 }),
    row({ id: 'c', track: '인문', name: '나', value: 40 }),
  ];
  const items = detect(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'a');
  assert.equal(items[0].name, '바');
  assert.equal(items[0].kind, 'punk');
  assert.equal(items[0].median, 79.5);
  assert.equal(items[0].gap, 19.5);
  assert.equal(items[0].priorMedian, 79);
  assert.equal(items[0].priorGap, 19);
  assert.equal(items[0].basis, 'both');
  assert.deepEqual(items[0].reasons, ['전년 대비 하락', '경쟁률 하락']);
});

test('묶음 탐지 — 오류는 후보가 아니어도 반드시 실린다', () => {
  const rows = [
    row({ id: 'a', name: '가', value: 80, score70: 659, score50: 655 }),
    row({ id: 'a', name: '나', value: 81 }),
    row({ id: 'a', name: '다', value: 82 }),
  ];
  const items = detect(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '가');
  assert.equal(items[0].kind, 'error');
  assert.equal(items[0].basis, 'value');
  // 오류는 정렬에서 언제나 맨 위다.
  assert.equal(detect([...rows, row({ id: 'a', name: '라', value: 20 })])[0].kind, 'error');
});

test('묶음 탐지 — 근거 없는 단일 저값은 판단 불가로 실린다', () => {
  const rows = [
    row({ id: 'a', name: '가', value: 80 }),
    row({ id: 'a', name: '나', value: 81 }),
    row({ id: 'a', name: '다', value: 82 }),
    row({ id: 'a', name: '축산', value: 52 }),
  ];
  const items = detect(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '축산');
  assert.equal(items[0].kind, 'undetermined');
  assert.equal(items[0].priorMedian, null);
  assert.equal(items[0].priorCount, 0);
  assert.equal(items[0].basis, 'group');
  assert.deepEqual(items[0].reasons, []);
});

test('묶음 탐지 — 벌어진 폭이 큰 순으로 정렬한다', () => {
  const rows = [
    row({ id: 'a', name: '가', value: 90 }),
    row({ id: 'a', name: '나', value: 91 }),
    row({ id: 'a', name: '다', value: 89 }),
    row({ id: 'a', name: '라', value: 70 }),
    row({ id: 'a', name: '마', value: 50 }),
  ];
  const items = detect(rows);
  assert.deepEqual(items.map((item) => item.name), ['마', '라']);
});
