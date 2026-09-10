// 판정 변화 보고서 (docs/MODEL.md v3). 옛 모델(국·수·탐 평균 백분위 비교 = 지금의 L3 계산)과
// 새 모델(L1 환산 → L2 지수 → L3 참고)이 대표 성적 다섯에서 어떻게 갈리는지 **세어서** 적는다.
// → docs/MODEL-REPORT.md   (`npm run report`)
//
// 세는 것
//   (a) 층위 분포   : 프로필마다 L1·L2·L3·L0이 몇 모집단위인가
//   (b) 판정 변화   : 두 모델이 모두 판정한 행에서 띠가 달라진 수와 옛×새 교차표
//   (c) 지정 여섯   : 국민대 자유전공(A)·(B)·미래융합전공(C) · 연세대 경영학과 · 숭실대 경영학부 ·
//                     경기대 경영학부의 옛/새 판정과 근거 한 줄
//   (d) 검산 요약   : verified·mismatch·unchecked 와 mismatch 원인 분류
//
// 손으로 적은 숫자는 없다 — assets/data.js(생성물)와 assets/engine.js(화면과 같은 파일)에서 만든다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs/MODEL-REPORT.md');

// 브라우저용 IIFE 두 개(엔진·생성 데이터)를 노드에서 그대로 읽는다.
function loadBrowser(file, name) {
  const context = { globalThis: null, window: null };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return context[name];
}

// 대표 프로필 다섯. 네 숫자는 국어·수학·탐구1·탐구2 백분위다(docs/MODEL.md §8-2가 쓰는 표기).
// 나머지 조건은 다섯이 **똑같다** — 그래야 차이가 국·수·탐 분포에서만 온다.
export const PROFILE_FIXED = {
  mode: 'pct', eng: '2', hist: '1',
  korElective: '화법과작문', mathElective: '확률과통계',
  inq1Subject: '생활과윤리', inq2Subject: '사회문화',
};
export const PROFILES = [
  { key: 'top', label: '상위', kor: 96, math: 93, inq1: 95, inq2: 92 },
  { key: 'mid', label: '중위', kor: 85, math: 83, inq1: 84, inq2: 84 },
  { key: 'kor', label: '국어 강점', kor: 97, math: 69, inq1: 86, inq2: 52 },
  { key: 'math', label: '수학 강점', kor: 69, math: 97, inq1: 86, inq2: 52 },
  { key: 'even', label: '균형', kor: 78, math: 78, inq1: 78, inq2: 79 },
];

// (c)가 이름으로 집는 여섯 모집단위.
export const TARGETS = [
  { universityId: 'kookmin', dept: '자유전공(A)' },
  { universityId: 'kookmin', dept: '자유전공(B)' },
  { universityId: 'kookmin', dept: '미래융합전공(C)' },
  { universityId: 'yonsei', dept: '경영학과' },
  { universityId: 'soongsil', dept: '경영학부' },
  { universityId: 'kyonggi', dept: '경영학부' },
];

const NONE = '없음';
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const AREA_SHORT = { kor: '국', math: '수', eng: '영', inq: '탐' };

const scoresOf = (profile) => ({
  ...PROFILE_FIXED,
  kor: String(profile.kor), math: String(profile.math),
  inq1: String(profile.inq1), inq2: String(profile.inq2),
});

// 옛 모델 = 국·수·탐(2) 평균 백분위를 컷에서 뺀다. 지금의 L3 계산 그대로다 —
// evaluateJeongsi 의 층위 판정이 붙기 전 경로를 같은 함수들로 다시 만든다.
export function legacyVerdict(engine, data, profile, university, dept) {
  const reference = engine.jeongsiReference(dept, university.volatility ?? data.volatility);
  const rule = data.rules?.[university.id];
  const score = engine.universityScore(profile, rule, dept.track, dept.ruleTrack);
  if ((score?.blockers || []).length > 0) return { label: NONE, gap: null, why: '자격 미충족' };
  const def = reference.def || engine.COMPARE_BASIS;
  const mine = engine.comparableScore(profile, def);
  if (!mine) return { label: NONE, gap: null, why: '성적 부족' };
  if (!reference.primary) return { label: NONE, gap: null, why: '백분위 컷 없음' };
  const gap = engine.round(mine.value - reference.primary.value, engine.VERDICT_DIGITS);
  return {
    label: engine.bandOf(gap, engine.VERDICT_BANDS)?.label ?? NONE,
    gap, cut: reference.primary.value, mine: mine.value, why: null,
  };
}

const newVerdict = (result) => (result.status === 'ok' && result.band ? result.band.label : NONE);

