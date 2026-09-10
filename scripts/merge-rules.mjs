// 2026학년도 산식 조각 합치기 (docs/MODEL.md §1.2).
//   source/rules-2026.base.json  손으로 적은 바탕 (국민대·연세대)
//   source/rules-2026.part-*.json 다른 작업이 만드는 조각들
// → source/rules-2026.json  (빌드 앞단에서 돈다)
//
// 조각이 하나도 없어도 바탕만으로 결과를 쓴다. 같은 대학이 여러 파일에 있으면 **조각이 이긴다**
// (조각은 요강 원문에서 뽑아낸 값이고 바탕은 수기다). 트랙은 이름으로 짝지어 덮어쓴다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'source');
const OUTPUT = path.join(SOURCE, 'rules-2026.json');
const BASE = path.join(SOURCE, 'rules-2026.base.json');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function partFiles(dir = SOURCE) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^rules-2026\.part-[^.]+\.json$/u.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

// 대학 하나를 덮어쓴다. 트랙은 이름이 같으면 갈아 끼우고, 없으면 뒤에 붙인다.
export function mergeUniversity(base, patch) {
  if (!base) return patch;
  if (!patch) return base;
  const tracks = [...(base.tracks || [])];
  for (const track of patch.tracks || []) {
    const index = tracks.findIndex((row) => row.name === track.name);
    if (index === -1) tracks.push(track);
    else tracks[index] = track;
  }
  return { ...base, ...patch, tracks };
}

export function mergeRules(documents) {
  const universities = {};
  const sources = [];
  for (const document of documents) {
    for (const [id, university] of Object.entries(document?.universities || {})) {
      universities[id] = mergeUniversity(universities[id], university);
    }
    if (document?._source) sources.push(document._source);
  }
  return { year: 2026, status: 'final', universities, sources };
}

export function buildRules2026() {
  const documents = [];
  if (existsSync(BASE)) documents.push(readJson(BASE));
  for (const file of partFiles()) documents.push(readJson(file));
  if (documents.length === 0) return null;
  return mergeRules(documents);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/merge-rules.mjs')) {
  const merged = buildRules2026();
  if (!merged) {
    console.log('merge-rules: source/rules-2026.base.json 도 조각도 없다 — 아무것도 쓰지 않는다');
  } else {
    const text = `${JSON.stringify({ _comment: '생성물 — scripts/merge-rules.mjs가 rules-2026.base.json과 rules-2026.part-*.json에서 만든다. 손으로 고치지 않는다.', ...merged }, null, 1)}\n`;
    if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== text) writeFileSync(OUTPUT, text, 'utf8');
    const tracks = Object.values(merged.universities).reduce((sum, row) => sum + (row.tracks || []).length, 0);
    console.log(`wrote ${path.relative(ROOT, OUTPUT)}: ${Object.keys(merged.universities).length} universities, ${tracks} tracks`);
  }
}
