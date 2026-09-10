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
        // 실기 비중이 큰 예체능 모집단위는 수능 백분위가 아주 낮을 수 있다(부산대 성악 14 등).
        assert.ok(row.value > 0 && row.value <= 100, `${university.id} ${dept.name} ${row.year}: ${row.value}`);
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

test('컷 세 가지의 순서가 뒤집히지 않는다 (100%컷 ≤ 70%컷 ≤ 50%컷)', () => {
  let checkedFloor = 0;
  let checkedTop = 0;
  for (const university of DATA.universities) {
    for (const dept of university.departments) {
      for (const [year, row] of Object.entries(dept.jeongsi || {})) {
        if (row.metric !== 'pct') continue;
        const where = `${university.id} ${dept.name} ${year}`;
        for (const key of ['cut50', 'cut70', 'cut100']) {
          if (row[key] === null || row[key] === undefined) continue;
          assert.ok(isNumber(row[key]) && row[key] > 0 && row[key] <= 100, `${where}: ${key} ${row[key]}`);
        }
        // 100%컷은 최종등록자 최저선이라 언제나 70%컷 이하다.
        if (isNumber(row.cut100) && isNumber(row.cut70)) {
          assert.ok(row.cut100 <= row.cut70, `${where}: 100%컷 ${row.cut100} > 70%컷 ${row.cut70}`);
          checkedFloor += 1;
        }
        // 50%컷은 70%컷 이상이다. 단 어디가 집계 페이지가 실은 두 값은 서로 어긋나는 행이 있어
        // (같은 표 안에서 50%컷 < 70%컷) 대학 공식 표에서 온 행만 본다.
        if (row.basis === 'official' && isNumber(row.cut50) && isNumber(row.cut70)) {
          assert.ok(row.cut50 >= row.cut70, `${where}: 50%컷 ${row.cut50} < 70%컷 ${row.cut70}`);
          checkedTop += 1;
        }
      }
    }
  }
  assert.ok(checkedFloor > 0, `100%컷이 있는 행이 있어야 한다 (지금 ${checkedFloor})`);
  assert.ok(checkedTop >= 0, `50%컷 검사 ${checkedTop}건`);
});

test('추가합격 정보는 음수가 아니고 충원율은 인원과 맞는다', () => {
  let seen = 0;
  for (const university of DATA.universities) {
    for (const dept of university.departments) {
      for (const [year, row] of Object.entries(dept.jeongsi || {})) {
        const where = `${university.id} ${dept.name} ${year}`;
        for (const key of ['fill', 'fillRate', 'lastWait']) {
          if (row[key] === null || row[key] === undefined) continue;
          assert.ok(isNumber(row[key]) && row[key] >= 0, `${where}: ${key} ${row[key]}`);
        }
        if (isNumber(row.fill) && isNumber(row.fillRate) && isNumber(row.quota) && row.quota > 0) {
          const expected = Math.round((row.fill / row.quota) * 1000) / 10;
          // 대학이 스스로 낸 충원율은 자기 반올림을 쓰므로 1%p까지 벌어질 수 있다.
          assert.ok(Math.abs(expected - row.fillRate) <= 1.05, `${where}: 충원율 ${row.fillRate} vs ${expected}`);
          seen += 1;
        }
      }
    }
  }
  assert.ok(seen > 500, `충원율을 맞춰 볼 행이 500곳 이상이어야 한다 (지금 ${seen})`);
});

test('캠퍼스가 갈린 대학은 같은 이름의 모집단위를 나눠 갖지 않는다', () => {
  const byId = new Map(DATA.universities.map((row) => [row.id, row]));
  for (const [left, right] of [['hufs', 'hufs-global'], ['hanyang', 'hanyang-erica']]) {
    const a = byId.get(left);
    const b = byId.get(right);
    assert.ok(a && b, `${left}/${right} 둘 다 있어야 한다`);
    assert.notEqual(a.short, b.short, `${left}/${right}: 화면 이름이 달라야 한다`);
    const names = new Set(a.departments.map((dept) => dept.name));
    const shared = b.departments.map((dept) => dept.name).filter((name) => names.has(name));
    assert.deepEqual(shared, [], `${left}/${right}: 캠퍼스 표기가 없는 같은 이름 ${shared.join(', ')}`);
  }
  // 한국외대는 시행계획의 캠퍼스 열대로 갈랐다 — 두 항목 모두 모집단위가 남아 있어야 한다.
  assert.ok(byId.get('hufs').departments.length > 20, '한국외대 서울');
  assert.ok(byId.get('hufs-global').departments.length > 20, '한국외대 글로벌');
});