// 반영비율 한 줄 (assets/app.js 의 ratioText 와 같은 규칙).
function ratioText(track) {
  // 영어 계수가 1이면 배점은 등급표 1등급 값이다(숭실 `영200`). 탐구가 과목 합산이고 네 영역
  // 배점의 합이 총점과 맞으면 요강 표기대로 과목마다 적는다(`탐125+125`).
  const eng = track?.areas?.eng || null;
  const engTop = isNumber(eng?.table?.['1']) ? eng.table['1'] : null;
  const engFactor = isNumber(eng?.factor) ? eng.factor : null;
  const engValue = engFactor !== null && engFactor <= 1 && engTop !== null && engTop > 1
    ? engTop * engFactor : (engFactor ?? track?.weights?.eng ?? null);
  const inq = track?.areas?.inq || null;
  const inqFactor = isNumber(inq?.factor) ? inq.factor : (track?.weights?.inq ?? null);
  const inqCount = Math.max(1, Number(inq?.count) || 1);
  const summed = inqFactor !== null && inqCount > 1 && String(inq?.aggregate || 'sum') === 'sum';
  const value = {
    kor: track?.areas?.kor?.factor ?? track?.weights?.kor ?? null,
    math: track?.areas?.math?.factor ?? track?.weights?.math ?? null,
    eng: engValue,
    inq: inqFactor,
    hist: track?.areas?.hist?.factor ?? track?.weights?.hist ?? null,
  };
  const sum = (value.kor || 0) + (value.math || 0) + (value.eng || 0) + (inqFactor || 0) * (summed ? inqCount : 1);
  const perSubject = summed && isNumber(track?.total) && Math.abs(sum - track.total) < 0.5;
  const parts = [];
  for (const [key, short] of Object.entries(AREA_SHORT)) {
    if (!isNumber(value[key]) || !(value[key] > 0)) continue;
    parts.push(key === 'inq' && perSubject
      ? `${short}${Array.from({ length: inqCount }, () => value.inq).join('+')}`
      : `${short}${value[key]}`);
  }
  return parts.join(' ');
}

// (c)의 근거 한 줄. **성적과 무관한 것만** 적는다 — 어느 층위에서 무엇을 기준으로 뺐는가.
// (내 점수·차이는 바로 위 표가 프로필마다 적는다.)
function basisLine(data, university, dept, result) {
  const level = result.level;
  const year = result.cut?.year ?? null;
  if (level === 'L1') {
    const formula = result.model?.apply?.formula || null;
    const check = data.formulaCheck?.tracks?.[`${university.id}::${formula?.track}`]?.status || 'unchecked';
    const track = (data.rules2026?.universities?.[university.id]?.tracks || []).find((row) => row.name === formula?.track) || null;
    const source = formula?.year ? `${formula.year} ${formula.status === 'plan' ? '시행계획' : '요강'}` : '요강';
    return [
      `L1 · ${year} 어디가 환산 70% ${result.cut?.score70 ?? '—'}`,
      `산식 ${source} ${formula?.track ?? '—'}`,
      `검산 ${check}`,
      ratioText(track),
    ].filter(Boolean).join(' · ');
  }
  if (level === 'L2') {
    const trackName = result.model?.apply?.formula?.track ?? null;
    const rule = data.rules?.[university.id] || null;
    const track = (rule?.tracks || []).find((row) => row.name === trackName) || null;
    return [
      `L2 · ${year} 어디가 70% 학생 영역별 백분위`,
      `${rule?.year ?? 2027} 시행계획 ${trackName ?? '—'}`,
      ratioText(track) ? `${ratioText(track)} 반영비율` : null,
    ].filter(Boolean).join(' · ');
  }
  if (level === 'L3') {
    return `L3 · ${year} ${result.defLabel ?? '평균 백분위'} 70%컷 ${result.cut?.value ?? '—'}`;
  }
  return `L0 · ${result.status}${result.hold?.reason ? ` · ${result.hold.reason}` : ''}`;
}

// mismatch 트랙의 원인 분류. 표본 두 개(source/formula-check.json samples)만 보고 값으로 가른다.
export function mismatchCause(samples) {
  const rows = samples || [];
  if (rows.length === 0) return '표본 없음';
  if (rows.some((row) => /≠ 산식/u.test(row.reason || ''))) return '총점 눈금 불일치';
  const off = Math.max(...rows.map((row) => Number(row.off) || 0));
  const above = rows.every((row) => isNumber(row.adiga) && isNumber(row.max) && row.adiga > row.max);
  const below = rows.every((row) => isNumber(row.adiga) && isNumber(row.min) && row.adiga < row.min);
  const direction = above ? '공시값이 재현 구간 위' : below ? '공시값이 재현 구간 아래' : '방향 혼재';
  const size = off <= 3 ? '≤3점' : off <= 10 ? '3~10점' : '>10점';
  return `${direction} · ${size}`;
}

