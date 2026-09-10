# 화면 틀 (FRAME)

이 문서는 사이트의 **디자인 틀**이다. 구현자는 이 틀 안에서 기능을 채운다. 틀 밖의 새 패턴은 만들지 않는다.

## 1. 원칙

- **Seed Design(당근) CSS만 쓴다.** `@seed-design/css@2.7.0`의 `all.min.css`를 jsDelivr로 링크하고, 컴포넌트는 그 recipe 클래스(`.seed-*`)로만 만든다. 자체 버튼·카드·뱃지를 새로 그리지 않는다. 우리 CSS(`assets/frame.css`)는 **배치(레이아웃)와 간격**만 담당한다.
- **한 화면 한 목적.** 탭 하나가 화면 하나다. 여러 섹션을 세로로 길게 잇지 않는다.
- **입력은 짧게, 결과는 먼저.** 성적 입력은 한 화면에서 끝나고, 결과 화면은 첫 뷰포트에 판정이 보인다.
- **글은 적게.** 헤드라인 20자 이내, 설명문 한 문장. 안내는 `callout` 하나, 그 이상은 접는다(`accordion`).
- **이모지·색 타일·그라디언트 없음.** 상태는 `badge`의 tone(positive/brand/neutral/warning/critical)으로만 말한다.
- **뱃지 글자는 짧게.** 좁은 폭에서 잘리지 않도록 뱃지에는 두세 글자(`표점`·`백분위`·`근사`)만 넣고, 긴 설명은 부제나 `muted` 줄로 내린다.
- **모바일 우선.** 콘텐츠 폭 최대 640px 중앙 정렬. 데스크톱에서도 같은 한 열이다(당근 앱 화면과 같은 어법).

## 2. 테마

- `<html data-seed data-seed-color-mode="system">`가 기본이다. 토글은 `data-seed-color-mode`를 `light-only` / `dark-only` / `system` 세 값으로 돌리고 `localStorage['jr.theme']`에 저장한다.
- 배경은 항상 `var(--seed-color-bg-layer-default)`, 본문 글자는 `var(--seed-color-fg-neutral)`. 색 값을 직접 쓰지 않는다 — 두 테마에서 같은 토큰이 알아서 바뀐다.
- 첫 페인트 깜빡임을 막기 위해 테마 복원 스크립트는 `<head>`에서 동기로 돈다.

## 3. 골격 (index.html)

```
app-bar        제목 "정시 레이더" · 우측 테마 토글(아이콘 버튼)
tabs (sticky)  성적 | 진단 | 목표 | 반영 | 정보
main           탭 패널 하나만 렌더 (#panel)
footer         출처·면책 한 줄
```

- 상단바: `.seed-app-bar__root` + `.seed-app-bar__left`(제목) + `.seed-app-bar__right`(토글).
- 탭: `.seed-tabs__root` / `.seed-tabs__list--triggerLayout_fill` / `.seed-tabs__trigger` (`data-selected`) / `.seed-tabs__indicator`. 5개 고정, 스크롤 없음.
- 패널: `<section id="panel">` 하나. 탭이 바뀌면 통째로 다시 그린다.

## 4. 화면별 구성과 컴포넌트

| 화면 | 구성 (위에서 아래로) | Seed 컴포넌트 |
|---|---|---|
| 성적 | ① 입력 기준 세그먼트(백분위/등급/표준점수) ② 영역별 필드 6개(국어·수학은 선택과목 셀렉트 + 숫자, 영어·한국사는 등급 셀렉트, 탐구 2개는 과목 셀렉트 + 숫자) ③ 내신 등급(선택) ④ 표준점수일 때만: 기준 `callout` + "표준점수 → 백분위" 목록 + "대학별 환산점수" `accordion` ⑤ 관심 대학 `accordion` ⑥ 하단 고정 기본 버튼 "진단 보기" | `segmented-control`, `field` + `text-input`(outline), 네이티브 `<select>`에 `select-trigger` 스타일, `accordion`, `action-button` brandSolid large |
| 진단 | ① 요약 한 줄(국수탐 평균·대상 수) ② 필터: 계열 `chip-tabs`, 라인·판정 `select`, 검색 `text-input`, 관심 학과만 / 관심 대학만 토글 ③ 관심 대학 `accordion`(대학 칩) ④ 관심 대학 묶음이 맨 위, 그 아래 나머지: `list-header` + `list-item` 반복 (제목=대학·학과, 부제=컷·군·반영 지표, 우측=내 점수와 `badge`) ⑤ "더 보기" neutralWeak 버튼 | `chip-tabs`, `accordion`, `list-header`, `list-item`, `badge`, `action-button` |
| 목표 | ① 대학·학과 셀렉트 2개(관심 대학은 `optgroup`으로 위에) ② 판정 카드 한 장: 큰 숫자(차이) + `badge` + 반영 지표 한 줄 ③ 비교 기준 `callout` ④ "필요한 상승" 리스트(영역별 행, 추천은 `badge` brand) ⑤ 선택과목·가감점 `callout` ⑥ 표준점수 모드일 때 대학 환산점수 `accordion` ⑦ 기준(연도별 컷·경쟁률) `accordion` ⑧ 수시 참고 `accordion` | `list-item`, `badge`, `callout`, `accordion` |
| 반영 | ① 대학 셀렉트 ② 반영 지표 `callout` ③ 계열별 `accordion`(비율·영어·한국사·탐구·가산) ④ 선택과목 원점수 컷 표 `list-item` | `callout`, `accordion`, `list-item` |
| 정보 | ① 판정 기준·비교 기준 `callout` 둘 ② 판정 표·계산 방법 ③ 정확도 `accordion`(커버리지·차이 분포·민감도 표) ④ 대학별 반영 지표 목록 ⑤ 관심 대학 `accordion` ⑥ 출처 링크 `list-item` 목록 ⑦ 한계 `accordion` ⑧ 데이터 생성일 | `callout`, `accordion`, `list-item`, `badge` |

## 5. 상태·피드백

- 빈 상태·오류: `inline-banner`(neutralWeak / criticalWeak) **한 문장**.
- 저장은 자동(localStorage). 저장 알림은 띄우지 않는다.
- 로딩은 없다(데이터가 정적). 첫 렌더 전 스켈레톤도 두지 않는다.

## 6. 타이포·간격

- 글자 크기는 Seed 텍스트 토큰만: 제목 `--seed-font-size-t7`급 이하, 본문 t5, 캡션 t3. 큰 숫자(판정 차이)만 t9까지.
- 세로 간격은 `--seed-dimension-spacing-y-component-default`(섹션 사이)와 `--seed-dimension-spacing-x-global-gutter`(좌우 여백)만 쓴다.
- 폰트는 Seed 기본 스택을 따르고 웹폰트를 추가하지 않는다.

## 7. 하지 않는 것

- 차트·그래프 (숫자와 뱃지로 충분하다 — 정확도 수치도 표로만 적는다)
- 카드 안의 카드, 3연속 카드
- 모달·바텀시트 (모든 것은 패널 안에서 끝난다)
- 마케팅 문구("완벽한", "지금 바로")
