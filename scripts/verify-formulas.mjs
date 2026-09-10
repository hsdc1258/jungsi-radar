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

// 한 지점(70% 또는 50%) 하나를 대조한다. 순수 함수 — tests/formula-check.test.mjs 가 직접 부른다.
//   student : 어디가 행의 그 지점 학생 성적표 { kor, math, inq1, inq2, avg, eng, hist }
//   target  : 그 지점의 공시 환산점수
export function checkPoint(engine, track, student, target, ctx) {
  if (!track || !student) return { status: 'unchecked', reason: '산식 또는 학생 성적표 없음' };
  if (!isNum(target)) return { status: 'unchecked', reason: '공시 환산점수 없음' };
  const normalized = engine.normalizeCutStudent(student);
  if (!normalized || !isNum(normalized.kor)) return { status: 'unchecked', reason: '영역별 백분위 없음' };
  if (normalized.consistent === false) return { status: 'unchecked', reason: '평균백분위 불일치(§1.1)' };
  const inputs = engine.studentFormulaInputs(normalized, ctx.std);
  const scored = engine.formulaScore2(track, inputs, ctx);
  if (!scored) return { status: 'unchecked', reason: '되읽기 실패' };
  // 총점(score.total)이 산식 total 과 다르면 그 자체로 mismatch 다.
  if (isNum(ctx.total) && isNum(scored.total) && ctx.total !== scored.total) {
    return { status: 'mismatch', min: scored.min, max: scored.max, target, reason: `총점 ${ctx.total} ≠ 산식 ${scored.total}` };
  }
  const inside = target >= scored.min - TOLERANCE && target <= scored.max + TOLERANCE;
  return {
    status: inside ? 'match' : 'mismatch',
    min: scored.min, max: scored.max, target,
    off: inside ? 0 : Math.round((target < scored.min ? scored.min - target : target - scored.max) * 100) / 100,
  };
}

export function verdictOf(counts) {
  const comparable = counts.match + counts.mismatch;
  if (comparable === 0) return 'unchecked';
  if (comparable < SMALL_TRACK) return counts.mismatch === 0 ? 'verified' : 'mismatch';
  return counts.match / comparable >= VERIFY_RATE ? 'verified' : 'mismatch';
}

// 입결 행 배열 × 산식 → 검산 결과. 데이터가 비어 있으면 빈 결과다.
export function verifyFormulas({ engine, rules, rows, std, conv }) {
  const tracks = new Map();
  const details = [];
  for (const row of rows || []) {
    const universityId = row.universityId || row.id || null;
    if (!universityId) continue;
    const dept = { name: row.dept, track: row.track || null, ruleTrack: row.ruleTrack || null };
    const track = engine.pickModelTrack(rules, universityId, dept);
    if (!track || !engine.trackHasFormula(track)) continue;
    const key = trackKey(universityId, track.name);
    if (!tracks.has(key)) {
      tracks.set(key, { university: universityId, track: track.name, year: row.year ?? track.year ?? null, match: 0, mismatch: 0, unchecked: 0 });
    }
    const counts = tracks.get(key);
    const ctx = { std, conv, universityId, year: row.year ?? null, total: row.score?.total ?? null };
    for (const point of ['p70', 'p50']) {
      const result = checkPoint(engine, track, row.student?.[point], row.score?.[point], ctx);
      counts[result.status] += 1;
      details.push({ university: universityId, dept: row.dept, track: track.name, year: row.year ?? null, point, ...result });
    }
  }
  const out = {};
  for (const [key, counts] of tracks) out[key] = { ...counts, status: verdictOf(counts) };
  return { tolerance: TOLERANCE, tracks: out, rows: details };
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
  const text = `${JSON.stringify(built, null, 1)}\n`;
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== text) writeFileSync(OUTPUT, text, 'utf8');
  const counts = {};
  for (const row of Object.values(built.tracks)) counts[row.status] = (counts[row.status] || 0) + 1;
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}: ${Object.keys(built.tracks).length} tracks`, counts);
}