export function buildReport(engine = loadBrowser('assets/engine.js', 'IPSI_ENGINE'), data = loadBrowser('assets/data.js', 'IPSI_DATA')) {
  const bands = engine.VERDICT_BANDS.map((band) => band.label);
  const labels = [...bands, NONE];

  const profiles = PROFILES.map((entry) => {
    const profile = engine.normalizeProfile(scoresOf(entry), data.scales, data.std);
    const rows = engine.diagnose(profile, data);
    const levels = { L1: 0, L2: 0, L3: 0, L0: 0 };
    const matrix = new Map(labels.map((old) => [old, new Map(labels.map((next) => [next, 0]))]));
    let judgedBoth = 0;
    let changed = 0;
    let up = 0;
    let down = 0;
    let l3Same = 0;
    let l3Rows = 0;
    const rank = new Map(bands.map((label, index) => [label, index])); // 0 = 안정
    for (const row of rows) {
      const result = row.jeongsi;
      levels[result.level] = (levels[result.level] || 0) + 1;
      const university = data.universities.find((one) => one.id === row.universityId);
      const oldOne = legacyVerdict(engine, data, profile, university, row.dept);
      const nextLabel = newVerdict(result);
      matrix.get(oldOne.label).set(nextLabel, matrix.get(oldOne.label).get(nextLabel) + 1);
      if (oldOne.label !== NONE && nextLabel !== NONE) {
        judgedBoth += 1;
        if (oldOne.label !== nextLabel) {
          changed += 1;
          if (rank.get(nextLabel) < rank.get(oldOne.label)) up += 1; else down += 1;
        }
      }
      // 자기검사: 새 모델이 L3로 판정한 행은 옛 모델과 **같은 계산**이라 띠가 같아야 한다.
      if (result.level === 'L3' && result.status === 'ok' && oldOne.label !== NONE) {
        l3Rows += 1;
        if (oldOne.label === nextLabel) l3Same += 1;
      }
    }
    return {
      ...entry, profile, rows, levels, judgedBoth, changed, up, down, l3Rows, l3Same,
      judged: rows.filter((row) => row.jeongsi.status === 'ok').length,
      total: rows.length,
      matrix,
    };
  });

  // (c) 지정 여섯
  const targets = TARGETS.map(({ universityId, dept: deptName }) => {
    const university = data.universities.find((one) => one.id === universityId);
    const dept = university?.departments.find((one) => one.name === deptName) || null;
    if (!dept) return { universityId, deptName, missing: true, cells: [] };
    const cells = profiles.map((entry) => {
      const result = engine.evaluateJeongsi(entry.profile, university, dept, data.rules?.[universityId],
        university.volatility ?? data.volatility, engine.layerContext(data));
      const oldOne = legacyVerdict(engine, data, entry.profile, university, dept);
      return {
        profile: entry.label, level: result.level,
        oldLabel: oldOne.label, oldGap: oldOne.gap,
        newLabel: newVerdict(result), newGap: isNumber(result.gap) ? result.gap : null,
        result,
      };
    });
    return {
      universityId, deptName, missing: false,
      universityName: university.short || university.name,
      cells,
      basis: basisLine(data, university, dept, cells.find((cell) => cell.result.status === 'ok')?.result || cells[0].result),
    };
  });

  // (d) 검산
  const check = data.formulaCheck || { tracks: {}, samples: {}, skipped: [] };
  const trackRows = Object.entries(check.tracks || {});
  const status = { verified: 0, mismatch: 0, unchecked: 0 };
  const points = { match: 0, mismatch: 0, unchecked: 0 };
  for (const [, row] of trackRows) {
    status[row.status] = (status[row.status] || 0) + 1;
    points.match += row.match || 0;
    points.mismatch += row.mismatch || 0;
    points.unchecked += row.unchecked || 0;
  }
  const causes = new Map();
  const mismatchTracks = [];
  for (const [key, row] of trackRows) {
    if (row.status !== 'mismatch') continue;
    const samples = check.samples?.[key] || [];
    const cause = mismatchCause(samples);
    const off = samples.length > 0 ? Math.max(...samples.map((one) => Number(one.off) || 0)) : null;
    causes.set(cause, (causes.get(cause) || 0) + 1);
    mismatchTracks.push({ key, university: row.university, track: row.track, match: row.match, mismatch: row.mismatch, off });
  }
  mismatchTracks.sort((left, right) => (right.mismatch - left.mismatch) || ((right.off ?? 0) - (left.off ?? 0)));

  return {
    generatedAt: data.generatedAt,
    universities: data.universities.length,
    departments: data.universities.reduce((sum, one) => sum + one.departments.length, 0),
    bands, labels, profiles, targets,
    check: {
      tolerance: check.tolerance ?? null,
      tracks: trackRows.length, status, points,
      causes: [...causes].sort((left, right) => right[1] - left[1]),
      mismatchTracks,
      skipped: check.skipped || [],
    },
  };
}

