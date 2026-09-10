// 이상치 탐지·분류(scripts/anomalies.mjs)의 순수 함수 검사. 실제 데이터가 아니라 합성 입력을 쓴다 —
// 규칙이 무엇을 잡고 무엇을 놓치는지가 소스 값이 바뀌어도 흔들리지 않아야 한다.
import assert from 'node:assert';
import test from 'node:test';
import { classifyAnomaly, detect, isCandidate, mad, median, threshold } from '../scripts/anomalies.mjs';

const row = (over = {}) => ({
  id: 'test', name: '가나학과', track: '자연', practical: false,
  value: 80, rate: 5.2, fillRate: 30, sourceGrade: 'A', series: [],
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

test('후보는 중앙값보다 문턱 이상 낮은 값뿐이다 — 높은 값은 잡지 않는다', () => {
  assert.equal(isCandidate(76, 80, 1), true);
  assert.equal(isCandidate(77, 80, 1), false, '차 3.0 은 문턱과 같아 후보가 아니다');
  assert.equal(isCandidate(75, 80, 2), false, '차 5.0 은 문턱 5.0 과 같아 후보가 아니다');
  assert.equal(isCandidate(74.9, 80, 2), true);
  assert.equal(isCandidate(95, 80, 1), false, '중앙값보다 높은 값은 후보가 아니다');
  assert.equal(isCandidate(null, 80, 1), false);
});

test('분류 — 실기 예체능이 가장 먼저다', () => {
  assert.equal(classifyAnomaly(row({ track: '예체능', practical: true, sourceGrade: 'D' })), 'practical');
});

test('분류 — 근거가 없으면 오류 의심', () => {
  // 사설 추정값.
  assert.equal(classifyAnomaly(row({ sourceGrade: 'E' })), 'error');
  // 이전 연도도 경쟁률도 없다.
  assert.equal(classifyAnomaly(row({ sourceGrade: 'A', rate: null, series: [] })), 'error');
  // 집계 사이트가 정수로 옮긴 값이 그 해 하나뿐이다.
  assert.equal(classifyAnomaly(row({ sourceGrade: 'D', series: [] })), 'error');
  // 같은 D 라도 이전 연도가 있으면 오류로 보지 않는다.
  assert.notEqual(classifyAnomaly(row({ sourceGrade: 'D', series: [{ year: '2025', value: 84 }] })), 'error');
});

test('분류 — 그 해만 크게 낮고 경쟁률이 정상이면 펑크 의심', () => {
  const punk = row({ value: 80, series: [{ year: '2024', value: 85 }, { year: '2025', value: 84 }] });
  assert.equal(classifyAnomaly(punk), 'punk');
  // 경쟁률이 없으면 '그 해 지원자가 적었다'고 말할 수 없다.
  assert.equal(classifyAnomaly({ ...punk, rate: null }), 'normal');
});

test('분류 — 이전 연도부터 계속 낮았으면 정상', () => {
  assert.equal(classifyAnomaly(row({ value: 80, series: [{ year: '2025', value: 80.5 }] })), 'normal');
  // 2026 자신의 값이 series 에 들어 있어도 이전 연도로 세지 않는다 — 집계 사이트 값이면 오류 의심이다.
  assert.equal(classifyAnomaly(row({ sourceGrade: 'D', value: 80, series: [{ year: '2026', value: 80 }] })), 'error');
});

test('묶음 탐지 — 대학×계열 안에서만 견주고, 셋 미만 묶음은 건너뛴다', () => {
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
});

test('묶음 탐지 — 차가 큰 순으로 정렬한다', () => {
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
