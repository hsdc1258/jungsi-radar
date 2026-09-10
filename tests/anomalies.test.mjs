// 이상치 탐지·분류(scripts/anomalies.mjs)의 순수 함수 검사. 실제 데이터가 아니라 합성 입력을 쓴다 —
// 규칙이 무엇을 잡고 무엇을 놓치는지가 소스 값이 바뀌어도 흔들리지 않아야 한다.
import assert from 'node:assert';
import test from 'node:test';
import {
  classifyAnomaly, detect, isCandidate, isImpossible, isPriorCandidate, mad, median, priorStats, threshold,
} from '../scripts/anomalies.mjs';

const row = (over = {}) => ({
  id: 'test', name: '가나학과', track: '자연', practical: false,
  value: 80, cut50: null, series: [],
  ...over,
});

test('중앙값과 MAD', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  // 90 하나가 크게 튀어도 MAD 는 1 그대로다(표준편차와 다른 점).
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

test('값 자체의 자기모순 — 백분위 범위 밖, 70%컷이 50%컷보다 높음', () => {
  assert.equal(isImpossible(row({ value: 80, cut50: 84 })), false);
  assert.equal(isImpossible(row({ value: 80, cut50: 79 })), true);
  assert.equal(isImpossible(row({ value: 101 })), true);
  assert.equal(isImpossible(row({ value: -1 })), true);
  assert.equal(isImpossible(row({ value: null })), true);
});

test('분류 — 이력보다 크게 낮으면 펑크 의심', () => {
  const punk = row({ value: 80, series: [{ year: '2024', value: 85 }, { year: '2025', value: 84 }] });
  assert.equal(classifyAnomaly(punk), 'punk');
  // 이력이 하나뿐이어도 3점 하한을 넘으면 펑크로 본다.
  assert.equal(classifyAnomaly(row({ value: 80, series: [{ year: '2025', value: 84 }] })), 'punk');
});

test('분류 — 이력보다 크게 높거나 값이 자기모순이면 오류 의심', () => {
  assert.equal(classifyAnomaly(row({ value: 90, series: [{ year: '2025', value: 80 }] })), 'error');
  // 자기모순은 이력이 없어도, 이력이 맞아떨어져도 오류다.
  assert.equal(classifyAnomaly(row({ value: 80, cut50: 76 })), 'error');
  assert.equal(classifyAnomaly(row({ value: 80, cut50: 76, series: [{ year: '2025', value: 80 }] })), 'error');
});

test('분류 — 이력이 없는 단일 저값은 오류가 아니라 미확인이다', () => {
  // 원래 컷이 낮은 모집단위(축산·농학·야간·간호)가 계열 중앙값에서 멀 뿐이다. 근거가 없으므로
  // 오류라고 부르지 않는다 — 뱃지도 붙지 않는다.
  assert.equal(classifyAnomaly(row({ value: 52, series: [] })), 'unverified');
  // 출처 등급이 무엇이든(사설 추정이든 집계 정수값이든) 이력이 없으면 판정하지 않는다.
  assert.equal(classifyAnomaly(row({ value: 52, sourceGrade: 'E', series: [] })), 'unverified');
  assert.equal(classifyAnomaly(row({ value: 52, sourceGrade: 'D', rate: null, series: [] })), 'unverified');
});

test('분류 — 실기 예체능은 이력이 설명해 주지 못할 때만 실기로 남는다', () => {
  assert.equal(classifyAnomaly(row({ track: '예체능', practical: true, value: 40 })), 'practical');
  // 이력이 있고 그 이력보다 크게 낮으면 실기 여부와 무관하게 펑크다.
  assert.equal(classifyAnomaly(row({
    track: '예체능', practical: true, value: 40, series: [{ year: '2025', value: 60 }],
  })), 'punk');
});

test('분류 — 이력이 있고 그 이력대로면 정상', () => {
  assert.equal(classifyAnomaly(row({ value: 80, series: [{ year: '2025', value: 80.5 }] })), 'normal');
  assert.equal(classifyAnomaly(row({ value: 52, series: [{ year: '2024', value: 53 }, { year: '2025', value: 52 }] })), 'normal');
});

test('묶음 탐지 — 대학×계열 안에서만 견주고, 셋 미만 묶음은 계열 기준을 쓰지 않는다', () => {
  const rows = [
    // 자연 묶음 여섯: 하나만 크게 낮다.
    row({ id: 'a', name: '가', value: 80 }),
    row({ id: 'a', name: '나', value: 81 }),
    row({ id: 'a', name: '다', value: 82 }),
    row({ id: 'a', name: '라', value: 79 }),
    row({ id: 'a', name: '마', value: 78 }),
    row({ id: 'a', name: '바', value: 60, series: [{ year: '2025', value: 79 }] }),
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
});

test('묶음 탐지 — 계열에 걸리지 않아도 자기 이력에서 벗어나면 후보다', () => {
  const rows = [
    // 셋 미만 묶음이라 계열 기준이 없다. 그래도 이력이 있으면 판정한다.
    row({ id: 'a', name: '가', value: 90, series: [{ year: '2025', value: 80 }] }),
    row({ id: 'a', name: '나', value: 89 }),
  ];
  const items = detect(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '가');
  assert.equal(items[0].kind, 'error');
  assert.equal(items[0].median, null, '셋 미만 묶음은 계열 중앙값을 내지 않는다');
  assert.equal(items[0].gap, null);
  assert.equal(items[0].priorGap, -10);
  assert.equal(items[0].basis, 'prior');
});

test('묶음 탐지 — 이력 없는 단일 저값은 미확인으로 실린다', () => {
  const rows = [
    row({ id: 'a', name: '가', value: 80 }),
    row({ id: 'a', name: '나', value: 81 }),
    row({ id: 'a', name: '다', value: 82 }),
    row({ id: 'a', name: '축산', value: 52 }),
  ];
  const items = detect(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '축산');
  assert.equal(items[0].kind, 'unverified');
  assert.equal(items[0].priorMedian, null);
  assert.equal(items[0].priorCount, 0);
  assert.equal(items[0].basis, 'group');
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