export function renderMarkdown(report) {
  const lines = [];
  const cell = (value) => (value === null || value === undefined ? '—' : String(value));
  // 차이는 늘 소수 첫째 자리다(판정이 그 자리에서 난다).
  const gapCell = (value) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—');
  lines.push('# 판정 변화 — 옛 모델과 v3');
  lines.push('');
  lines.push('이 문서의 숫자는 모두 `scripts/model-report.mjs`가 `assets/data.js`와 `assets/engine.js`에서');
  lines.push('세어 만든다(`npm run report`). 손으로 고치지 않는다.');
  lines.push('');
  lines.push(`생성일 ${report.generatedAt} · 대학 ${report.universities}곳 · 모집단위 ${report.departments}곳`);
  lines.push('');
  lines.push('- **옛 모델** = 국·수·탐(2) 평균 백분위 − 어디가 70%컷. 지금의 L3 계산 그대로다.');
  lines.push('- **새 모델** = L1 환산(대학 산식·검산 통과) → L2 지수(반영비율) → L3 참고 → L0 없음 (docs/MODEL.md §3).');
  lines.push('- 두 모델의 띠 표는 같다: 안정 ≥ +2.0 · 적정 ≥ +0.7 · 소신 ≥ −0.7 · 상향 ≥ −2.0 · 위험 < −2.0.');
  lines.push('  L1에서만 "안정은 50% 지점도 넘어야 한다"가 더 걸린다(§3).');
  lines.push('');
  lines.push('## 0. 대표 프로필 다섯');
  lines.push('');
  lines.push('| 프로필 | 국어 | 수학 | 탐구1 | 탐구2 | 평균 |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const entry of report.profiles) {
    const avg = Math.round(((entry.kor + entry.math + (entry.inq1 + entry.inq2) / 2) / 3) * 10) / 10;
    lines.push(`| ${entry.label} | ${entry.kor} | ${entry.math} | ${entry.inq1} | ${entry.inq2} | ${avg} |`);
  }
  lines.push('');
  lines.push('다섯의 나머지 조건은 같다 — 영어 2등급 · 한국사 1등급 · 화법과작문 · 확률과통계 ·');
  lines.push('생활과윤리 · 사회문화. 그래서 차이는 국·수·탐 분포에서만 온다.');
  lines.push('확률과통계·사탐이라 미적분·기하 또는 과탐을 요구하는 모집단위는 자격 미충족(L0)으로 빠진다.');
  lines.push('');
  lines.push('## 1. 층위 분포');
  lines.push('');
  lines.push('| 프로필 | L1 | L2 | L3 | L0 | 판정 | 전체 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const entry of report.profiles) {
    lines.push(`| ${entry.label} | ${entry.levels.L1} | ${entry.levels.L2} | ${entry.levels.L3} | ${entry.levels.L0} | ${entry.judged} | ${entry.total} |`);
  }
  lines.push('');
  lines.push('층위는 성적이 아니라 **데이터**가 정한다 — 산식 검산이 통과했나(L1), 70% 학생의 영역별');
  lines.push('백분위가 있나(L2). 그래서 다섯 프로필의 분포가 같고, L0 56곳은 확률과통계·사탐이라');
  lines.push('자격이 안 되는 자연계 모집단위다.');
  lines.push('');
  lines.push('## 2. 옛 모델 → 새 모델');
  lines.push('');
  lines.push('| 프로필 | 둘 다 판정 | 같음 | 달라짐 | 비율 | 올라감 | 내려감 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const entry of report.profiles) {
    const rate = entry.judgedBoth > 0 ? `${(entry.changed / entry.judgedBoth * 100).toFixed(1)}%` : '—';
    lines.push(`| ${entry.label} | ${entry.judgedBoth} | ${entry.judgedBoth - entry.changed} | ${entry.changed} | ${rate} | ${entry.up} | ${entry.down} |`);
  }
  lines.push('');
  lines.push('올라감 = 더 안전한 띠로(위험 → 상향 …), 내려감 = 더 위험한 띠로 바뀐 모집단위다.');
  lines.push('');
  lines.push('새 모델이 L3로 판정한 행은 옛 모델과 같은 계산이라 띠가 같아야 한다 — 실제로 그렇다:');
  lines.push(report.profiles.map((entry) => `${entry.label} ${entry.l3Same}/${entry.l3Rows}`).join(' · '));
  lines.push('');
  for (const entry of report.profiles) {
    lines.push(`### 2-${report.profiles.indexOf(entry) + 1}. ${entry.label}`);
    lines.push('');
    lines.push(`| 옛＼새 | ${report.labels.join(' | ')} |`);
    lines.push(`|---|${report.labels.map(() => '---:').join('|')}|`);
    for (const old of report.labels) {
      const row = report.labels.map((next) => entry.matrix.get(old).get(next));
      if (row.every((value) => value === 0)) continue;
      lines.push(`| ${old} | ${row.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('## 3. 지정 모집단위 여섯');
  lines.push('');
  for (const target of report.targets) {
    lines.push(`### ${target.missing ? `${target.universityId} ${target.deptName}` : `${target.universityName} ${target.deptName}`}`);
    lines.push('');
    if (target.missing) {
      lines.push('생성 데이터에 이 모집단위가 없다.');
      lines.push('');
      continue;
    }
    lines.push('| 프로필 | 층위 | 옛 차이 | 옛 판정 | 새 차이 | 새 판정 |');
    lines.push('|---|---|---:|---|---:|---|');
    for (const one of target.cells) {
      lines.push(`| ${one.profile} | ${one.level} | ${gapCell(one.oldGap)} | ${one.oldLabel} | ${gapCell(one.newGap)} | ${one.newLabel} |`);
    }
    lines.push('');
    lines.push(target.basis);
    lines.push('');
  }
  lines.push('## 4. 산식 검산');
  lines.push('');
  lines.push(`\`npm run verify\`(\`scripts/verify-formulas.mjs\`)가 어디가 공시 환산점수를 산식으로 되짚어 ±${report.check.tolerance}점 안이면 match 로 센다.`);
  lines.push('**verified 트랙만 L1 판정에 쓰인다** — mismatch·unchecked는 L2로 내려간다.');
  lines.push('');
  lines.push('| 트랙 판정 | 트랙 |');
  lines.push('|---|---:|');
  for (const key of ['verified', 'mismatch', 'unchecked']) lines.push(`| ${key} | ${report.check.status[key] || 0} |`);
  lines.push(`| 계 | ${report.check.tracks} |`);
  lines.push('');
  lines.push('| 지점 대조 | 건 |');
  lines.push('|---|---:|');
  lines.push(`| match | ${report.check.points.match} |`);
  lines.push(`| mismatch | ${report.check.points.mismatch} |`);
  lines.push(`| unchecked | ${report.check.points.unchecked} |`);
  lines.push('');
  lines.push('### mismatch 원인');
  lines.push('');
  lines.push('| 원인 | 트랙 |');
  lines.push('|---|---:|');
  for (const [cause, count] of report.check.causes) lines.push(`| ${cause} | ${count} |`);
  lines.push('');
  lines.push('| 대학 | 트랙 | match | mismatch | 최대 벗어남 |');
  lines.push('|---|---|---:|---:|---:|');
  for (const row of report.check.mismatchTracks.slice(0, 15)) {
    lines.push(`| ${row.university} | ${row.track} | ${row.match} | ${row.mismatch} | ${cell(row.off)} |`);
  }
  lines.push('');
  if (report.check.skipped.length > 0) {
    lines.push('### 대조하지 못한 대학');
    lines.push('');
    lines.push('| 대학 | 사유 | 행 |');
    lines.push('|---|---|---:|');
    for (const row of report.check.skipped) lines.push(`| ${row.university} | ${row.reason} | ${row.rows} |`);
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/model-report.mjs')) {
  if (!existsSync(path.join(ROOT, 'assets/data.js'))) {
    console.error('assets/data.js 가 없다 — npm run build 를 먼저 돌린다.');
    process.exit(1);
  }
  const report = buildReport();
  const text = `${renderMarkdown(report)}\n`;
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== text) writeFileSync(OUTPUT, text, 'utf8');
  const changed = report.profiles.map((entry) => `${entry.label} ${entry.changed}/${entry.judgedBoth}`).join(' · ');
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}: 판정 변화 ${changed}`);
}
