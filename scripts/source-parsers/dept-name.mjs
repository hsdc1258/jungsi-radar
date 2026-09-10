// 모집단위 이름 정규화. 어디가 원문과 우리 results.json 의 이름을 같은 자로 재려고 쓴다.
// 규칙은 하나뿐이다 — 눈에 안 보이는 차이(전각·공백·구분점·괄호 모양)만 지우고 글자는 남긴다.
// 글자를 지우면 '자유전공(A)' 와 '자유전공(B)' 가 같아지므로 괄호 안 내용은 절대 버리지 않는다.
const SEPARATORS = /[·・･ㆍ‧∙⋅.]/gu;
const BRACKETS = [
  [/[（(]/gu, '('], [/[）)]/gu, ')'],
  [/[［[〔【]/gu, '('], [/[］\]〕】]/gu, ')'],
  [/[｛{]/gu, '('], [/[｝}]/gu, ')'],
];

export function normalizeDept(name) {
  let text = String(name ?? '').normalize('NFKC');
  for (const [pattern, replacement] of BRACKETS) text = text.replace(pattern, replacement);
  return text
    .replace(/\s+/gu, '')
    .replace(SEPARATORS, '')
    .replace(/[-–—_/]/gu, '')
    .toLowerCase();
}

export default normalizeDept;
