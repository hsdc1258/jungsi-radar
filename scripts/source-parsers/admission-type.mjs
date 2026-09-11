// 전형 분류 (docs/MODEL.md §1.1-2).
//   어디가 행의 `typeName`(2026 기준 177종)을 분류 키 하나로 접는다.
//   표는 **우선순위 순서**이고, 위에서부터 처음 맞는 것이 답이다 —
//   `수능(고른기회전형[농어촌학생])`처럼 두 말이 같이 있는 이름은 위에 있는 농어촌으로 간다.
//
// 여기서 하는 일은 이름 분류뿐이다. 지원 자격은 성적으로 판별할 수 없어 사용자가 고른다(§1.1-2).
// 이름에 없는 말은 만들어 내지 않는다 — 표에 없는 이름은 전부 `general`로 두고,
// `source/adiga/types.json`에 그 목록을 남겨 사람이 본다.

// 우선순위 순서. 배열 순서가 곧 priority 이고, `dept.jeongsi[year].types[]`의 정렬 순서다.
export const TYPE_RULES = Object.freeze([
  // 농·어촌(가운뎃점 표기 포함)만 잡는다. '농'·'어촌' 한 글자로 잡으면 농업·어업 학과명에 걸린다.
  { kind: 'rural', label: '농어촌', match: /농\s*[·ㆍ・‧∙]?\s*어촌/u },
  // 특성화고(교)·특성화고졸업자·특성화고출신. 재직자·성인학습자는 표가 `other`로 못박았다.
  { kind: 'vocational', label: '특성화고', match: /특성화고/u, except: /재직자|성인학습자|성인\s*학습|만학도|평생/u },
  { kind: 'disability', label: '특수교육', match: /특수교육|장애인/u },
  { kind: 'overseas', label: '재외국민', match: /재외국민|북한이탈|외국인|새터민/u },
  { kind: 'regional', label: '지역인재', match: /지역인재|지역균형/u },
  { kind: 'equal', label: '기회균형', match: /기회균형|기초생활|차상위|한부모|저소득|사회배려|교육기회|고른기회|한마음|사회통합/u },
  { kind: 'practical', label: '실기·특기', match: /실기|특기자|체육특기|예능/u },
  { kind: 'other', label: '기타', match: /군사|계약|조기취업|성인학습자|만학도|재직자|평생|부사관|해군|육군/u },
]);

export const GENERAL = Object.freeze({ kind: 'general', label: '일반' });

// kind → 라벨. 화면·보고서가 같은 말을 쓰도록 여기 하나만 둔다.
export const TYPE_LABEL = Object.freeze(Object.fromEntries([
  ...TYPE_RULES.map((rule) => [rule.kind, rule.label]),
  [GENERAL.kind, GENERAL.label],
]));

// kind → 우선순위(작을수록 먼저). general 은 표의 맨 아래다.
export const TYPE_ORDER = Object.freeze(Object.fromEntries([
  ...TYPE_RULES.map((rule, index) => [rule.kind, index]),
  [GENERAL.kind, TYPE_RULES.length],
]));

export const TYPE_KINDS = Object.freeze([...TYPE_RULES.map((rule) => rule.kind), GENERAL.kind]);

/**
 * 전형명 하나를 분류한다.
 * @param {string} typeName 어디가 행의 전형명
 * @returns {{kind: string, label: string}}
 */
export function classifyType(typeName) {
  const name = String(typeName ?? '');
  for (const rule of TYPE_RULES) {
    if (!rule.match.test(name)) continue;
    if (rule.except && rule.except.test(name)) continue;
    return { kind: rule.kind, label: rule.label };
  }
  return { kind: GENERAL.kind, label: GENERAL.label };
}

// 모집시기 정렬 — 가 → 나 → 다 → 추가. 같은 kind 가 둘 이상일 때 이 순서로 실린다(§1.1-2).
export const PERIOD_ORDER = Object.freeze({ '정시(가)': 0, '정시(나)': 1, '정시(다)': 2, 추가: 3 });
export const periodRank = (period) => PERIOD_ORDER[String(period ?? '')] ?? 9;

// 어디가 원행은 `typeKind`, 생성물의 types 항목은 `kind` 로 분류를 들고 다닌다 — 둘 다 읽는다.
const kindOf = (row) => row?.kind ?? row?.typeKind ?? null;
// 모집인원도 두 모양이다 — 어디가 원행은 `{initial, carried, final}`, types 항목은 숫자다.
const quotaOf = (row) => (typeof row?.quota === 'number' ? row.quota : Number(row?.quota?.final ?? 0)) || 0;

/**
 * 전형 행 정렬 비교자 — kind 우선순위 → 모집시기 → 모집인원 많은 순 → 전형명.
 * 같은 kind·같은 모집시기가 둘일 때(고려대 가군 일반전형 78명 · 교과우수전형 46명) 이름 순으로
 * 가르면 대표 행이 뒤집힌다 — 사람이 '그 모집단위의 정시'라고 부르는 쪽은 크게 뽑는 전형이다.
 */
export function compareTypeRows(left, right) {
  const byKind = (TYPE_ORDER[kindOf(left)] ?? 99) - (TYPE_ORDER[kindOf(right)] ?? 99);
  if (byKind !== 0) return byKind;
  const byPeriod = periodRank(left.period) - periodRank(right.period);
  if (byPeriod !== 0) return byPeriod;
  const byQuota = quotaOf(right) - quotaOf(left);
  if (byQuota !== 0) return byQuota;
  return String(left.typeName || '').localeCompare(String(right.typeName || ''), 'ko');
}
