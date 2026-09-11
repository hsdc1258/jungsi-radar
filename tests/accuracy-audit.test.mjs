// 정확도 전수검사 (docs/MODEL.md §9 · scripts/accuracy-audit.mjs) 계약 테스트.
//   1) 어디가 70% 지점 학생 성적표는 **탐구 종류만** 있다 — 그 성적표가 사용자 입력으로 들어가
//      자기 모집단위에서 '소신'이 나와야 한다(합성 픽스처: 국민대 자유전공(A), MODEL §0 원문).
//   2) 보고서는 결정론이다 — 두 번 만들면 글자 하나까지 같다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {
  SELF_BAND, buildAudit, cutYearOf, l1MissCause, profileInput, renderMarkdown, selfPlacement, selfRangeOk,
} from '../scripts/accuracy-audit.mjs';

const ROOT = process.cwd();
const load = (file, name) => {
  const context = { globalThis: null, window: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context[name];
};
const engine = load('assets/engine.js', 'IPSI_ENGINE');
const readJson = (file) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
const STD = readJson('source/std-2026.json');
const CONV = readJson('source/conv-2026.json');
const RULES = readJson('source/rules-2026.base.json');

// MODEL §0 — 어디가 2026 국민대 자유전공(A) 행의 두 지점 학생. 탐구는 **종류만** 공시된다.
const STUDENT_70 = { kor: 97, math: 69, inq1: { kind: '사탐', pct: 86 }, inq2: { kind: '사탐', pct: 52 }, avg: 78, eng: 2, hist: 1 };
const STUDENT_50 = { kor: 98, math: 76, inq1: { kind: '과탐', pct: 77 }, inq2: { kind: '사탐', pct: 62 }, avg: 81, eng: 3, hist: 2 };

const KOOKMIN = { id: 'kookmin', short: '국민대', name: '국민대학교', volatility: 1 };
const ctxOf = () => ({ std: STD, conv: CONV, universityId: 'kookmin' });
const track = engine.pickModelTrack(RULES, 'kookmin', { name: '자유전공학부(A)', track: '자유전공' });
const scoreOf = (student) => engine.formulaScore2(
  track, engine.studentFormulaInputs(engine.normalizeCutStudent(student), STD), ctxOf(),
).value;

// 합성 픽스처. 컷 환산점수는 그 트랙으로 채점한 그 지점 학생의 값이다 — 같은 눈금에서 뺀다.
const DEPT = {
  name: '자유전공학부(A)',
  track: '자유전공',
  ruleTrack: null,
  jeongsi: {
    2026: {
      metric: 'pct', cut70: 78, cut50: 81, group: '가', quota: 20, rate: 5.1, fill: 4,
      typeName: '수능(일반)', source: '어디가 2026 입시결과', url: 'https://www.adiga.kr/',
      aggregation: 'adiga-score-rank',
      score: { p70: scoreOf(STUDENT_70), p50: scoreOf(STUDENT_50), total: 1000 },
      student: { p70: STUDENT_70, p50: STUDENT_50 },
    },
  },
  series: [{ year: '2026', value: 78, def: 'ksi-mean', kind: '70%컷', basis: 'adiga' }],
};
const DATA = {
  generatedAt: '2026-01-01',
  volatility: 1,
  universities: [{ ...KOOKMIN, departments: [DEPT] }],
  rules: {},
  rules2026: RULES,
  formulaCheck: { tracks: { 'kookmin::자유전공(A)': { status: 'verified' } } },
  scales: null,
  std: STD,
  conv: CONV,
};

test('성적표 → 사용자 입력: 탐구는 과목 없이 종류로 들어간다', () => {
  const student = engine.normalizeCutStudent(STUDENT_70);
  const input = profileInput(student, '2026');
  assert.equal(input.mode, 'pct');
  assert.equal(input.kor, '97');
  assert.equal(input.math, '69');
  assert.equal(input.eng, '2');
  assert.equal(input.hist, '1');
  // 과목명은 공시되지 않는다 — 종류만 넘긴다.
  assert.equal(input.inq1Subject, undefined);
  assert.equal(input.inq1Kind, '사탐');
  assert.equal(input.inq2Kind, '사탐');
  // 선택과목이 미상이라 기본값이고, 그래서 미적분·기하 가산이 붙지 않는다.
  assert.equal(input.mathElective, '확률과통계');

  const profile = engine.normalizeProfile(input, null, STD);
  assert.equal(profile.inquiries.length, 2);
  assert.deepEqual(profile.inquiries.map((row) => row.kind), ['social', 'social']);
  assert.deepEqual(profile.inquiries.map((row) => row.subject), [null, null]);
  assert.deepEqual(profile.inquiries.map((row) => row.pct), [86, 52]);
  // 종류만 아는 탐구도 §1.3 되읽기가 된다 — 그 종류 과목 전체의 표준점수 구간이다.
  const inputs = engine.myFormulaInputs(profile, STD, { sameYear: true });
  for (const row of inputs.inq) {
    assert.ok(Number.isFinite(row.stdMin) && Number.isFinite(row.stdMax), JSON.stringify(row));
    assert.ok(row.stdMin <= row.stdMax);
  }
});

test('B 자기 위치: 국민대 자유전공(A)의 70% 학생은 자기 모집단위에서 소신이다', () => {
  assert.equal(cutYearOf(DEPT), '2026');
  const university = DATA.universities[0];
  const seventy = selfPlacement(engine, DATA, university, DEPT, 'p70');
  assert.equal(seventy.reason, null);
  assert.equal(seventy.result.status, 'ok');
  assert.equal(seventy.result.level, 'L1');
  assert.equal(seventy.result.band.label, '소신');
  assert.ok(Math.abs(seventy.result.gap) <= SELF_BAND, `차이 ${seventy.result.gap}`);

  // 50% 지점 학생은 환산점수 순으로 위에 선 학생이다 — 차이가 70% 학생보다 크거나 같아야 한다.
  const fifty = selfPlacement(engine, DATA, university, DEPT, 'p50');
  assert.equal(fifty.result.status, 'ok');
  assert.ok(fifty.result.gap >= seventy.result.gap, `50% ${fifty.result.gap} < 70% ${seventy.result.gap}`);
});

test('B 구간 기준: 되읽기 구간이 공시값을 담고 구간이 소신을 품으면 맞음이다', () => {
  const university = DATA.universities[0];
  const seventy = selfPlacement(engine, DATA, university, DEPT, 'p70');
  // 중앙 기준이 맞는 자리는 구간 기준으로도 맞다 — 구간 기준이 더 느슨한 조건이다.
  assert.ok(selfRangeOk(seventy.result));

  // 공시 환산점수가 재현 구간 밖으로 나가면 구간 기준도 아니다.
  const off = { ...seventy.result, cut: { ...seventy.result.cut, score70: seventy.result.mineDetail.max + 50 } };
  assert.equal(selfRangeOk(off), false);
  assert.match(l1MissCause(off), /^산식 불일치/u);

  // 구간이 공시값을 담아도 하한·상한이 만드는 판정 폭이 소신에서 완전히 비켜나면 아니다.
  const away = { ...seventy.result, gapDetail: { ...seventy.result.gapDetail, min: 2.5, max: 4.5 } };
  assert.equal(selfRangeOk(away), false);
});

test('L1 오답 갈래는 되읽기 폭·기울기 불안정·산식 불일치·자격으로 갈린다', () => {
  const base = selfPlacement(engine, DATA, DATA.universities[0], DEPT, 'p70').result;
  assert.equal(l1MissCause({ ...base, status: 'blocked' }), '자격 미충족(선택과목 미상)');
  const wide = { ...base, mineDetail: { ...base.mineDetail, min: base.mineDetail.score - 1, max: base.mineDetail.score + 9 } };
  assert.match(l1MissCause(wide), /^되읽기 폭/u);
  const weak = { ...base, gapDetail: { ...base.gapDetail, points: -10, gap2026: -25 } };
  assert.match(l1MissCause(weak), /^기울기 불안정/u);
});

test('보고서는 결정론이다 — 두 번 만들면 같은 파일이다', () => {
  const first = renderMarkdown(buildAudit());
  const second = renderMarkdown(buildAudit());
  assert.equal(first, second);
  assert.match(first, /^# 정확도 전수검사/u);
  assert.match(first, /## 한 줄 요약\n\n> 재현 A: \d+\/\d+ /u);
  // 한 줄 요약과 표가 중앙 기준·구간 기준을 나란히 적는다.
  assert.match(first, /자기 위치 B \(중앙 기준·구간 기준\): L1 [\d.]+%·[\d.]+%/u);
  assert.match(first, /\| B 자기 위치 · 중앙 기준 \(모집단위\) \|/u);
  assert.match(first, /\| B 자기 위치 · 구간 기준 \(모집단위\) \|/u);
  assert.match(first, /### 2-4\. L1 오답을 다시 가른다/u);
  // 합격 확률 숫자는 어디에도 만들지 않는다 (§9) — 확률·합격률에 붙은 수치가 없어야 한다.
  assert.doesNotMatch(first, /(합격 ?확률|합격률)[^\n]*\d/u);
});
