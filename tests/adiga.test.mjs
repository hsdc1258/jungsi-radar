// 어디가 표를 읽는 규칙(열 배치·검산)의 단위 테스트.
// 표본은 2026학년도 국민대학교 팝업에서 그대로 받은 셀 배열이다 — 어디가가 열을 하나 밀면
// 이 테스트가 먼저 깨진다. 값은 docs/MODEL.md §0 의 검산 표와 같다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COL, COLUMNS, checkConsistent, num, parseNotes, parseRows, readStudent, toRow, totalOf,
} from '../scripts/source-parsers/adiga-table.mjs';
import { normalizeDept } from '../scripts/source-parsers/dept-name.mjs';

const ROOT = process.cwd();
// 국민대 자유전공(A) 2026 · 정시(가). 앞 9칸 + 학생부 11칸 + 수능 환산 6칸 + 컷 5묶음 × 11칸 = 81칸.
const KOOKMIN_FREE_A = [
  '정시(가)', '수능위주', '수능(일반학생전형)', '자유전공(A)', '120', '0', '120', '5.75', '121',
  ...Array(11).fill('-'),
  '660.5', '659', '-', '-', '-', '1000',
  '98', '76', '62', '-', '-', '-', '77', '-', '81', '2', '3',
  '97', '69', '86', '-', '-', '52', '-', '-', '78', '1', '2',
  ...Array(33).fill('-'),
];

test('표본 행은 81칸이고 열 상수가 가리키는 자리가 맞다', () => {
  assert.equal(KOOKMIN_FREE_A.length, COLUMNS);
  assert.equal(KOOKMIN_FREE_A[COL.dept], '자유전공(A)');
  assert.equal(KOOKMIN_FREE_A[COL.score.p50], '660.5');
  assert.equal(KOOKMIN_FREE_A[COL.score.p70], '659');
  assert.equal(KOOKMIN_FREE_A[COL.score.total], '1000');
  assert.equal(COL.studentStart + (5 * COL.studentStride), COLUMNS);
});

test('국민대 자유전공(A) 2026 행을 MODEL §1.1 모양으로 읽는다', () => {
  const row = toRow(KOOKMIN_FREE_A, {
    id: 'kookmin', year: 2026, unvCd: '0000078', adigaName: '국민대학교[본교]', fetchedOn: '2026-09-11',
  });
  assert.equal(row.university, 'kookmin');
  assert.equal(row.period, '정시(가)');
  assert.equal(row.dept, '자유전공(A)');
  assert.deepEqual(row.quota, { initial: 120, carried: 0, final: 120 });
  assert.equal(row.rate, 5.75);
  assert.equal(row.fill, 121);
  assert.deepEqual(row.score, { p50: 660.5, p70: 659, p80: null, p90: null, p100: null, total: 1000 });
  // 70% 지점 학생 한 명의 성적표 (MODEL §0 검산 표)
  assert.deepEqual(row.student.p70, {
    kor: 97, math: 69, inq1: { kind: '사탐', pct: 86 }, inq2: { kind: '사탐', pct: 52 },
    avg: 78, hist: 1, eng: 2,
  });
  // 50% 지점 학생은 평균이 3점 높은데 환산점수는 1.5점 차이다 — 평균으로는 둘을 가를 수 없다.
  assert.deepEqual(row.student.p50, {
    kor: 98, math: 76, inq1: { kind: '사탐', pct: 62 }, inq2: { kind: '과탐', pct: 77 },
    avg: 81, hist: 2, eng: 3,
  });
  assert.equal(row.student.p80, null);
  assert.equal(row.aggregation, 'adiga-score-rank');
  assert.equal(row.sourceGrade, 'A');
  assert.equal(row.consistent, true);
  assert.deepEqual(row.raw, KOOKMIN_FREE_A);
});

test('평균백분위 검산은 국·수·탐 평균과 ±0.6 안에서만 통과한다', () => {
  const student = { kor: 97, math: 69, inq1: { kind: '사탐', pct: 86 }, inq2: { kind: '사탐', pct: 52 }, avg: 78, hist: 1, eng: 2 };
  assert.equal(checkConsistent(student), true);           // (97+69+69)/3 = 78.33
  assert.equal(checkConsistent({ ...student, avg: 84 }), false);
  assert.equal(checkConsistent({ ...student, avg: null }), null);
  // 탐구가 한 과목뿐이면 그 값 하나를 탐구 평균으로 쓴다.
  assert.equal(checkConsistent({ kor: 90, math: 90, inq1: { kind: '과탐', pct: 90 }, inq2: null, avg: 90, hist: 1, eng: 1 }), true);
});

