// 생성 데이터(assets/data.js)의 불변식. 소스를 고치고 `npm run build` 를 돌린 뒤 여기서 검사한다.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
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
const DATA = load('assets/data.js', 'IPSI_DATA');
const ENGINE = load('assets/engine.js', 'IPSI_ENGINE');
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

test('연도별 series는 백분위 범위 안에 있고 연도가 겹치지 않는다', () => {
  let multi = 0;
  for (const university of DATA.universities) {
    for (const dept of university.departments) {
      const series = dept.series || [];
      const years = series.map((row) => row.year);
      assert.equal(new Set(years).size, years.length, `${university.id} ${dept.name}: 연도 중복`);
      for (const row of series) {
        assert.match(row.year, /^20\d\d$/u);
        assert.ok(row.value > 20 && row.value <= 100, `${university.id} ${dept.name} ${row.year}: ${row.value}`);
        assert.ok(['adiga', 'official', 'derived'].includes(row.basis), `${university.id} ${dept.name}: basis ${row.basis}`);
      }
      if (series.length > 1) multi += 1;
    }
  }
  assert.ok(multi >= 200, `연도별 값이 둘 이상인 모집단위가 200곳 이상이어야 한다 (지금 ${multi})`);
});

test('파생값(derived)은 기준 연도의 어디가 컷에서 대학 공식값의 연도 차이만큼만 움직인다', () => {
  let checked = 0;
  for (const university of DATA.universities) {
    for (const dept of university.departments) {
      for (const row of dept.series || []) {
        if (row.basis !== 'derived') continue;
        const { anchorYear, anchorValue, value } = row.from;
        const anchor = dept.jeongsi[anchorYear];
        assert.ok(anchor && isNumber(anchor.cut70), `${university.id} ${dept.name}: 기준 연도 ${anchorYear} 없음`);
        const expected = Math.round((anchor.cut70 + (value - anchorValue)) * 100) / 100;
        assert.equal(row.value, expected, `${university.id} ${dept.name} ${row.year}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100, `파생값이 100건 이상이어야 한다 (지금 ${checked})`);
});

test('대학 변동폭과 전체 변동폭은 양수이거나 없음이다', () => {
  assert.ok(DATA.volatility > 0 && DATA.volatility < 10, `전체 변동폭 ${DATA.volatility}`);
  for (const university of DATA.universities) {
    const value = university.volatility;
    assert.ok(value === null || (value > 0 && value < 10), `${university.id}: ${value}`);
  }
});

test('기준값은 최근 연도 가중 평균이고 오차는 연도 폭의 절반이다', () => {
  const dept = DATA.universities.flatMap((university) => university.departments)
    .find((row) => (row.series || []).length >= 3);
  assert.ok(dept, '3개년 값을 가진 모집단위가 있어야 한다');
  const reference = ENGINE.jeongsiReference(dept, 1);
  const recent = [...dept.series].sort((left, right) => right.year.localeCompare(left.year)).slice(0, 3);
  const expected = (recent[0].value * 0.6 + recent[1].value * 0.3 + recent[2].value * 0.1) / 1;
  assert.equal(reference.primary.value, Math.round(expected * 100) / 100);
  const values = recent.map((row) => row.value);
  assert.equal(reference.spread, Math.round(((Math.max(...values) - Math.min(...values)) / 2) * 10) / 10);
});

test('한 해뿐인 모집단위는 대학 대표 변동폭을 오차로 쓴다', () => {
  const university = DATA.universities.find((row) => isNumber(row.volatility)
    && row.departments.some((dept) => (dept.series || []).length === 1));
  assert.ok(university, '검사할 대학이 있어야 한다');
  const dept = university.departments.find((row) => (row.series || []).length === 1);
  const reference = ENGINE.jeongsiReference(dept, university.volatility);
  assert.equal(reference.spread, Math.round(university.volatility * 10) / 10);
});

test('2026학년도 수능 등급컷은 실채점 확정값이고 선택과목별로 다르다', () => {
  const exam = DATA.scales.exams['2026'];
  assert.equal(exam.status, 'final');
  const subjects = exam.subjects;
  assert.ok(subjects['국어-화법과작문'].grades[0].raw > subjects['국어-언어와매체'].grades[0].raw);
  assert.ok(subjects['수학-확률과통계'].grades[0].raw > subjects['수학-미적분'].grades[0].raw);
  const inquiry = Object.keys(subjects).filter((key) => key.startsWith('탐구-'));
  assert.ok(inquiry.length >= 17, `탐구 과목이 17개 이상이어야 한다 (지금 ${inquiry.length})`);
  for (const key of inquiry) {
    for (const row of subjects[key].grades) assert.ok(row.raw > 0 && row.raw <= 50, `${key} ${row.grade}등급 ${row.raw}`);
  }
});

test('반영 규칙의 영어·한국사 표는 등급 1~9 밖의 값을 담지 않는다', () => {
  for (const [id, rule] of Object.entries(DATA.rules)) {
    for (const track of rule.tracks || []) {
      for (const which of ['english', 'history']) {
        const rows = track[which]?.table || {};
        for (const grade of Object.keys(rows)) {
          assert.match(grade, /^[1-9]$/u, `${id} ${track.name} ${which}: 등급 ${grade}`);
          assert.ok(isNumber(Number(rows[grade])), `${id} ${track.name} ${which}: ${grade}등급 값`);
        }
      }
    }
  }
});

test('모든 정시 결과 행에 출처 주소가 있다', () => {
  for (const university of DATA.universities) {
    for (const dept of university.departments) {
      for (const [year, row] of Object.entries(dept.jeongsi || {})) {
        assert.match(String(row.url || ''), /^https?:/u, `${university.id} ${dept.name} ${year}`);
      }
      for (const [year, row] of Object.entries(dept.official || {})) {
        assert.match(String(row.url || ''), /^https?:/u, `${university.id} ${dept.name} official ${year}`);
        assert.ok(row.kind, `${university.id} ${dept.name} official ${year}: kind 없음`);
      }
    }
  }
});
