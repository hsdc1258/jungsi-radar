// 산식 검산 (docs/MODEL.md §1.4).
//   source/adiga/<학년도>.json 의 행마다 70%·50% 지점 학생의 영역별 백분위를 §1.3으로
//   표준점수 **구간**으로 되읽고, §1.2 산식에 넣어 환산점수 구간을 만든다. 어디가가 공시한
//   환산점수가 그 구간 ±1.0점 안이면 그 행은 match 다.
// → source/formula-check.json
//
// 트랙 판정: verified(대조 가능한 행의 90% 이상 match, 행이 3개 미만이면 전부 match) ·
//            mismatch(그 밖) · unchecked(대조할 값이 없다).
// **verified가 아닌 트랙은 L1 판정에 쓰이지 않는다** — 엔진이 formula-check 를 보고 고른다.
//
// 데이터(source/adiga/)가 아직 없으면 빈 결과를 쓰고 종료 코드 0으로 끝난다.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEngine } from './engine-node.mjs';
import { buildRules2026 } from './merge-rules.mjs';
import { classifyTrack, overrideTrack } from './build-data.mjs';
import { TYPE_KINDS, TYPE_LABEL, classifyType } from './source-parsers/admission-type.mjs';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source');
const ADIGA = path.join(SOURCE, 'adiga');
const OUTPUT = path.join(SOURCE, 'formula-check.json');

// 공시 환산점수가 재현 구간에서 이만큼 벗어나도 match 로 본다(§1.4).
export const TOLERANCE = 1.0;
export const VERIFY_RATE = 0.9;
export const SMALL_TRACK = 3;

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const trackKey = (universityId, trackName) => `${universityId}::${trackName}`;

export function adigaFiles(dir = ADIGA) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /^\d{4}\.json$/u.test(name)).sort().map((name) => path.join(dir, name));
}

// 배점 없이 총점에 얹히는 가산의 최대폭(한국사·영어 가산). 어디가 총점은 이걸 포함하고
// 요강의 반영총점은 포함하지 않는 대학이 있다(외대 700 vs 710).
export function bonusHeadroom(track) {
  let sum = 0;
  for (const key of ['hist', 'eng']) {
    const area = track?.areas?.[key];
    if (!area || !area.table) continue;
    const mode = area.mode || (key === 'hist' ? 'table' : 'table');
    if (mode === 'penalty' || mode === 'none') continue;
    if (key === 'eng' && mode === 'table') continue; // 배점 안에 든 영어는 총점에 이미 들어 있다
    const values = Object.values(area.table).filter((one) => typeof one === 'number');
    if (values.length > 0) sum += Math.max(...values) * (Number.isFinite(Number(area.factor)) ? Number(area.factor) : 1);
  }
  return sum;
}