test('빈 칸과 미제출 행을 값으로 지어내지 않는다', () => {
  assert.equal(num('-'), null);
  assert.equal(num(''), null);
  assert.equal(num('0'), 0);
  assert.equal(num('1,234'), 1234);
  const undisclosed = ['정시(가)', '수능위주', '수능(일반학생전형)', '임산생명공학과', '2', '0', '2', '0', '-', '미제출 사유 : 3명이하 모집단위 미제출'];
  const row = toRow(undisclosed, { id: 'kookmin', year: 2026, unvCd: '0000078', adigaName: '국민대학교[본교]', fetchedOn: '2026-09-11' });
  assert.equal(row.disclosed, false);
  assert.equal(row.score.p70, null);
  assert.equal(row.student.p70, null);
  assert.equal(row.consistent, null);
  assert.match(row.note, /미제출/u);
  assert.equal(row.quota.final, 2);
});

test('탐구 종류는 사탐·과탐·직탐 세 칸 중 값이 있는 칸이 정한다', () => {
  const base = Array(COLUMNS).fill('-');
  const at = COL.studentStart;
  base[at + 4] = '77';   // 탐구1 직탐
  base[at + 6] = '55';   // 탐구2 과탐
  const student = readStudent(base, at);
  assert.deepEqual(student.inq1, { kind: '직탐', pct: 77 });
  assert.deepEqual(student.inq2, { kind: '과탐', pct: 55 });
});

test('표 조각에서 총 건수와 행을 읽는다', () => {
  const html = '<p class="total">총 <strong class="prm01">78</strong>건</p>'
    + '<table><thead><tr><th>버림</th></tr></thead><tbody>'
    + '<tr><td>정시(가)</td><td>수능위주</td></tr>'
    + '<tr><td>정시(나)</td><td>&nbsp;-&nbsp;</td></tr>'
    + '</tbody></table>';
  assert.equal(totalOf(html), 78);
  assert.deepEqual(parseRows(html), [['정시(가)', '수능위주'], ['정시(나)', '-']]);
});

test('모집단위 이름 정규화는 눈에 안 보이는 차이만 지운다', () => {
  assert.equal(normalizeDept(' 자유전공 (A) '), normalizeDept('자유전공(A)'));
  assert.equal(normalizeDept('영미문학·문화학과'), normalizeDept('영미문학.문화학과'));
  assert.equal(normalizeDept('ＡＩ데이터융합학부'), normalizeDept('AI데이터융합학부'));
  assert.equal(normalizeDept('사회과학대학[통합모집]'), normalizeDept('사회과학대학(통합모집)'));
  // 괄호 안 글자는 절대 버리지 않는다 — 버리면 (A)와 (B)가 같은 모집단위가 된다.
  assert.notEqual(normalizeDept('자유전공(A)'), normalizeDept('자유전공(B)'));
});

test('어디가 각주를 원문 그대로 저장해 두었다', () => {
  const file = path.join(ROOT, 'source/adiga/notes.json');
  const notes = JSON.parse(readFileSync(file, 'utf8'));
  const joined = notes.lines.join('\n');
  assert.match(joined, /50% cut : 최종등록자 중 수능 환산점수 순으로 상위 50%에 해당하는 점수/u);
  assert.match(joined, /70% cut : 최종등록자 중 수능 환산점수 순으로 상위 70%에 해당하는 점수/u);
  assert.match(joined, /최종등록자 중 상위 50%, 70%에 해당하는 학생의 성적 산출에 반영된 수능 영역의 백분위/u);
  assert.match(joined, /영어, 한국사 영역의 경우 등급/u);
  assert.match(joined, /50%, 70% cut은 대학별 필수공개, 80%, 90%, 100% cut은 대학별 선택공개/u);
  assert.match(joined, /선발인원 3명 이하/u);
});

test('각주 파서는 학생부와 수능 정의를 섞지 않는다', () => {
  const html = '<div class="tableWrap termInfo">'
    + '<td><dl><dt>2. 환산점수</dt><dd>: 학생부 쪽 설명</dd></dl></td>'
    + '<td class="noRytLine"><dl><dt>2. 환산점수</dt><dd>: 수능 쪽 설명</dd></dl></td>'
    + '<p class="notice">※ 공통 안내다</p>'
    + '</div><form id="admssFrm">';
  const notes = parseNotes(html);
  assert.deepEqual(notes.sections.학생부, [{ term: '2. 환산점수', lines: [': 학생부 쪽 설명'] }]);
  assert.deepEqual(notes.sections.수능, [{ term: '2. 환산점수', lines: [': 수능 쪽 설명'] }]);
  assert.deepEqual(notes.sections.공통, ['※ 공통 안내다']);
});