// 한 지점(70% 또는 50%) 하나를 대조한다. 순수 함수 — tests/formula-check.test.mjs 가 직접 부른다.
//   student : 어디가 행의 그 지점 학생 성적표 { kor, math, inq1, inq2, avg, eng, hist }
//   target  : 그 지점의 공시 환산점수
export function checkPoint(engine, track, student, target, ctx) {
  if (!track || !student) return { status: 'unchecked', reason: '산식 또는 학생 성적표 없음' };
  if (!isNum(target)) return { status: 'unchecked', reason: '공시 환산점수 없음' };
  const normalized = engine.normalizeCutStudent(student);
  if (!normalized || !isNum(normalized.kor)) return { status: 'unchecked', reason: '영역별 백분위 없음' };
  if (normalized.consistent === false) return { status: 'unchecked', reason: '평균백분위 불일치(§1.1)' };
  // 산식이 탐구 n과목을 요구하는데 어디가 행에 그만큼이 없으면 **대조 불가**다. 없는 과목을
  // 0으로 두고 채점하면 산식이 틀린 것처럼 보인다(홍익대 경영학부: 탐구1만 공시 → 16점 낮게 나온다).
  const inquiry = track.areas?.inq;
  const need = Number(inquiry?.count ?? 0);
  if (inquiry && (inquiry.metric || inquiry.mode) && need > 1 && normalized.inq.length < need) {
    return { status: 'unchecked', reason: `탐구 ${need}과목 산식인데 어디가 행에 ${normalized.inq.length}과목만 있다` };
  }
  const inputs = engine.studentFormulaInputs(normalized, ctx.std);
  const scored = engine.formulaScore2(track, inputs, ctx);
  if (!scored) return { status: 'unchecked', reason: '되읽기 실패' };
  // 어디가 총점과 산식 반영총점이 다르면 눈금이 다르다는 신호다(§1.4). 다만 한국사·영어처럼
  // 배점 없이 총점에 얹히는 가산은 어디가 총점에 들어가고 요강 반영총점에는 없어서 그것만으로는
  // 눈금이 다르다고 할 수 없고(외대 700 vs 710), 눈금이 정말 다르면 재현 구간이 먼저 어긋난다.
  // 그래서 총점 차이는 **재현이 빗나갔을 때의 사유**로만 쓰고, 값이 맞으면 note 로 남긴다.
  let totalNote = null;
  if (isNum(ctx.total) && isNum(scored.total) && ctx.total !== scored.total) {
    const headroom = bonusHeadroom(track);
    const explained = ctx.total > scored.total && ctx.total - scored.total <= headroom + 1e-9;
    totalNote = explained
      ? `어디가 총점 ${ctx.total} = 반영총점 ${scored.total} + 가산 ${Math.round((ctx.total - scored.total) * 100) / 100}`
      : `총점 ${ctx.total} ≠ 산식 ${scored.total}`;
  }
  const inside = target >= scored.min - TOLERANCE && target <= scored.max + TOLERANCE;
  return {
    status: inside ? 'match' : 'mismatch',
    min: scored.min, max: scored.max, target,
    // pickBest 형제 트랙(인하 A/B·항공 산출1·2·이화)은 어느 쪽으로 채점했는지 남긴다.
    picked: scored.picked?.track ?? null,
    reason: totalNote,
    off: inside ? 0 : Math.round((target < scored.min ? scored.min - target : target - scored.max) * 100) / 100,
  };
}

export function verdictOf(counts) {
  const comparable = counts.match + counts.mismatch;
  if (comparable === 0) return 'unchecked';
  if (comparable < SMALL_TRACK) return counts.mismatch === 0 ? 'verified' : 'mismatch';
  return counts.match / comparable >= VERIFY_RATE ? 'verified' : 'mismatch';
}

// 어디가 행은 계열을 적지 않는다 — 모집단위 이름으로 빌드와 **같은 규칙**(build-data.classifyTrack,
// 못박은 예외 TRACK_OVERRIDES)으로 계열을 정해 산식 트랙을 고른다. 여기서 다른 규칙을 쓰면
// 검산이 화면과 다른 트랙을 보게 된다.
export function deptOf(universityId, name) {
  const classified = classifyTrack(name);
  return { name, track: overrideTrack(universityId, name) || classified.track, ruleTrack: classified.ruleTrack };
}

// 입결 행 배열 × 산식 → 검산 결과. 데이터가 비어 있으면 빈 결과다.
export function verifyFormulas({ engine, rules, rows, std, conv }) {
  const tracks = new Map();
  const details = [];
  const skipped = new Map();
  // 전형별 재현(§1.1-2) — 특별전형 행이 일반 산식으로 재현되면 "동일 산식" 가정이 사실이다.
  const kinds = new Map(TYPE_KINDS.map((kind) => [kind, { kind, label: TYPE_LABEL[kind], match: 0, mismatch: 0, unchecked: 0 }]));
  for (const row of rows || []) {
    const universityId = row.universityId || row.university || row.id || null;
    if (!universityId) continue;
    const dept = deptOf(universityId, row.dept);
    const kind = classifyType(row.typeName).kind;
    const track = engine.pickModelTrack(rules, universityId, dept, kind);
    if (!track || !engine.trackHasFormula(track)) {
      const reason = !track ? '산식 트랙 없음' : '요강이 정규화 상수·배점을 밝히지 않음';
      const key = `${universityId}::${reason}`;
      skipped.set(key, { university: universityId, reason, rows: (skipped.get(key)?.rows || 0) + 1 });
      kinds.get(kind).unchecked += 2;
      continue;
    }
    const key = trackKey(universityId, track.name);
    if (!tracks.has(key)) {
      tracks.set(key, { university: universityId, track: track.name, year: row.year ?? track.year ?? null, depts: 0, match: 0, mismatch: 0, unchecked: 0 });
    }
    const counts = tracks.get(key);
    counts.depts += 1;
    const ctx = { std, conv, universityId, year: row.year ?? null, total: row.score?.total ?? null };
    for (const point of ['p70', 'p50']) {
      const result = checkPoint(engine, track, row.student?.[point], row.score?.[point], ctx);
      counts[result.status] += 1;
      kinds.get(kind)[result.status] += 1;
      details.push({ university: universityId, dept: row.dept, track: track.name, year: row.year ?? null, point, kind, typeName: row.typeName || '', ...result });
    }
  }
  const out = {};
  for (const [key, counts] of tracks) out[key] = { ...counts, status: verdictOf(counts) };
  // mismatch 트랙마다 어디가 값과 재현 구간을 두 개씩 남긴다 — 원인은 사람이 원문을 보고 판단한다.
  const samples = {};
  for (const [key, counts] of tracks) {
    if (verdictOf(counts) !== 'mismatch') continue;
    samples[key] = details
      .filter((one) => trackKey(one.university, one.track) === key && one.status === 'mismatch')
      .slice(0, 2)
      .map((one) => ({ dept: one.dept, point: one.point, adiga: one.target, min: one.min, max: one.max, off: one.off, reason: one.reason ?? null }));
  }
  const byKind = [...kinds.values()].map((row) => {
    const comparable = row.match + row.mismatch;
    return { ...row, comparable, rate: comparable > 0 ? Math.round((row.match / comparable) * 1000) / 10 : null };
  });
  return { tolerance: TOLERANCE, tracks: out, byKind, samples, skipped: [...skipped.values()], rows: details };
}

export function readAdigaRows() {
  const rows = [];
  for (const file of adigaFiles()) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed.rows || [];
    const year = Number(path.basename(file, '.json'));
    for (const row of list) rows.push({ year, ...row });
  }
  return rows;
}

export function buildFormulaCheck() {
  const engine = loadEngine(ROOT);
  const rules = buildRules2026();
  const std = existsSync(path.join(SOURCE, 'std-2026.json')) ? JSON.parse(readFileSync(path.join(SOURCE, 'std-2026.json'), 'utf8')) : null;
  const conv = existsSync(path.join(SOURCE, 'conv-2026.json')) ? JSON.parse(readFileSync(path.join(SOURCE, 'conv-2026.json'), 'utf8')) : null;
  const rows = readAdigaRows();
  if (!rules || rows.length === 0 || !std) {
    return { tolerance: TOLERANCE, tracks: {}, rows: [], note: 'source/adiga/ 입결이나 산식이 아직 없다 — 빈 결과다.' };
  }
  return verifyFormulas({ engine, rules, rows, std, conv });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/verify-formulas.mjs')) {
  const built = buildFormulaCheck();
  // 입결(source/adiga/)이 없는 데서 빌드하면 **이미 있는 검산 결과를 지우지 않는다** — 지우면
  // 생성물(assets/data.js)이 입결을 가진 기계에서와 달라져 CI의 생성물 대조가 깨진다.
  if (Object.keys(built.tracks).length === 0 && existsSync(OUTPUT)) {
    const kept = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    if (Object.keys(kept.tracks || {}).length > 0) {
      console.log(`verify-formulas: source/adiga/ 입결이 없다 — 기존 ${Object.keys(kept.tracks).length}개 트랙 검산 결과를 그대로 둔다`);
      process.exit(0);
    }
  }
  // 행 하나하나(만 줄)는 파일에 싣지 않는다 — 생성물(assets/data.js)이 이 파일을 통째로 담는다.
  const { rows, ...summary } = built;
  const text = `${JSON.stringify(summary, null, 1)}\n`;
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== text) writeFileSync(OUTPUT, text, 'utf8');
  const counts = {};
  for (const row of Object.values(built.tracks)) counts[row.status] = (counts[row.status] || 0) + 1;
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}: ${Object.keys(built.tracks).length} tracks`, counts, `checked rows ${(rows || []).length}`);
}
