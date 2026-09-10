// 입시 진단 계산 엔진 (/ipsi/). 화면(app.js)과 노드 테스트(scripts/ipsi/ipsi.test.mjs)가
// 같은 파일을 쓴다 — DOM을 만지지 않고 순수 함수만 둔다.
//
// 계약
//   - 성적은 **백분위**로 통일한다. 등급·원점수 입력은 여기서 백분위로 바꾼 뒤 같은 길을 간다.
//     상대평가 등급 경계(1등급 상위 4% …)는 제도가 고정한 값이라 연도와 무관하다.
//   - 대학별 판정의 기준값은 어디가 '최종등록자 70% 컷'이다. 대학은 그 값을 국·수·탐(2) 백분위
//     평균(metric 'pct')으로 내거나 환산점수(metric 'score')로 낸다. 환산점수만 있는 모집단위는
//     사설 기관의 백분위 추정(estimate)이 있을 때만 판정하고, 없으면 판정을 보류한다 —
//     표준점수 기반 환산을 백분위로 되돌리는 것은 오차가 커서 숫자를 지어내는 셈이 된다.
//   - **컷과 같은 정의로 계산한 값만 뺀다.** 컷의 통계 정의(def)는 모집단위마다 다르다 —
//     국·수·탐(2) 평균이 기본이고, 상위 1과목 평균(명지대)·국·탐 평균(건국대 예체능)·
//     상위 2개 영역 평균(서경대)도 있다. comparableScore(profile, def)가 **그 정의 그대로**
//     내 성적을 계산해 같은 눈금에서 뺀다. 정의가 다르다는 이유로 보류하지 않는다.
//     'basis-mismatch'는 계산 자체가 불가능할 때만 쓴다(환산점수 눈금 컷 등).
//   - **등급 입력은 구간 중앙 백분위로 판정한다.** 등급 하나가 덮는 백분위 구간의 중앙값을
//     대표값으로 삼아 다른 입력과 같은 길을 간다. 구간이 판정 띠 둘에 걸쳐도 보류하지 않고,
//     '추정'이라고 적고 구간 하한·상한의 판정을 함께 돌려준다(gapRange).
//   - 대학 반영 방법(rules)으로 만든 가중값(universityScore)은 **앱 자체 지수**다. 반영 과목·
//     비율·척도가 컷과 달라(영어 포함, 국·수·탐 비대칭) 컷에서 뺄 수 없다 — 화면에 따로 적기만
//     하고 판정에는 쓰지 않는다. 지원 자격(과탐 필수·미적분 필수)만 이 계산에서 가져온다.
//   - 대학 공식 환산점수는 입학처 산출식과 실제 표준점수가 모두 있을 때만 낸다
//     (universityRawScore). 그 값도 컷과 눈금이 달라 판정에 쓰지 않는다.
//   - 판정 띠(안정/적정/소신/상향/위험)는 컷과의 차이(백분위 점)로 정한다. 컷 자체의 연도별
//     변동폭을 함께 돌려주므로 화면은 "오차범위"를 숫자로 보여줄 수 있다.
(() => {
  'use strict';

  // 상대평가 등급의 백분위 하한. 1등급 = 상위 4% (백분위 96 이상) … 8등급 = 상위 96%.
  const GRADE_FLOORS = Object.freeze([96, 89, 77, 60, 40, 23, 11, 4, 0]);
  // 등급만 입력했을 때 쓰는 대표 백분위 — 각 등급 구간의 중앙값.
  const GRADE_MIDPOINTS = Object.freeze([98, 92.5, 83, 68.5, 50, 31.5, 17, 7.5, 2]);
  // 영어·한국사(절대평가) 등급의 원점수 하한. 90 이상 1등급 … 한국사는 40점 만점 기준 별도.
  const ENGLISH_RAW_FLOORS = Object.freeze([90, 80, 70, 60, 50, 40, 30, 20, 0]);
  const HISTORY_RAW_FLOORS = Object.freeze([40, 35, 30, 25, 20, 15, 10, 5, 0]);

  const SOCIAL_SUBJECTS = Object.freeze(['생활과윤리', '윤리와사상', '한국지리', '세계지리', '동아시아사', '세계사', '경제', '정치와법', '사회문화']);
  const SCIENCE_SUBJECTS = Object.freeze(['물리학I', '화학I', '생명과학I', '지구과학I', '물리학II', '화학II', '생명과학II', '지구과학II']);
  const KOR_ELECTIVES = Object.freeze(['화법과작문', '언어와매체']);
  const MATH_ELECTIVES = Object.freeze(['확률과통계', '미적분', '기하']);

  const SUBJECT_LABEL = Object.freeze({
    kor: '국어', math: '수학', eng: '영어', inq: '탐구', inq1: '탐구1', inq2: '탐구2', hist: '한국사',
  });

  // 판정 띠. 하나뿐인 정의다 — 모든 화면이 이 표만 쓴다.
  //   차이 = 내 환산 백분위 − 예상 컷 (오차를 반영하기 전 값), 소수 첫째 자리로 반올림.
  //   안정 ≥ +2.0 / 적정 +0.7 이상 +2.0 미만 / 소신 −0.7 이상 +0.7 미만 /
  //   상향 −2.0 이상 −0.7 미만 / 위험 −2.0 미만 / 불가 = 지원 자격 미충족.
  //   경계값은 아래쪽 띠에 포함된다(정확히 +2.0이면 안정, 정확히 −0.7이면 소신).
  //   오차(±)는 판정을 바꾸지 않는다 — 화면에서 옆에만 적는다.
  const VERDICT_BANDS = Object.freeze([
    { key: 'safe', label: '안정', min: 2 },
    { key: 'fit', label: '적정', min: 0.7 },
    { key: 'reach', label: '소신', min: -0.7 },
    { key: 'stretch', label: '상향', min: -2 },
    { key: 'risky', label: '위험', min: -Infinity },
  ]);
  // 차이를 판정에 쓰는 자리수(소수 첫째 자리)로 맞춘다. 화면이 보여 주는 숫자와
  // 뱃지가 어긋나지 않도록, 반올림한 값 하나로 표시와 판정을 함께 한다.
  const VERDICT_DIGITS = 1;
  // 판정을 낼 수 없을 때 화면이 쓰는 두 개의 가짜 띠. 값이 아니라 상태를 말한다.
  const HOLD_BAND = Object.freeze({ key: 'hold', label: '보류' });
  const MISMATCH_BAND = Object.freeze({ key: 'mismatch', label: '기준 불일치' });

  // 컷의 **통계 정의**. scripts/build-data.mjs의 CUT_DEFS와 같은 표다(생성물에 def로 실린다).
  // 비교는 'ksi-mean' 눈금에서만 한다.
  // scale = 내 성적을 어떤 산식으로 만들어야 컷과 같은 눈금이 되는가. 같은 scale 끼리만 뺀다.
  //   ksi     (국어 + 수학 + 탐구2평균) / 3
  //   ksi1    (국어 + 수학 + 탐구 상위 1과목) / 3
  //   kor-inq (국어 + 탐구2평균) / 2
  //   top2    국어·수학·탐구2평균 중 상위 2개의 평균
  // comparable = 그 눈금의 값을 우리가 만들 수 있는가. 환산점수 눈금 컷만 false다.
  const CUT_DEFS = Object.freeze({
    'ksi-mean': { label: '국·수·탐(2) 백분위 단순평균', scale: 'ksi', comparable: true, approx: false },
    'subject-mean70': { label: '과목별 70%컷의 국·수·탐 산술평균', scale: 'ksi', comparable: true, approx: true },
    'top2-mean': { label: '국·수·탐(2) 중 상위 2개 영역 백분위 평균', scale: 'top2', comparable: true, approx: false },
    'kor-inq-mean': { label: '국·탐 2영역 백분위 평균(수학 미반영)', scale: 'kor-inq', comparable: true, approx: false },
    'ksi1-mean': { label: '국·수·탐(상위 1과목) 백분위 평균', scale: 'ksi1', comparable: true, approx: false },
    // 환산점수 눈금으로만 공개된 컷. 백분위로 되돌릴 수 없어 계산 자체가 불가능하다.
    'score': { label: '대학 환산점수', scale: 'score', comparable: false, approx: false },
  });
  const COMPARE_BASIS = 'ksi-mean';
  const cutDefInfo = (key) => CUT_DEFS[key] || CUT_DEFS[COMPARE_BASIS];
  const cutScale = (key) => cutDefInfo(key).scale;
  // 눈금별로 어떤 영역이 필요한가. 없는 영역이 있으면 그 눈금의 값을 만들 수 없다.
  const SCALE_NEEDS = Object.freeze({
    ksi: ['kor', 'math', 'inq'], ksi1: ['kor', 'math', 'inq'],
    'kor-inq': ['kor', 'inq'], top2: ['kor', 'math', 'inq'],
  });
  // 수시(내신 등급) 판정 띠. 값은 "컷 등급 − 내 등급" (등급, 클수록 유리).
  const SUSI_BANDS = Object.freeze([
    { key: 'safe', label: '안정', min: 0.3 },
    { key: 'fit', label: '적정', min: 0.1 },
    { key: 'reach', label: '소신', min: -0.1 },
    { key: 'stretch', label: '상향', min: -0.3 },
    { key: 'risky', label: '위험', min: -Infinity },
  ]);
  // '적정' 판정을 목표로 삼을 때의 여유 (점). 목표 학과 계산이 이 값을 더한다.
  const TARGET_MARGIN = 0.7;

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const round = (value, digits = 1) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  };
  const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

  function gradeFromPercentile(pct) {
    if (!isNumber(pct)) return null;
    const index = GRADE_FLOORS.findIndex((floor) => pct >= floor);
    return index === -1 ? 9 : index + 1;
  }
  function percentileFromGrade(grade) {
    const index = clamp(Math.round(Number(grade)) - 1, 0, 8);
    return GRADE_MIDPOINTS[index];
  }
  // 등급 n의 백분위 하한 — "몇 등급까지 올려야 하나"를 말할 때 그 등급의 문턱이다.
  function percentileFloorOfGrade(grade) {
    return GRADE_FLOORS[clamp(Math.round(Number(grade)) - 1, 0, 8)];
  }
  function gradeFromRaw(raw, floors) {
    if (!isNumber(raw)) return null;
    const index = floors.findIndex((floor) => raw >= floor);
    return index === -1 ? 9 : index + 1;
  }

  // 원점수 → 백분위. 등급컷 표(등급별 원점수·백분위 점)를 선형 보간한다.
  // 표의 점 사이는 실제 분포와 다를 수 있으므로 호출자는 '추정'이라 표시한다.
  function percentileFromRaw(raw, gradeRows) {
    if (!isNumber(raw) || !Array.isArray(gradeRows) || gradeRows.length === 0) return null;
    const points = gradeRows
      .filter((row) => isNumber(row.raw) && isNumber(row.pct))
      .map((row) => ({ raw: row.raw, pct: row.pct }))
      .sort((left, right) => right.raw - left.raw);
    if (points.length === 0) return null;
    const max = points[0];
    if (raw >= max.raw) {
      // 1등급 컷 위쪽: 만점(백분위 100)까지 선형.
      const span = 100 - max.raw;
      if (span <= 0) return 100;
      return round(max.pct + (100 - max.pct) * ((raw - max.raw) / span), 1);
    }
    for (let index = 0; index < points.length - 1; index += 1) {
      const upper = points[index];
      const lower = points[index + 1];
      if (raw >= lower.raw) {
        const ratio = (raw - lower.raw) / (upper.raw - lower.raw || 1);
        return round(lower.pct + (upper.pct - lower.pct) * ratio, 1);
      }
    }
    const last = points[points.length - 1];
    return round(clamp(last.pct * (raw / (last.raw || 1)), 0, last.pct), 1);
  }

  const inquiryKind = (subject) => {
    if (SCIENCE_SUBJECTS.includes(subject)) return 'science';
    if (SOCIAL_SUBJECTS.includes(subject)) return 'social';
    return null;
  };

  // 화면 입력(문자열 섞임)을 정규화한 프로필로 만든다. 비어 있는 영역은 null이다.
  // scales는 원점수 입력을 백분위로 바꿀 때만 필요하다 (scales.exams[year].subjects[key].grades).
  function normalizeProfile(input, scales, std) {
    const source = input || {};
    const mode = ['pct', 'grade', 'raw', 'std'].includes(source.mode) ? source.mode : 'pct';
    const year = String(source.year || (scales && Object.keys(scales.exams || {}).sort().at(-1)) || '');
    const table = scales?.exams?.[year]?.subjects || {};
    const toNumber = (value) => {
      if (value === '' || value === null || value === undefined) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    // 표준점수 입력은 여기서 백분위로 바뀌어 나머지 화면과 같은 길을 간다.
    // 도수분포(std)가 있으면 평가원 원자료 그대로, 없으면 등급컷 표준점수만으로 선형 보간한다.
    const stdReads = {};
    const relative = (value, subjectKey, stdKey) => {
      const number = toNumber(value);
      if (number === null) return null;
      if (mode === 'grade') return percentileFromGrade(clamp(number, 1, 9));
      if (mode === 'raw') {
        const rows = table[subjectKey]?.grades;
        const pct = percentileFromRaw(clamp(number, 0, 100), rows);
        return pct === null ? null : pct;
      }
      if (mode === 'std') {
        const read = percentileFromStd(stdKey, number, std);
        if (read) { stdReads[stdKey] = read; return read.pct; }
        // 도수분포가 없는 과목: 등급컷 표(표준점수·백분위)만으로 보간하고 '근사'로 남긴다.
        const rows = (table[subjectKey]?.grades || []).filter((row) => isNumber(row.std) && isNumber(row.pct));
        const pct = percentileFromRaw(number, rows.map((row) => ({ raw: row.std, pct: row.pct })));
        if (pct === null) return null;
        stdReads[stdKey] = { subject: stdKey, pct, grade: null, exact: false, count: 0, fallback: true };
        return pct;
      }
      return clamp(number, 0, 100);
    };
    const absolute = (value, floors) => {
      const number = toNumber(value);
      if (number === null) return null;
      if (mode === 'raw') return gradeFromRaw(number, floors);
      return clamp(Math.round(number), 1, 9);
    };
    const korElective = KOR_ELECTIVES.includes(source.korElective) ? source.korElective : KOR_ELECTIVES[0];
    const mathElective = MATH_ELECTIVES.includes(source.mathElective) ? source.mathElective : MATH_ELECTIVES[0];
    const korPct = relative(source.kor, `국어-${korElective}`, '국어');
    const mathPct = relative(source.math, `수학-${mathElective}`, '수학');
    const inquiries = [];
    for (const slot of ['inq1', 'inq2']) {
      const subject = source[`${slot}Subject`];
      const kind = inquiryKind(subject);
      const pct = kind ? relative(source[slot], `탐구-${subject}`, `탐구-${subject}`) : null;
      if (kind && pct !== null) {
        inquiries.push({ slot, subject, kind, pct, std: mode === 'std' ? toNumber(source[slot]) : null, read: stdReads[`탐구-${subject}`] || null });
      }
    }
    const gpa = toNumber(source.gpa);
    // 성적 출처(§4). 실제 수능이 아니면 결과에 '모의'·'목표' 뱃지가 붙는다. 기본값은 mock(수능 전).
    const sourceKind = ['actual', 'mock', 'target'].includes(source.sourceKind) ? source.sourceKind : 'mock';
    return {
      mode,
      sourceKind,
      year,
      kor: { elective: korElective, pct: korPct, std: mode === 'std' ? toNumber(source.kor) : null, read: stdReads['국어'] || null },
      math: { elective: mathElective, pct: mathPct, std: mode === 'std' ? toNumber(source.math) : null, read: stdReads['수학'] || null },
      eng: { grade: absolute(source.eng, ENGLISH_RAW_FLOORS) },
      hist: { grade: absolute(source.hist, HISTORY_RAW_FLOORS) },
      inquiries,
      gpa: gpa === null ? null : clamp(gpa, 1, 9),
      stdReads,
    };
  }

  const profileComplete = (profile) => Boolean(profile
    && isNumber(profile.kor?.pct) && isNumber(profile.math?.pct) && profile.inquiries?.length > 0);

  // 탐구 반영값: count=2면 두 과목 평균(한 과목뿐이면 그 과목), count=1이면 상위 1과목.
  function inquiryPercentile(profile, count = 2) {
    const sorted = [...(profile.inquiries || [])].sort((left, right) => right.pct - left.pct);
    if (sorted.length === 0) return null;
    const used = sorted.slice(0, Math.max(1, count));
    return used.reduce((sum, row) => sum + row.pct, 0) / used.length;
  }

  // 어디가 백분위 평균(국·수·탐(2) 평균)과 같은 단순 지표. 대학 반영비율을 적용하기 전의 기준값.
  function simpleAverage(profile) {
    if (!profileComplete(profile)) return null;
    return round((profile.kor.pct + profile.math.pct + inquiryPercentile(profile, 2)) / 3, 2);
  }

  // 등급 하나가 덮는 백분위 구간. 상대평가 등급 경계(1등급 상위 4% …)는 제도가 고정한 값이라
  // 이 폭은 지어낸 범위가 아니다 — 등급만 받은 성적이 실제로 놓일 수 있는 전 구간이다.
  function percentileRangeOfGrade(grade) {
    const index = clamp(Math.round(Number(grade)) - 1, 0, 8);
    return { min: GRADE_FLOORS[index], max: index === 0 ? 100 : GRADE_FLOORS[index - 1] - 1 };
  }

  // 영역별 값 세 벌. 어떤 눈금이든 이 셋(국어·수학·탐구)에서 만든다.
  //   inq2 = 탐구 상위 2과목 평균(한 과목뿐이면 그 과목) · inq1 = 탐구 상위 1과목
  function areaValues(profile) {
    const rows = [...(profile?.inquiries || [])].sort((left, right) => right.pct - left.pct).slice(0, 2);
    if (rows.length === 0) return { kor: profile?.kor?.pct ?? null, math: profile?.math?.pct ?? null, inq2: null, inq1: null, rows };
    return {
      kor: profile?.kor?.pct ?? null,
      math: profile?.math?.pct ?? null,
      inq2: rows.reduce((sum, row) => sum + row.pct, 0) / rows.length,
      inq1: rows[0].pct,
      rows,
    };
  }
  // 눈금 하나의 산식. 인자는 이미 영역값으로 정리된 숫자들이다.
  function scaleValue(scale, kor, math, inq2, inq1) {
    if (scale === 'kor-inq') return (kor + inq2) / 2;
    if (scale === 'ksi1') return (kor + math + inq1) / 3;
    if (scale === 'top2') {
      const areas = [kor, math, inq2].sort((left, right) => right - left);
      return (areas[0] + areas[1]) / 2;
    }
    return (kor + math + inq2) / 3;
  }
  // 이 눈금을 만들려면 있어야 하는데 없는 영역. 비면 계산할 수 있다.
  function missingFor(profile, def = COMPARE_BASIS) {
    const info = cutDefInfo(def);
    if (!info.comparable) return ['환산점수'];
    const needs = SCALE_NEEDS[info.scale] || SCALE_NEEDS.ksi;
    const out = [];
    if (needs.includes('kor') && !isNumber(profile?.kor?.pct)) out.push('국어');
    if (needs.includes('math') && !isNumber(profile?.math?.pct)) out.push('수학');
    if (needs.includes('inq') && !(profile?.inquiries?.length > 0)) out.push('탐구');
    return out;
  }

  // 등급 입력 프로필의 비교값이 놓일 수 있는 구간. 산식이 영역마다 단조증가라
  // 하한은 영역 하한들로, 상한은 영역 상한들로 만든다(상위 n개 고르기도 단조증가다).
  function gradeBounds(profile, def = COMPARE_BASIS) {
    const scale = cutScale(def);
    const rangeOf = (pct) => (isNumber(pct) ? percentileRangeOfGrade(gradeFromPercentile(pct)) : null);
    const kor = rangeOf(profile?.kor?.pct);
    const math = rangeOf(profile?.math?.pct);
    const rows = [...(profile?.inquiries || [])].sort((left, right) => right.pct - left.pct).slice(0, 2).map((row) => rangeOf(row.pct));
    if (rows.length === 0 || !kor) return null;
    if ((SCALE_NEEDS[scale] || SCALE_NEEDS.ksi).includes('math') && !math) return null;
    const low = {
      kor: kor.min, math: math ? math.min : 0,
      inq2: rows.reduce((sum, row) => sum + row.min, 0) / rows.length,
      inq1: Math.max(...rows.map((row) => row.min)),
    };
    const high = {
      kor: kor.max, math: math ? math.max : 0,
      inq2: rows.reduce((sum, row) => sum + row.max, 0) / rows.length,
      inq1: Math.max(...rows.map((row) => row.max)),
    };
    return {
      min: round(scaleValue(scale, low.kor, low.math, low.inq2, low.inq1), 2),
      max: round(scaleValue(scale, high.kor, high.math, high.inq2, high.inq1), 2),
    };
  }

  // 판정에 쓰는 **비교값**. 컷의 통계 정의(def)를 받아 **그 정의 그대로** 내 성적을 계산한다.
  //   value      : 컷에서 뺄 수 있는 값 (같은 눈금)
  //   estimated  : 등급·원점수 입력이라 대표값을 가정한 경우 true
  //   bounds     : 등급 입력일 때 값이 놓일 수 있는 구간(등급 경계에서 나온다)
  //   assumptions: 무엇을 무엇으로 가정했는지 (화면이 값만 그대로 적는다)
  // 필요한 영역이 없으면 null이다 — 정의가 다르다는 이유로는 null이 되지 않는다.
  function comparableScore(profile, def = COMPARE_BASIS) {
    if (!profile) return null;
    if (missingFor(profile, def).length > 0) return null;
    const info = cutDefInfo(def);
    const scale = info.scale;
    const mode = profile.mode || 'pct';
    const area = areaValues(profile);
    const value = round(scaleValue(scale, area.kor, area.math, area.inq2, area.inq1), 2);
    const assumptions = [];
    if (mode === 'grade') {
      // 등급 → 그 등급 구간의 **중앙 백분위**. 화면이 값만 적을 수 있게 짧게 남긴다.
      const say = (label, pct) => {
        if (!isNumber(pct)) return;
        assumptions.push(`${label} ${gradeFromPercentile(pct)}등급 ${round(pct, 1)}`);
      };
      say('국어', profile.kor?.pct);
      if (scale !== 'kor-inq') say('수학', profile.math?.pct);
      for (const row of area.rows.slice(0, scale === 'ksi1' ? 1 : 2)) say(`탐구 ${row.subject}`, row.pct);
    } else if (mode === 'raw') {
      assumptions.push('원점수 → 백분위 추정');
    }
    return {
      basis: def,
      def,
      scale,
      label: info.label,
      value,
      mode,
      estimated: mode === 'grade' || mode === 'raw',
      bounds: mode === 'grade' ? gradeBounds(profile, def) : null,
      assumptions,
    };
  }

  // 이 눈금에서 영역 하나가 차지하는 몫(합이 1). 목표 화면의 '필요한 상승'이 쓴다.
  // 반영하지 않는 영역은 0이라 화면에 나오지 않는다(예체능 국·탐 눈금의 수학).
  function scaleShares(def, profile) {
    const scale = cutScale(def);
    const area = areaValues(profile);
    const count = Math.max(1, area.rows.length);
    if (scale === 'kor-inq') return { kor: 1 / 2, math: 0, inq: (1 / 2) / count, inqUse: count };
    if (scale === 'ksi1') return { kor: 1 / 3, math: 1 / 3, inq: 1 / 3, inqUse: 1 };
    if (scale === 'top2') {
      const ranked = [['kor', area.kor], ['math', area.math], ['inq', area.inq2]]
        .filter(([, pct]) => isNumber(pct)).sort((left, right) => right[1] - left[1]).slice(0, 2).map(([key]) => key);
      return {
        kor: ranked.includes('kor') ? 1 / 2 : 0,
        math: ranked.includes('math') ? 1 / 2 : 0,
        inq: ranked.includes('inq') ? (1 / 2) / count : 0,
        inqUse: count,
      };
    }
    return { kor: 1 / 3, math: 1 / 3, inq: (1 / 3) / count, inqUse: count };
  }

  // rules[uni].tracks 중 모집단위 계열에 맞는 트랙. 'appliesTo'/name에 계열 이름이 들어 있으면 그것,
  // 없으면 첫 트랙. 의약·자유전공은 자연 → 인문 순으로 대체한다.
  function pickTrack(rule, track, ruleTrack) {
    const tracks = Array.isArray(rule?.tracks) ? rule.tracks : [];
    if (tracks.length === 0) return null;
    const wanted = [];
    if (ruleTrack) wanted.push(ruleTrack);
    wanted.push(track);
    if (track === '상경') wanted.push('인문');
    if (track === '의약') wanted.push('자연');
    if (track === '자유전공') wanted.push('인문', '자연');
    if (track === '예체능') wanted.push('인문');
    for (const name of wanted) {
      const exact = tracks.find((candidate) => candidate.name === name);
      if (exact) return exact;
      const loose = tracks.find((candidate) => String(candidate.name || '').includes(name) || String(candidate.appliesTo || '').includes(name));
      if (loose) return loose;
    }
    return tracks[0];
  }

  const englishTable = (english) => {
    const table = english?.table || {};
    const rows = {};
    for (let grade = 1; grade <= 9; grade += 1) {
      const value = table[String(grade)] ?? table[grade];
      rows[grade] = isNumber(Number(value)) && value !== null && value !== undefined ? Number(value) : null;
    }
    return rows;
  };

  // 가감점(점)을 백분위 평균 단위로 바꾼다. total = 대학 환산 총점(가감점이 붙는 기준 총점).
  const pointsToPercentile = (points, total) => (isNumber(points) && isNumber(total) && total > 0 ? (points / total) * 100 : 0);

  // 대학 반영 방법을 프로필에 적용한 값. 결과 단위는 백분위 평균(0~100)이다.
  //   weighted: 국·수·탐(·영어 비율반영) 가중 평균
  //   adjustments: 영어/한국사 가감, 선택과목 가산·불이익을 백분위 단위로 바꾼 항목들
  //   value: weighted + Σ adjustments
  //   shares: 영역별 가중치 비율(합 1) — 목표 학과의 "1점 올리면 얼마" 계산이 쓴다
  function universityScore(profile, rule, deptTrack, ruleTrack) {
    if (!profileComplete(profile)) return null;
    const track = pickTrack(rule, deptTrack, ruleTrack);
    const weights = { ...(track?.weights || {}) };
    const inquiryCount = Number(track?.inquiry?.count) || 2;
    const inqPct = inquiryPercentile(profile, inquiryCount);
    const engRows = englishTable(track?.english);
    const engGrade = profile.eng.grade;
    // 영어 등급을 다른 영역과 견줄 수 있는 0~100 값으로. 1등급 배점을 100으로 본 비율이다.
    const engPct = (() => {
      if (!isNumber(engGrade)) return null;
      const top = engRows[1];
      const mine = engRows[engGrade];
      if (isNumber(top) && top > 0 && isNumber(mine)) return clamp(mine / top, 0, 1) * 100;
      return engGrade === 1 ? 100 : null;
    })();
    // '우수한 영역 순' 반영: 그룹 안의 영역을 내 점수 순으로 줄 세워 큰 가중치부터 준다.
    // 영어도 그룹에 들어갈 수 있다(가천대 정시: 영어·탐구 중 우수한 순 20:10).
    const bestOfNotes = [];
    for (const group of Array.isArray(track?.bestOf) ? track.bestOf : []) {
      const current = { kor: profile.kor.pct, math: profile.math.pct, inq: inqPct, eng: engPct };
      const ordered = (group.areas || []).filter((area) => isNumber(current[area])).sort((a, b) => current[b] - current[a]);
      const sortedWeights = [...(group.weights || [])].sort((a, b) => b - a);
      ordered.forEach((area, index) => { weights[area] = (Number(weights[area]) || 0) + (Number(sortedWeights[index]) || 0); });
      bestOfNotes.push(`${ordered.map((area) => SUBJECT_LABEL[area]).join(' > ')} 순 ${sortedWeights.join('·')}`);
    }
    const wKor = Number(weights.kor) || 0;
    const wMath = Number(weights.math) || 0;
    const wInq = Number(weights.inq) || 0;
    const wEng = Number(weights.eng) || 0;
    const unit = track?.unit === 'points' ? 'points' : 'percent';
    const englishMethod = track?.english?.method || (wEng > 0 ? '비율반영' : '가산');
    const englishByRatio = wEng > 0 && englishMethod === '비율반영';

    // 반영비율이 하나도 없으면(규칙 미확인) 단순 평균으로 대체하고 그렇게 표시한다.
    const hasWeights = wKor + wMath + wInq > 0;
    const parts = hasWeights
      ? [
        { key: 'kor', weight: wKor, pct: profile.kor.pct },
        { key: 'math', weight: wMath, pct: profile.math.pct },
        { key: 'inq', weight: wInq, pct: inqPct },
      ]
      : [
        { key: 'kor', weight: 1, pct: profile.kor.pct },
        { key: 'math', weight: 1, pct: profile.math.pct },
        { key: 'inq', weight: 1, pct: inqPct },
      ];
    if (englishByRatio && isNumber(engPct)) parts.push({ key: 'eng', weight: wEng, pct: engPct });
    const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
    const shares = {};
    for (const part of parts) shares[part.key] = part.weight / totalWeight;
    const weighted = parts.reduce((sum, part) => sum + part.weight * part.pct, 0) / totalWeight;

    // 가감점의 기준 총점: points 단위면 반영 영역 배점 합(영어 비율반영이면 포함), percent 단위면
    // 규칙이 준 total, 없으면 1000점 만점으로 본다 (대부분의 대학이 1000점 환산이다).
    const baseTotal = unit === 'points'
      ? parts.reduce((sum, part) => sum + part.weight, 0)
      : (Number(track?.total) || 1000);

    const adjustments = [];
    if (!englishByRatio && isNumber(engGrade)) {
      const top = engRows[1];
      const mine = engRows[engGrade];
      if (isNumber(top) && isNumber(mine) && mine !== top) {
        const delta = pointsToPercentile(mine - top, track?.english?.total || baseTotal);
        adjustments.push({ key: 'eng', label: `영어 ${engGrade}등급 ${englishMethod === '감산' ? '감점' : '가산 차이'}`, delta: round(delta, 2) });
      }
    }
    const histGrade = profile.hist.grade;
    const histRows = englishTable(track?.history);
    if (isNumber(histGrade) && isNumber(histRows[1]) && isNumber(histRows[histGrade]) && histRows[histGrade] !== histRows[1]) {
      const delta = pointsToPercentile(histRows[histGrade] - histRows[1], track?.history?.total || baseTotal);
      adjustments.push({ key: 'hist', label: `한국사 ${histGrade}등급 가감`, delta: round(delta, 2) });
    }

    // 탐구 선택과목: 자연계 모집단위의 과탐 가산은 등록자 대부분이 받았다고 보고, 사탐 응시자에게
    // 그만큼의 불이익으로 적는다. 인문계 사탐 가산도 같은 논리로 대칭 처리한다.
    const inquiry = track?.inquiry || {};
    const scienceBonus = Number(inquiry.scienceBonus) || 0;
    const socialBonus = Number(inquiry.socialBonus) || 0;
    const kinds = new Set((profile.inquiries || []).map((row) => row.kind));
    const inqShare = shares.inq || 0;
    const naturalDept = ['자연', '의약'].includes(deptTrack);
    const blockers = [];
    if (scienceBonus > 0 && isNumber(inqPct)) {
      if (kinds.has('social') && !kinds.has('science')) {
        adjustments.push({ key: 'inq-science', label: `과탐 가산 ${round(scienceBonus * 100)}% 미적용(사탐 응시)`, delta: round(-scienceBonus * inqShare * inqPct, 2) });
      } else if (kinds.has('social') && kinds.has('science')) {
        adjustments.push({ key: 'inq-science', label: `과탐 가산 ${round(scienceBonus * 100)}% 한 과목만`, delta: round(-scienceBonus * inqShare * inqPct * 0.5, 2) });
      }
    }
    if (socialBonus > 0 && isNumber(inqPct) && !kinds.has('social')) {
      adjustments.push({ key: 'inq-social', label: `사탐 가산 ${round(socialBonus * 100)}% 미적용(과탐 응시)`, delta: round(-socialBonus * inqShare * inqPct, 2) });
    }
    if (inquiry.allowed === '과탐만' && naturalDept && !kinds.has('science')) {
      blockers.push('과탐 필수 모집단위 — 사탐만으로는 지원 불가');
    }
    const mathBonus = Number(track?.mathBonus) || 0;
    const mathElective = profile.math.elective;
    const mathAdvanced = mathElective === '미적분' || mathElective === '기하';
    if (mathBonus > 0 && !mathAdvanced) {
      adjustments.push({ key: 'math-elective', label: `미적분·기하 가산 ${round(mathBonus * 100)}% 미적용(확률과통계)`, delta: round(-mathBonus * (shares.math || 0) * profile.math.pct, 2) });
    }
    if (String(track?.mathRequirement || '').includes('필수') && !mathAdvanced) {
      blockers.push('미적분·기하 필수 모집단위 — 확률과통계로는 지원 불가');
    }

    const totalAdjustment = adjustments.reduce((sum, row) => sum + row.delta, 0);
    return {
      track: track?.name || null,
      trackFound: Boolean(track),
      hasWeights,
      shares,
      weighted: round(weighted, 2),
      adjustments,
      blockers,
      value: round(weighted + totalAdjustment, 2),
      bestOfNotes,
      inquiryCount,
      englishByRatio,
      engRows,
      baseTotal,
    };
  }


  // ---------------------------------------------------------------- 표준점수
  // std = source/std-2026.json (생성물에서는 data.std). 평가원 도수분포 원자료다.
  //   subjects['국어' | '수학' | '탐구-생활과윤리' …] = { n, maxStd, gradeCuts[8], rows }
  //   rows = [표준점수, 인원, 백분위] 내림차순. 백분위는 평가원 정의
  //     (해당 표준점수 미만 인원 + 동점 인원의 1/2) ÷ 전체 × 100, 반올림 — 을 미리 계산해 둔 값이다.
  // 국어·수학의 백분위는 선택과목이 아니라 영역 전체에서 매겨진다 — 그래서 키에 선택과목이 없다.
  const stdKeyOf = (area, subject) => (area === 'inq' ? `탐구-${subject}` : area === 'kor' ? '국어' : '수학');

  function gradeFromStd(value, cuts) {
    if (!isNumber(value) || !Array.isArray(cuts)) return null;
    for (let index = 0; index < cuts.length; index += 1) {
      if (isNumber(cuts[index]) && value >= cuts[index]) return index + 1;
    }
    return cuts.length + 1;
  }

  // 표준점수 하나 → { pct, grade, exact }. 표에 있는 점수면 exact:true(원자료 그대로),
  // 표에 없으면 이웃한 두 점을 선형 보간하고 exact:false로 알린다(화면이 '근사'라고 적는다).
  function percentileFromStd(subjectKey, value, std) {
    const subject = std?.subjects?.[subjectKey];
    const score = Number(value);
    if (!subject || !Number.isFinite(score)) return null;
    const rows = subject.rows || [];
    if (rows.length === 0) return null;
    const grade = gradeFromStd(score, subject.gradeCuts);
    const hit = rows.find((row) => row[0] === score);
    if (hit) return { subject: subjectKey, pct: hit[2], grade, exact: true, count: hit[1] };
    if (score >= rows[0][0]) return { subject: subjectKey, pct: rows[0][2], grade, exact: false, count: 0 };
    const last = rows[rows.length - 1];
    if (score <= last[0]) return { subject: subjectKey, pct: last[2], grade, exact: false, count: 0 };
    for (let index = 0; index < rows.length - 1; index += 1) {
      const upper = rows[index];
      const lower = rows[index + 1];
      if (score < upper[0] && score > lower[0]) {
        const ratio = (score - lower[0]) / (upper[0] - lower[0]);
        return { subject: subjectKey, pct: round(lower[2] + (upper[2] - lower[2]) * ratio, 1), grade, exact: false, count: 0 };
      }
    }
    return null;
  }

  // 탐구 변환표준점수 표. 입학처가 낸 표가 있으면 그것(kind 'official'), 없으면
  // 17개 사탐·과탐 도수분포를 합쳐 만든 통합 근사표(kind 'approx')를 쓴다.
  // 사탐·과탐 표를 따로 낸 대학은 universities[id].tables = { social, science } 로 싣는다.
  // 그 경우 table 은 대표 표(사탐 → 과탐 순으로 있는 것)라서 최고점 같은 대학 단위 값에 쓴다.
  function conversionTable(conv, universityId) {
    const official = conv?.universities?.[universityId];
    const split = official?.tables && typeof official.tables === 'object' ? official.tables : null;
    const table = official?.table || split?.social || split?.science || null;
    if (table) {
      return { kind: 'official', table, tables: split, name: official.name, note: official.note, source: official.source, formula: official.formula || null };
    }
    if (conv?.approx?.table) return { kind: 'approx', table: conv.approx.table, tables: null, note: conv.approx.note, source: null, formula: null };
    return null;
  }
  // 백분위 → 변환표준점수. 표는 백분위 0~100 한 칸마다 값이 있고, 사이는 선형 보간한다.
  function convertedStd(pct, table) {
    if (!table || !isNumber(pct)) return null;
    const low = Math.floor(clamp(pct, 0, 100));
    const high = Math.min(100, low + 1);
    const lowValue = Number(table[String(low)]);
    if (!Number.isFinite(lowValue)) return null;
    const highValue = Number(table[String(high)]);
    if (!Number.isFinite(highValue) || high === low) return round(lowValue, 4);
    return round(lowValue + (highValue - lowValue) * (pct - low), 4);
  }

  // ------------------------------------------------- §1.3 백분위 → 표준점수 되읽기
  // 도수분포는 표준점수 → 백분위 한 방향으로 만들어져 있다. 되읽기는 **표에 있는 값만** 쓴다:
  // 그 백분위를 가진 표준점수가 여럿이면 최소~최대가 결과다. 하나도 없으면 이웃 백분위까지
  // 넓히고 interpolated:true 를 남긴다 — 표에 없는 조합을 지어내지 않는다.
  // target: '국어' · '수학' · '탐구-생활과윤리' 같은 과목 키, 또는 'social'/'science'(탐구 종류).
  const SOCIAL_KEYS = Object.freeze(SOCIAL_SUBJECTS.map((name) => `탐구-${name}`));
  const SCIENCE_KEYS = Object.freeze(SCIENCE_SUBJECTS.map((name) => `탐구-${name}`));

  function stdSubjectKeys(std, target) {
    const has = (key) => Boolean(std?.subjects?.[key]?.rows?.length);
    if (!target) return [];
    if (target === 'social') return SOCIAL_KEYS.filter(has);
    if (target === 'science') return SCIENCE_KEYS.filter(has);
    if (target === 'inq' || target === '탐구') return [...SOCIAL_KEYS, ...SCIENCE_KEYS].filter(has);
    return has(target) ? [target] : [];
  }

  function stdRangeFromPercentile(std, target, pct) {
    const keys = stdSubjectKeys(std, target);
    if (keys.length === 0 || !isNumber(Number(pct))) return null;
    const want = clamp(Math.round(Number(pct)), 0, 100);
    const scan = (value) => {
      let min = null;
      let max = null;
      const subjects = [];
      for (const key of keys) {
        for (const row of std.subjects[key].rows || []) {
          if (row[2] !== value) continue;
          min = min === null ? row[0] : Math.min(min, row[0]);
          max = max === null ? row[0] : Math.max(max, row[0]);
          if (!subjects.includes(key)) subjects.push(key);
        }
      }
      return min === null ? null : { min, max, subjects };
    };
    const hit = scan(want);
    if (hit) {
      return { min: hit.min, max: hit.max, mid: round((hit.min + hit.max) / 2, 2), pct: want, exact: true, interpolated: false, subjects: hit.subjects };
    }
    for (let radius = 1; radius <= 6; radius += 1) {
      const low = want - radius >= 0 ? scan(want - radius) : null;
      const high = want + radius <= 100 ? scan(want + radius) : null;
      if (!low && !high) continue;
      const min = low ? low.min : high.min;
      const max = high ? high.max : low.max;
      const subjects = [...new Set([...(low?.subjects || []), ...(high?.subjects || [])])];
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      return { min: lo, max: hi, mid: round((lo + hi) / 2, 2), pct: want, exact: false, interpolated: true, subjects };
    }
    return null;
  }

  // ------------------------------------------------- §1.2 산식 채점기
  // 트랙 하나(rules-<year>.json tracks[])를 그대로 계산한다.
  //   점수 = (Σ 영역값 × factor) × multiply ÷ divide − 한국사 감점, roundTo 자리 반올림.
  // inputs 는 영역별 **구간**이다: { std, stdMin, stdMax, pct, pctMin, pctMax, kind }.
  // 구간이 있으면 결과도 { value(중앙), min, max } 다 — 산식이 영역마다 단조증가라 끝점끼리 짝지으면 된다.
  // 영역 순서는 옛 산출식 계산과 같게 둔다(부동소수 합의 순서까지 같아야 재현 값이 흔들리지 않는다).
  // 국·수·영·탐은 scale 안에서 더하고, 한국사는 **scale 뒤** 총점에 붙는다(§1.2 · 항공대 요강
  // 산출 예시 「영역별 점수 합계 × 5 + 한국사 가산점」이 그 순서를 못박는다). 영어도 mode 가
  // penalty·bonus 면 배점이 아니라 총점 가감이라 scale 뒤로 간다(충남대·서강대).
  const AREA_ORDER = Object.freeze(['kor', 'math', 'eng', 'inq', 'hist']);
  const SCORED_AREAS = Object.freeze(['kor', 'math', 'eng', 'inq']);

  // null 은 '없다'다 — Number(null) 이 0 이라 그냥 Number.isFinite 로 재면 배점 없는 칸이 0으로 변한다
  // (경기대 round:null 이 반올림 자리 0으로 읽혀 소수점이 통째로 날아갔다).
  const numOr = (value, fallback) => (
    value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value)
  );
  const truncate = (value, digits) => {
    const factor = 10 ** digits;
    return Math.trunc(value * factor) / factor;
  };

  const bonusList = (config) => {
    const raw = config?.bonuses || config?.bonus || null;
    if (!raw) return [];
    return (Array.isArray(raw) ? raw : [raw]).filter((row) => row && (Number(row.rate) || row.flat !== undefined));
  };

  // 가산 한 줄을 한 모양으로 읽는다 — 등록자가 kind/type/electives, rate/flat, per/requireBoth 를
  // 요강 문장에 맞춰 섞어 썼다(part-b.json _note). 여기서 정규화하고, 모집단위 조건(except·appliesTo)
  // 처럼 이 자리에서 판정할 수 없는 단서는 limited 로 남겨 결과 notes 에 싣는다.
  function normalizeBonus(entry) {
    if (!entry) return null;
    const rate = Number(entry.rate);
    const flat = entry.flat === undefined ? null : entry.flat;
    if (!Number.isFinite(rate) && flat === null) return null;
    const type = entry.type || null;
    let kind = entry.kind || null;
    let electives = Array.isArray(entry.electives) ? entry.electives : null;
    if (type === 'calcGeo') electives = electives || ['미적분', '기하'];
    else if (type === 'science' || type === 'social' || type === 'scienceII') kind = kind || (type === 'scienceII' ? 'science' : type);
    const requires = typeof entry.requires === 'string' ? entry.requires : null;
    const per = entry.per || 'subject';
    const requireBoth = entry.requireBoth === true || per === 'area' || (requires ? /2\s*과목/u.test(requires) : false);
    const limited = Array.isArray(entry.except) ? `제외 모집단위 ${entry.except.join('·')}` : (typeof entry.appliesTo === 'string' ? entry.appliesTo : null);
    return {
      kind, electives, type, requires, limited, per, requireBoth,
      rate: Number.isFinite(rate) ? rate : 0,
      flat,
      of: entry.of || (per === 'area' ? 'areaScore' : 'value'),
      // per:'subject' 면 과목마다, 그 밖(area·combination·requireBoth)이면 영역 전체에 건다.
      scope: per === 'subject' && !requireBoth ? 'subject' : 'area',
    };
  }

  function spanPick(span, metric, pick) {
    if (!span) return null;
    const three = metric === 'std'
      ? [span.stdMin, span.std, span.stdMax]
      : [span.pctMin, span.pct, span.pctMax];
    if (!isNumber(three[1])) return null;
    if (pick === 'min') return isNumber(three[0]) ? three[0] : three[1];
    if (pick === 'max') return isNumber(three[2]) ? three[2] : three[1];
    return three[1];
  }

  // metric: std · pct · conv(변환표준점수) · stdRatio·convRatio(비율 — 분모가 metric 이름에 들어 있다).
  // span.conv 가 있으면 표 대신 그 값을 쓴다(대학이 공개한 변환표준점수를 그대로 넣는 자리다).
  function areaMetricValue(config, span, pick, convTable) {
    const metric = config?.metric || 'std';
    if (metric === 'conv' || metric === 'convRatio') {
      if (isNumber(span?.conv)) return span.conv;
      const pct = spanPick(span, 'pct', pick);
      return pct === null ? null : convertedStd(pct, convTable);
    }
    if (metric === 'pct') return spanPick(span, 'pct', pick);
    return spanPick(span, 'std', pick);
  }

  // 영역값을 factor 앞에서 나누는 기준(§1.2 확장 필드). div 와 stdRatio·convRatio 는 같은 뜻의 축약형이다.
  function areaDenominatorSpec(config, key) {
    if (config?.denominator) return config.denominator;
    if (Number.isFinite(Number(config?.div))) return { kind: 'const', value: Number(config.div) };
    if (config?.metric === 'stdRatio') return { kind: 'maxStd', area: key, perSubject: key === 'inq' };
    if (config?.metric === 'convRatio') return { kind: 'maxConv', multiplier: 1 };
    return null;
  }

  // 전국 최고 표준점수 — std-<year>.json subjects[key].maxStd, 없으면 도수분포의 최댓값이다.
  function maxStdOfSubject(std, subjectKey) {
    const subject = std?.subjects?.[subjectKey];
    if (!subject) return null;
    if (isNumber(subject.maxStd)) return subject.maxStd;
    const rows = subject.rows || [];
    return rows.length > 0 ? Math.max(...rows.map((row) => row[0])) : null;
  }
  // 탐구는 과목마다 최고점이 다르다. 어디가 행처럼 **과목명을 모르면** 그 종류(사탐/과탐) 안에서
  // 최소~최대 최고점을 분모 후보로 잡는다(§1.3의 "표에 없는 조합은 만들지 않는다"와 같은 태도).
  // 분모가 작을수록 점수가 커지므로 상한(pick 'max')에는 가장 작은 최고점을 쓴다.
  function maxStdOfArea(std, area, subjectKey, options = {}) {
    if (area !== 'inq') return maxStdOfSubject(std, stdKeyOf(area));
    if (subjectKey) {
      const one = maxStdOfSubject(std, subjectKey);
      if (isNumber(one)) return one;
    }
    const values = stdSubjectKeys(std, options.kind || 'inq').map((key) => maxStdOfSubject(std, key)).filter(isNumber);
    if (values.length === 0) return null;
    if (options.pick === 'max') return Math.min(...values);
    return Math.max(...values);
  }

  const tableValue = (table, grade) => {
    if (!isNumber(Number(grade))) return null;
    const value = Number(table?.[String(grade)] ?? table?.[grade]);
    return Number.isFinite(value) ? value : null;
  };

  // 상위 n개 영역만 반영하는 규칙. bestOf{pool,factors} 와 optional{pick,of,weights|weight} 는
  // 같은 것을 두 가지로 적은 것이라 하나로 읽는다. factors 의 null 은 '그 영역의 원래 배점을 쓴다'다.
  function pickSpec(track) {
    const best = track?.bestOf;
    if (best && Array.isArray(best.pool) && best.pool.length > 1) {
      return { pool: best.pool, factors: Array.isArray(best.factors) ? best.factors : [] };
    }
    const optional = track?.optional;
    if (optional && Array.isArray(optional.of) && optional.of.length > 1) {
      const weight = Number.isFinite(Number(optional.weight)) ? Number(optional.weight) : null;
      if (optional.pick === 'rankedWeights' && Array.isArray(optional.weights)) return { pool: optional.of, factors: optional.weights };
      if (optional.pick === 'top2') return { pool: optional.of, factors: [weight, weight] };
      if (optional.pick === 'best') return { pool: optional.of, factors: [weight] };
    }
    return null;
  }

  // 채점 가능한 트랙인가. scale 이 **명시적 null** 이면 요강이 정규화 상수를 밝히지 않은 것이고
  // (성균관 variants·한양 denominator:null), 배점 없는 영역이 상위-n 규칙에도 안 걸리면 못 센다.
  const trackHasFormula = (track) => {
    if (!track) return false;
    if (Array.isArray(track.siblings) && track.siblings.length > 0) return track.siblings.some(trackHasFormula);
    const areas = track.areas || {};
    if (Object.keys(areas).length === 0) return false;
    if (track.scale === null) return false;
    const pool = pickSpec(track)?.pool || [];
    let scored = 0;
    for (const key of SCORED_AREAS) {
      const config = areas[key];
      if (!config || !(config.metric || config.mode)) continue;
      // 영어가 배점 없이 감점·가산만 하는 대학(고려·경희·서울대·가톨릭)은 factor 가 없어도 계산된다.
      const needsFactor = key !== 'eng' || !(config.mode === 'penalty' || config.mode === 'bonus');
      if (needsFactor && config.factor === null && !pool.includes(key)) return false;
      scored += 1;
    }
    return scored > 0;
  };

  // 지원 자격(§1.2 eligibility + 확장 필드 inq.allowed · math.restrict). 걸리면 점수는 내되 blockers 로 알린다.
  function trackBlockers(track, inputs) {
    const need = track?.eligibility || {};
    const out = [];
    const areas = track?.areas || {};
    const electives = Array.isArray(need.requiredElectives) ? need.requiredElectives
      : Array.isArray(areas.math?.restrict) ? areas.math.restrict : null;
    if (electives?.length > 0 && inputs?.mathElective && !electives.includes(inputs.mathElective)) {
      out.push(`${electives.join('·')} 필수 모집단위 — ${inputs.mathElective}로는 지원 불가`);
    }
    const kinds = new Set((inputs?.inq || []).map((row) => row.kind));
    if (need.requiredInquiryKind && !kinds.has(need.requiredInquiryKind)) {
      out.push(`${need.requiredInquiryKind === 'science' ? '과탐' : '사탐'} 필수 모집단위`);
    }
    if (areas.inq?.allowed === '과탐만' && kinds.size > 0 && !kinds.has('science')) out.push('과탐만 반영하는 모집단위');
    return out;
  }

  function formulaScore2(track, inputs, ctx = {}) {
    if (!track || !inputs) return null;
    // pickBest 형제 트랙(인하 A/B · 항공 산출1·2 · 이화 간호·약학)은 전부 채점하고 높은 쪽을 쓴다.
    const siblings = Array.isArray(track.siblings) ? track.siblings.filter(Boolean) : null;
    if (siblings && siblings.length > 1) {
      const scored = siblings
        .map((row) => ({ name: row.name || null, result: formulaScore2({ ...row, siblings: null }, inputs, ctx) }))
        .filter((row) => row.result);
      if (scored.length === 0) return null;
      const best = scored.reduce((top, row) => (row.result.value > top.result.value ? row : top), scored[0]);
      return {
        ...best.result,
        picked: { track: best.name, from: scored.map((row) => ({ track: row.name, value: row.result.value })) },
      };
    }

    const areas = track.areas || {};
    if (Object.keys(areas).length === 0) return null;
    if (track.scale === null) return null;
    const conversion = ctx.convTable
      ? { kind: ctx.convKind || 'approx', table: ctx.convTable, name: null, note: null, source: null }
      : conversionTable(ctx.conv, ctx.universityId ?? track.universityId ?? null);
    const convTable = conversion?.table || null;
    // 사탐·과탐 표를 따로 낸 대학은 과목 종류에 맞는 표를 쓴다. 없으면 대표 표 하나뿐이다.
    const convTableOf = (kind) => (kind && conversion?.tables?.[kind]) || convTable;
    const std = ctx.std || null;
    const maxConv = convTable ? convertedStd(100, convTable) : null;
    const roundTo = numOr(track.roundTo, numOr(track.round, 4));
    const scale = track.scale || {};
    const multiply = numOr(scale.multiply, 1);
    const divide = numOr(scale.divide, 1) || 1;
    const cap = numOr(track.cap, null);
    const picks = pickSpec(track);
    const flags = [];
    const notes = [];
    const addNote = (text) => { if (text && !notes.includes(text)) notes.push(text); };

    const denominatorOf = (spec, key, subjectKey, options = {}) => {
      if (!spec) return 1;
      if (spec.kind === 'const') return numOr(spec.value, 1) || 1;
      if (spec.kind === 'maxConv') {
        const top = options.kind ? convertedStd(100, convTableOf(options.kind)) : maxConv;
        if (!isNumber(top) || top === 0) return null;
        return top * (numOr(spec.multiplier, 1) || 1);
      }
      if (spec.kind === 'maxStd') {
        const value = maxStdOfArea(std, spec.area || key, subjectKey, options);
        return isNumber(value) && value !== 0 ? value : null;
      }
      return 1;
    };

    // --- 국어·수학 (한 값)
    const scalarArea = (key, pick) => {
      const config = areas[key];
      const raw = areaMetricValue(config, inputs[key], pick, convTable);
      if (raw === null) return null;
      const bonuses = bonusList(config).map(normalizeBonus).filter(Boolean);
      let value = raw;
      let areaRate = 0;
      for (const bonus of bonuses) {
        if (bonus.limited) addNote(`${SUBJECT_LABEL[key]} 가산 조건(${bonus.limited})은 모집단위 단위라 여기서는 적용하지 않았다`);
        if (Array.isArray(bonus.electives) && !bonus.electives.includes(inputs.mathElective)) continue;
        if (bonus.of === 'areaScore') areaRate += bonus.rate;
        else value *= 1 + bonus.rate;
      }
      const spec = areaDenominatorSpec(config, key);
      const denominator = denominatorOf(spec, key, null);
      if (denominator === null) return null;
      if (spec?.kind === 'maxConv' || config.metric === 'conv' || config.metric === 'convRatio') {
        if (conversion?.kind === 'approx' && !flags.includes('approx-conversion')) flags.push('approx-conversion');
      }
      const offset = numOr(config.offset, 0);
      const factor = numOr(config.factor, config.factor === null ? null : 1);
      const points = (numOr(config.base, 0) + ((value + offset) / denominator) * (factor ?? 1)) * (1 + areaRate);
      return { key, value: (value + offset) / denominator, points, raw: round(value, 4), factor, ownFactor: factor };
    };

    // --- 탐구 (과목 여러 개)
    const inquiryArea = (pick) => {
      const config = areas.inq;
      const count = numOr(config.count, 2);
      if (count <= 0) return null;
      const rows = inputs.inq || [];
      const valued = rows
        .map((row) => ({ row, base: areaMetricValue(config, row, pick, convTableOf(row.kind)) }))
        .filter((row) => row.base !== null);
      if (valued.length === 0) return null;
      const aggregate = config.aggregate || 'sum';
      const chosen = (aggregate === 'best' || aggregate === 'top1' || count === 1)
        ? [[...valued].sort((left, right) => right.base - left.base)[0]]
        : valued.slice(0, count);
      const bonuses = bonusList(config).map(normalizeBonus).filter(Boolean);
      const kinds = chosen.map((row) => row.row.kind);
      const spec = areaDenominatorSpec(config, 'inq');
      if (spec?.kind === 'maxConv' || config.metric === 'conv' || config.metric === 'convRatio') {
        if (conversion?.kind === 'approx' && !flags.includes('approx-conversion')) flags.push('approx-conversion');
      }
      let areaRate = 0;
      let toTotal = 0;
      for (const bonus of bonuses) {
        if (bonus.limited) addNote(`탐구 가산 조건(${bonus.limited})은 모집단위 단위라 여기서는 적용하지 않았다`);
        if (bonus.of === 'pctToTotal') {
          for (const row of chosen) {
            if (bonus.kind && row.row.kind !== bonus.kind) continue;
            const pct = spanPick(row.row, 'pct', pick);
            if (isNumber(pct)) toTotal += pct * bonus.rate;
          }
          continue;
        }
        if (bonus.per === 'combination' && bonus.flat && typeof bonus.flat === 'object') {
          if (kinds.length === 2 && kinds.every((kind) => kind === (bonus.kind || 'science'))) {
            const twos = chosen.filter((row) => /Ⅱ$/u.test(String(row.row.subject || ''))).length;
            const key = twos === 2 ? 'Ⅱ+Ⅱ' : twos === 1 ? 'Ⅰ+Ⅱ' : 'Ⅰ+Ⅰ';
            toTotal += numOr(bonus.flat[key], 0);
          }
          continue;
        }
        if (bonus.scope === 'area') {
          if (bonus.kind && !(kinds.length > 0 && kinds.every((kind) => kind === bonus.kind))) continue;
          areaRate += bonus.rate;
        }
      }
      const perSubject = spec?.perSubject === true || config.perSubject === true;
      const each = [];
      for (const row of chosen) {
        let value = row.base;
        for (const bonus of bonuses) {
          if (bonus.scope !== 'subject' || bonus.of === 'pctToTotal') continue;
          if (bonus.kind && row.row.kind !== bonus.kind) continue;
          value *= 1 + bonus.rate;
          if (Number.isFinite(Number(bonus.flat))) value += Number(bonus.flat);
        }
        if (perSubject) {
          const denominator = denominatorOf(spec, 'inq', row.row.subject ? `탐구-${row.row.subject}` : null, { pick, kind: row.row.kind });
          if (denominator === null) return null;
          value /= denominator;
        }
        each.push(value);
      }
      const sum = each.reduce((total, value) => total + value, 0);
      const mean = aggregate === 'mean' || aggregate === 'avg' || aggregate === 'sumHalf';
      let value = mean ? sum / each.length : sum;
      if (!perSubject) {
        if (spec?.sumOfTwo) {
          const maxes = chosen
            .map((row) => maxStdOfArea(std, 'inq', row.row.subject ? `탐구-${row.row.subject}` : null, { pick, kind: row.row.kind }))
            .filter(isNumber);
          const denominator = maxes.length > 0 ? maxes.reduce((total, one) => total + one, 0) : null;
          if (denominator === null || denominator === 0) return null;
          value /= denominator;
        } else {
          const denominator = denominatorOf(spec, 'inq', null, { pick });
          if (denominator === null) return null;
          value /= denominator;
        }
      }
      value += numOr(config.offset, 0);
      const factor = numOr(config.factor, config.factor === null ? null : 1);
      const points = (numOr(config.base, 0) + value * (factor ?? 1)) * (1 + areaRate);
      return { key: 'inq', value, points, raw: round(value, 4), factor, ownFactor: factor, toTotal };
    };

    // --- 영어 (등급 배점표 · 감점 · 가산)
    const englishArea = (pick) => {
      const config = areas.eng;
      const mode = config.mode || 'table';
      const raw = config.metric === 'conv' && !config.table
        ? areaMetricValue(config, inputs.eng, pick, convTable)
        : tableValue(config.table, inputs.eng?.grade);
      if (raw === null) return null;
      const factor = numOr(config.factor, config.factor === null ? null : 1);
      if (mode === 'penalty') return { key: 'eng', value: raw, points: 0, raw, factor, ownFactor: factor, afterScale: -Math.abs(raw * Math.abs(factor ?? 1)) };
      if (mode === 'bonus') return { key: 'eng', value: raw, points: 0, raw, factor, ownFactor: factor, afterScale: raw * (factor ?? 1) };
      const denominator = denominatorOf(areaDenominatorSpec(config, 'eng'), 'eng', null);
      if (denominator === null) return null;
      const value = raw / denominator;
      const points = numOr(config.base, 0) + value * (factor ?? 1);
      return { key: 'eng', value, points, raw, factor, ownFactor: factor };
    };

    // --- 한국사 (언제나 scale 뒤)
    const historyValue = () => {
      const config = areas.hist;
      if (!config || config.mode === 'none') return { delta: 0, raw: null };
      const raw = tableValue(config.table, inputs.hist?.grade);
      if (raw === null) return { delta: 0, raw: null };
      const factor = numOr(config.factor, 1);
      if (config.mode === 'penalty') return { delta: -Math.abs(raw * Math.abs(factor)), raw };
      return { delta: raw * factor, raw };
    };

    const run = (pick) => {
      const rows = [];
      for (const key of SCORED_AREAS) {
        if (!areas[key] || !(areas[key].metric || areas[key].mode)) continue;
        const row = key === 'inq' ? inquiryArea(pick) : key === 'eng' ? englishArea(pick) : scalarArea(key, pick);
        if (!row) {
          // 상위-n 규칙의 후보는 빠져도 된다(건국대 예체능: 수학·탐구 중 한쪽 미응시 허용).
          if (picks?.pool?.includes(key)) continue;
          return null;
        }
        rows.push(row);
      }
      if (rows.length === 0) return null;
      // 상위 n개 영역만 반영. 영역값 내림차순으로 factors 를 배정하고 나머지는 0으로 둔다.
      if (picks) {
        const pool = rows.filter((row) => picks.pool.includes(row.key));
        if (pool.length > 0) {
          const ranked = [...pool].sort((left, right) => right.value - left.value);
          const keep = picks.factors.length > 0 ? picks.factors.length : 1;
          ranked.forEach((row, index) => {
            if (index >= keep) {
              row.excluded = true;
              row.points = 0;
              row.factor = 0;
              return;
            }
            const assigned = picks.factors[index];
            if (Number.isFinite(Number(assigned))) {
              row.factor = Number(assigned);
              row.points = numOr(areas[row.key]?.base, 0) + row.value * Number(assigned);
            }
          });
        }
      }
      const sum = rows.reduce((total, row) => total + row.points, 0);
      let scaled = (sum * multiply) / divide;
      if (cap !== null) scaled = Math.min(scaled, cap);
      const after = rows.reduce((total, row) => total + (Number(row.afterScale) || 0), 0)
        + rows.reduce((total, row) => total + (Number(row.toTotal) || 0), 0);
      const history = historyValue();
      const value = scaled + after + history.delta;
      return {
        value: track.roundMode === 'truncate5' ? truncate(value, 4) : round(value, roundTo),
        history: history.delta, historyRaw: history.raw, rows,
      };
    };

    const mid = run('mid');
    if (!mid) return null;
    const low = run('min');
    const high = run('max');
    const parts = mid.rows.map((row) => ({
      area: row.key,
      label: SUBJECT_LABEL[row.key],
      metric: areas[row.key]?.metric || areas[row.key]?.mode || 'table',
      input: row.raw,
      factorApplied: numOr(row.factor, 0),
      points: round(row.points + (Number(row.afterScale) || 0), 4),
      excluded: row.excluded === true,
    }));
    if (areas.hist && areas.hist.mode !== 'none') {
      parts.push({
        area: 'hist', label: SUBJECT_LABEL.hist, metric: areas.hist.mode || 'table',
        input: mid.historyRaw, factorApplied: numOr(areas.hist.factor, 1),
        points: round(mid.history, 4), excluded: false,
      });
    }
    return {
      track: track.name || null,
      total: isNumber(track.total) ? track.total : null,
      roundTo,
      basis: 'formula',
      value: mid.value,
      min: low ? Math.min(low.value, mid.value) : mid.value,
      max: high ? Math.max(high.value, mid.value) : mid.value,
      parts,
      history: mid.history,
      flags,
      notes,
      conversion: conversion ? { kind: conversion.kind, name: conversion.name || null, note: conversion.note || null, source: conversion.source || null } : null,
      blockers: trackBlockers(track, inputs),
      formulaYear: track.year ?? null,
      formulaStatus: track.status || null,
      sourceGrade: track.sourceGrade || null,
      source: track.source || null,
      note: track.note || null,
    };
  }

  // 옛 형식(conv-2026.json universities[].formula)의 트랙을 §1.2 형식으로 옮긴다.
  // 연세대 산출 예시(657.6518 · 639.7722)는 새 채점기가 그대로 재현한다.
  function adaptLegacyFormulaTrack(spec, formula) {
    if (!spec) return null;
    const areas = {};
    if (spec.kor) areas.kor = { metric: spec.kor.metric || 'std', factor: Number(spec.kor.factor) || 1 };
    if (spec.math) areas.math = { metric: spec.math.metric || 'std', factor: Number(spec.math.factor) || 1 };
    if (spec.eng) areas.eng = { metric: 'table', table: spec.eng.table, factor: Number(spec.eng.factor) || 1 };
    if (spec.inq) {
      const bonuses = [];
      if (Number(spec.inq.scienceBonus)) bonuses.push({ kind: 'science', rate: Number(spec.inq.scienceBonus) });
      if (Number(spec.inq.socialBonus)) bonuses.push({ kind: 'social', rate: Number(spec.inq.socialBonus) });
      areas.inq = {
        metric: spec.inq.metric || 'conv', factor: Number(spec.inq.factor) || 1,
        count: Number(spec.inq.count) || 2, aggregate: spec.inq.aggregate || 'sum', bonuses,
      };
    }
    if (spec.hist) areas.hist = { mode: spec.hist.mode || 'penalty', table: spec.hist.table, factor: Number(spec.hist.factor) || 1 };
    return {
      name: spec.name, appliesTo: spec.appliesTo, areas, scale: spec.scale || {},
      total: spec.total ?? null, roundTo: spec.roundTo ?? formula?.roundTo ?? 4,
      optional: spec.optional || null, eligibility: spec.eligibility || null,
      note: spec.note || formula?.note || null,
    };
  }

  // 정규화된 프로필 → 산식 입력. best 면 만점 성적(영역별 만점 표준점수·1등급)을 넣는다.
  function profileFormulaInputs(profile, std, best = false) {
    const rows = [...(profile?.inquiries || [])].sort((left, right) => right.pct - left.pct);
    const spanOf = (area, source) => {
      const value = best ? std?.subjects?.[stdKeyOf(area)]?.maxStd : source?.std;
      return { std: isNumber(value) ? value : null, pct: best ? 100 : (isNumber(source?.pct) ? source.pct : null) };
    };
    return {
      kor: spanOf('kor', profile?.kor),
      math: spanOf('math', profile?.math),
      inq: rows.map((row) => ({
        kind: row.kind, subject: row.subject,
        std: best ? (std?.subjects?.[`탐구-${row.subject}`]?.maxStd ?? null) : (isNumber(row.std) ? row.std : null),
        pct: best ? 100 : row.pct,
      })),
      eng: { grade: best ? 1 : profile?.eng?.grade ?? null },
      hist: { grade: best ? 1 : profile?.hist?.grade ?? null },
      mathElective: profile?.math?.elective || null,
    };
  }

  // 입학처가 낸 산출식(conv.universities[id].formula)을 그대로 계산한다 — 새 채점기의 얇은 껍질이다.
  function formulaScore(profile, formula, deptTrack, table, std) {
    const tracks = Array.isArray(formula?.tracks) ? formula.tracks : [];
    const spec = tracks.find((row) => (row.appliesTo || []).includes(deptTrack)) || tracks[0];
    const track = adaptLegacyFormulaTrack(spec, formula);
    if (!track) return null;
    const ctx = { convTable: table, convKind: 'official' };
    const mine = formulaScore2(track, profileFormulaInputs(profile, std, false), ctx);
    if (!mine) return null;
    const top = formulaScore2(track, profileFormulaInputs(profile, std, true), ctx);
    return {
      basis: 'official', approx: false, track: spec.name,
      parts: mine.parts.filter((row) => row.area !== 'hist').map((row) => ({ key: row.area, label: row.label, points: row.points })),
      value: mine.value, max: top ? top.value : null,
      history: mine.history, note: spec.note || formula.note || null,
    };
  }

  // 대학 환산점수. 입학처 산출식이 있으면 그대로, 없으면 rules 의 배점으로 만든 근사값이다.
  //   근사 규칙 하나뿐이다 — 영역별 '만점 대비 채움 비율'에 배점을 곱해 더한다.
  //   대학마다 다른 실제 산식을 지어내지 않는다. approx:true 로 화면이 그렇게 적는다.
  function universityRawScore(profile, rule, deptTrack, options = {}) {
    if (!profileComplete(profile)) return null;
    const { std = null, conv = null, universityId = null, ruleTrack = null } = options;
    const conversion = conversionTable(conv, universityId);
    // 화면에 돌려주는 conversion 에는 표 자체를 넣지 않는다(101줄짜리다) — 출처만 남긴다.
    const conversionMeta = conversion
      ? { kind: conversion.kind, name: conversion.name || null, note: conversion.note || null, source: conversion.source || null }
      : null;
    if (conversion?.formula) {
      const exact = formulaScore(profile, conversion.formula, deptTrack, conversion.table, std);
      if (exact) return { ...exact, conversion: conversionMeta, unit: 'points' };
    }
    const track = pickTrack(rule, deptTrack, ruleTrack);
    if (!track) return null;
    const weights = track.weights || {};
    const wKor = Number(weights.kor) || 0;
    const wMath = Number(weights.math) || 0;
    const wInq = Number(weights.inq) || 0;
    const wEng = Number(weights.eng) || 0;
    if (wKor + wMath + wInq <= 0) return null;
    const metric = options.metric === 'pct' ? 'pct' : 'std';
    const inquiryCount = Number(track.inquiry?.count) || 2;
    const rows = [...(profile.inquiries || [])].sort((left, right) => right.pct - left.pct).slice(0, inquiryCount);
    // 채움 비율: 표점 대학은 표준점수/만점 표준점수(탐구는 변환표점/변환표 최고점), 백분위 대학은 백분위/100.
    const fillOf = (area) => {
      if (metric === 'pct') {
        if (area === 'kor') return isNumber(profile.kor.pct) ? profile.kor.pct / 100 : null;
        if (area === 'math') return isNumber(profile.math.pct) ? profile.math.pct / 100 : null;
        const value = inquiryPercentile(profile, inquiryCount);
        return isNumber(value) ? value / 100 : null;
      }
      if (area === 'inq') {
        if (!conversion || rows.length === 0) return null;
        const tableOf = (kind) => (kind && conversion.tables?.[kind]) || conversion.table;
        const top = Number(conversion.table['100']);
        const each = rows.map((row) => convertedStd(row.pct, tableOf(row.kind)));
        if (each.some((value) => value === null) || !Number.isFinite(top) || top <= 0) return null;
        return (each.reduce((sum, value) => sum + value, 0) / each.length) / top;
      }
      const source = area === 'kor' ? profile.kor : profile.math;
      const max = std?.subjects?.[stdKeyOf(area)]?.maxStd;
      return isNumber(source.std) && isNumber(max) && max > 0 ? source.std / max : null;
    };
    const engRows = englishTable(track.english);
    const englishByRatio = wEng > 0 && (track.english?.method || '비율반영') === '비율반영';
    const engFill = isNumber(engRows[1]) && engRows[1] > 0 && isNumber(engRows[profile.eng.grade])
      ? clamp(engRows[profile.eng.grade] / engRows[1], 0, 1) : null;

    const mathBonus = Number(track.mathBonus) || 0;
    const mathAdvanced = profile.math.elective === '미적분' || profile.math.elective === '기하';
    const kinds = new Set(rows.map((row) => row.kind));
    const scienceBonus = Number(track.inquiry?.scienceBonus) || 0;
    const socialBonus = Number(track.inquiry?.socialBonus) || 0;
    const inqBonus = (scienceBonus > 0 && kinds.has('science') && !kinds.has('social')) ? scienceBonus
      : (socialBonus > 0 && kinds.has('social') && !kinds.has('science')) ? socialBonus : 0;

    const unit = track.unit === 'points' ? 'points' : 'percent';
    const total = unit === 'points' ? (wKor + wMath + wInq + (englishByRatio ? wEng : 0)) : (Number(track.total) || 1000);
    const weightSum = wKor + wMath + wInq + (englishByRatio ? wEng : 0);
    const share = (weight) => (unit === 'points' ? weight : (weight / weightSum) * total);

    const parts = [];
    let value = 0;
    let max = 0;
    const push = (key, weight, fill, bonus = 0) => {
      if (weight <= 0) return;
      const points = share(weight);
      max += points;
      if (fill === null) return;
      const got = points * clamp(fill * (1 + bonus), 0, 1 + bonus);
      value += got;
      parts.push({ key, label: SUBJECT_LABEL[key], points: round(got, 2), max: round(points, 2), fill: round(fill, 4), bonus });
    };
    push('kor', wKor, fillOf('kor'));
    push('math', wMath, fillOf('math'), mathBonus > 0 && mathAdvanced ? mathBonus : 0);
    push('inq', wInq, fillOf('inq'), inqBonus);
    if (englishByRatio) push('eng', wEng, engFill);

    // 영어·한국사 가감점은 대학 총점 척도의 점수다. 규칙이 다른 총점을 적어 두었으면 그 비율로 옮긴다.
    const adjustments = [];
    const scaleTo = (points, base) => (isNumber(base) && base > 0 ? (points * max) / base : points);
    if (!englishByRatio && isNumber(profile.eng.grade) && isNumber(engRows[1]) && isNumber(engRows[profile.eng.grade])) {
      const delta = round(scaleTo(engRows[profile.eng.grade] - engRows[1], Number(track.english?.total) || max), 2);
      if (delta !== 0) adjustments.push({ key: 'eng', label: `영어 ${profile.eng.grade}등급`, delta });
    }
    const histRows = englishTable(track.history);
    if (isNumber(profile.hist.grade) && isNumber(histRows[1]) && isNumber(histRows[profile.hist.grade])) {
      const delta = round(scaleTo(histRows[profile.hist.grade] - histRows[1], Number(track.history?.total) || max), 2);
      if (delta !== 0) adjustments.push({ key: 'hist', label: `한국사 ${profile.hist.grade}등급`, delta });
    }
    const missing = parts.length < (englishByRatio ? 4 : 3);
    return {
      basis: 'rules', approx: true, track: track.name || null, unit, parts, adjustments, conversion: conversionMeta,
      metric, incomplete: missing,
      value: round(value + adjustments.reduce((sum, row) => sum + row.delta, 0), 2),
      max: round(max, 2),
    };
  }

  // 최근 연도에 준 가중치. 컷은 그해 수능 난이도를 타므로 최근 해를 크게 본다.
  const YEAR_WEIGHTS = Object.freeze([0.6, 0.3, 0.1]);

  // 모집단위의 정시 기준값.
  //   expected : 비교 가능한 연도별 값(dept.series)의 최근 가중 평균 — 판정의 기준선
  //   range    : 연도별 최소~최대. 화면의 "± 오차"는 이 폭의 절반이다.
  //   한 해뿐이면 대학 전체의 대표 변동폭(fallbackSpread)을 오차로 쓴다.
  // 환산점수만 있는 모집단위는 사설 백분위 추정이 있을 때만 판정한다.
  function jeongsiReference(dept, fallbackSpread) {
    const years = Object.keys(dept?.jeongsi || {}).sort().reverse();
    // 생성 데이터에는 series가 있다(빌드가 정의 불일치 행을 이미 걸러 둔다). series 배열 자체가
    // 없을 때(테스트·수기 데이터)만 jeongsi에서 만들고, 그때도 정의가 맞는 행만 쓴다.
    let series = (Array.isArray(dept?.series) ? dept.series : []).filter((row) => isNumber(row.value));
    if (!Array.isArray(dept?.series)) {
      series = years
        .filter((year) => (dept.jeongsi[year].metric || 'pct') === 'pct' && isNumber(dept.jeongsi[year].cut70))
        .map((year) => ({ year, value: dept.jeongsi[year].cut70, kind: '70%컷', def: dept.jeongsi[year].def || COMPARE_BASIS, basis: 'adiga', source: dept.jeongsi[year].source, url: dept.jeongsi[year].url }));
    }
    series = [...series].sort((left, right) => right.year.localeCompare(left.year));
    // 이 모집단위의 컷 정의는 **최근 연도의 것 하나**다. 눈금이 다른 해는 섞지 않고 뺀다 —
    // 정의가 다르다고 판정을 접는 것이 아니라, 그 정의 그대로 내 성적을 만들어 비교한다.
    const def = series.length > 0 ? (series[0].def || COMPARE_BASIS)
      : (years.map((year) => dept.jeongsi[year]).find((row) => (row.metric || 'pct') === 'pct' && isNumber(row.cut70))?.def || COMPARE_BASIS);
    const scale = cutScale(def);
    const mixed = series.filter((row) => cutScale(row.def || COMPARE_BASIS) !== scale);
    series = series.filter((row) => cutScale(row.def || COMPARE_BASIS) === scale);
    const defs = [...new Set(series.map((row) => row.def || COMPARE_BASIS))];
    // comparable = 그 정의의 값을 우리가 만들 수 있는가(환산점수 눈금만 false).
    const comparable = cutDefInfo(def).comparable;
    const approxDef = defs.some((key) => cutDefInfo(key).approx);
    // 눈금이 달라 계열에서 뺀 연도값. 화면이 참고로만 적는다.
    const excluded = mixed
      .map((row) => ({ year: row.year, def: row.def, label: cutDefInfo(row.def).label, value: row.value, source: row.source, url: row.url }));

    const history = [];
    for (const year of years) {
      const row = dept.jeongsi[year];
      if (!row || (row.metric || 'pct') !== 'pct') continue;
      const candidate = isNumber(row.cut70) ? { value: row.cut70, kind: '70%컷' }
        : isNumber(row.avg) ? { value: row.avg, kind: '평균' }
          : isNumber(row.min) ? { value: row.min, kind: '최저' } : null;
      if (candidate) history.push({ year, value: candidate.value, kind: candidate.kind, source: row.source, url: row.url, group: row.group || null });
    }
    const estimates = Object.keys(dept?.estimate || {}).sort().reverse()
      .map((year) => ({ year, ...dept.estimate[year] }))
      .filter((row) => isNumber(row.pct));

    let primary = null;
    let range = null;
    let spread = null;
    if (series.length > 0) {
      const used = series.slice(0, YEAR_WEIGHTS.length);
      const weights = YEAR_WEIGHTS.slice(0, used.length);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const expected = round(used.reduce((sum, row, index) => sum + row.value * weights[index], 0) / total, 2);
      const values = used.map((row) => row.value);
      range = { min: Math.min(...values), max: Math.max(...values), years: used.map((row) => row.year) };
      spread = used.length > 1 ? round((range.max - range.min) / 2, 1) : (isNumber(fallbackSpread) ? round(fallbackSpread, 1) : null);
      primary = {
        year: used[0].year, value: expected, kind: used.length > 1 ? `${used.length}개년 가중 평균` : used[0].kind,
        basis: 'adiga', latest: used[0].value, latestYear: used[0].year,
        source: used[0].source, url: used[0].url, derived: used.some((row) => row.basis === 'derived'),
      };
    } else if (estimates.length > 0) {
      primary = { year: estimates[0].year, value: estimates[0].pct, kind: '사설 추정', basis: 'estimate', source: estimates[0].source, url: estimates[0].url };
      spread = isNumber(fallbackSpread) ? round(fallbackSpread, 1) : null;
    }
    const scoreRows = years.map((year) => ({ year, ...dept.jeongsi[year] })).filter((row) => row.metric === 'score' && isNumber(row.cut70));
    if (primary && !comparable) primary = null;
    return {
      basis: def, basisLabel: cutDefInfo(def).label,
      def, defLabel: cutDefInfo(def).label, scale,
      defs, comparable, approxDef, excluded,
      primary, series, history, estimates, scoreRows, range, spread, official: dept.official || {},
    };
  }

  function bandOf(gap, bands) {
    if (!isNumber(gap)) return null;
    return bands.find((band) => gap >= band.min) || bands[bands.length - 1];
  }

  // ---------------------------------------------------------------- §3 네 층위
  // 합격선 비교의 중심은 **대학 환산점수**다(docs/MODEL.md). 평균 백분위는 보조로 내린다.
  //   L1 환산 : 컷 학년도 산식이 formula-check 에서 verified 이고 어디가 환산점수 70%가 있을 때.
  //             내 환산점수 − 컷 환산점수(점) → 산식의 국소 기울기로 백분위 상당(pctEq)을 만든다.
  //   L2 지수 : 산식이 없고 반영비율만 있을 때. 70% 학생의 영역별 백분위와 **같은 비율**로 만든
  //             가중 지수의 차이(백분위).
  //   L3 참고 : 정의별 백분위 컷만 있을 때 — 지금까지의 판정이다. 불확실성 ±2.0.
  //   L0 없음 : 집계 방식 unknown · 컷 없음 · 자격 미충족.
  const APPLY_YEAR = 2027;
  const LAYER_UNCERTAINTY = Object.freeze({ L1: 0.5, L2: 1, L3: 2, L0: null });
  const INQ_KIND_ALIAS = Object.freeze({
    사탐: 'social', 과탐: 'science', 직탐: 'vocational',
    social: 'social', science: 'science', vocational: 'vocational',
  });

  const cutRowScore = (row, key) => {
    if (!row) return null;
    const direct = row.score ? row.score[key] : null;
    if (isNumber(direct)) return direct;
    const legacy = key === 'p70' ? row.score70 : key === 'p50' ? row.score50 : null;
    return isNumber(legacy) ? legacy : null;
  };

  // 어디가 70%/50% 지점 **학생 한 명**의 성적표. 평균백분위가 영역별 값과 맞아야(±0.6)
  // 그 행의 영역별 값을 한 학생 성적표로 쓴다(§1.1 consistent).
  function normalizeCutStudent(raw) {
    if (!raw) return null;
    const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
    const inq = [];
    for (const slot of ['inq1', 'inq2']) {
      const row = raw[slot];
      if (row === null || row === undefined) continue;
      const pct = num(typeof row === 'object' ? row.pct : row);
      if (pct === null) continue;
      inq.push({
        pct,
        kind: INQ_KIND_ALIAS[String((typeof row === 'object' && row.kind) || '')] || null,
        subject: (typeof row === 'object' && row.subject) || null,
        conv: num(typeof row === 'object' ? row.conv : null),
      });
    }
    inq.sort((left, right) => right.pct - left.pct);
    const kor = num(raw.kor);
    const math = num(raw.math);
    const avg = num(raw.avg);
    const computed = isNumber(kor) && isNumber(math) && inq.length > 0
      ? (kor + math + inq.reduce((sum, row) => sum + row.pct, 0) / inq.length) / 3
      : null;
    const consistent = raw.consistent === true ? true
      : raw.consistent === false ? false
        : isNumber(avg) && isNumber(computed) ? Math.abs(avg - computed) <= 0.6
          : isNumber(computed);
    return {
      kor, math, inq, avg, eng: num(raw.eng), hist: num(raw.hist),
      korConv: num(raw.korConv), mathConv: num(raw.mathConv),
      mathElective: raw.mathElective || null,
      computedAvg: computed === null ? null : round(computed, 2), consistent,
    };
  }

  // 70% 학생 성적표 → 산식 입력(§1.3 되읽기).
  //   행에 대학이 공개한 변환표준점수(conv)가 실려 있으면 그 값을 그대로 넘긴다 — 근사표를 쓰지 않는다.
  function studentFormulaInputs(student, std) {
    if (!student) return null;
    const span = (target, pct) => {
      const read = stdRangeFromPercentile(std, target, pct);
      return {
        pct: isNumber(pct) ? pct : null,
        std: read ? read.mid : null, stdMin: read ? read.min : null, stdMax: read ? read.max : null, read,
      };
    };
    return {
      kor: { ...span('국어', student.kor), conv: isNumber(student.korConv) ? student.korConv : null },
      math: { ...span('수학', student.math), conv: isNumber(student.mathConv) ? student.mathConv : null },
      inq: student.inq.map((row) => ({
        ...span(row.subject ? `탐구-${row.subject}` : (row.kind || 'inq'), row.pct),
        kind: row.kind, subject: row.subject, conv: isNumber(row.conv) ? row.conv : null,
      })),
      eng: { grade: student.eng },
      hist: { grade: student.hist },
      mathElective: student.mathElective || null,
    };
  }

  // 내 성적 → 컷 학년도 산식 입력. 학년도가 다르면 §1.3 백분위 동등 가정으로 잇는다.
  //   bump  : 모든 영역 백분위를 n점 올린 입력(국소 기울기 계산용)
  //   force : 'min'|'max' — 등급 구간의 하한·상한만 쓰는 입력(민감도 계산용)
  function myFormulaInputs(profile, std, options = {}) {
    if (!profile) return null;
    const sameYear = options.sameYear === true;
    const gradeMode = (profile.mode || 'pct') === 'grade';
    const bump = Number(options.bump) || 0;
    const span = (target, pct, ownStd) => {
      const value = isNumber(pct) ? clamp(pct + bump, 0, 100) : null;
      const out = { pct: value, pctMin: null, pctMax: null, std: null, stdMin: null, stdMax: null };
      if (value === null) return out;
      if (gradeMode) {
        const range = percentileRangeOfGrade(gradeFromPercentile(value));
        out.pctMin = range.min;
        out.pctMax = range.max;
      }
      if (sameYear && bump === 0 && isNumber(ownStd)) {
        out.std = ownStd;
        out.stdMin = ownStd;
        out.stdMax = ownStd;
        return out;
      }
      const read = stdRangeFromPercentile(std, target, value);
      if (read) {
        out.std = read.mid;
        out.stdMin = read.min;
        out.stdMax = read.max;
        out.read = read;
      }
      if (gradeMode) {
        const low = stdRangeFromPercentile(std, target, out.pctMin);
        const high = stdRangeFromPercentile(std, target, out.pctMax);
        if (low) out.stdMin = low.min;
        if (high) out.stdMax = high.max;
      }
      return out;
    };
    const rows = [...(profile.inquiries || [])].sort((left, right) => right.pct - left.pct);
    // 대학이 공개한 변환표준점수를 직접 넣은 성적은 근사표 대신 그 값을 쓴다(bump 는 백분위를 흔드는
    // 계산이라 그때는 표로 되돌아간다 — 고정값에 +1을 줄 수 없다).
    const conv = (value) => (bump === 0 && isNumber(value) ? value : null);
    return {
      kor: { ...span('국어', profile.kor?.pct, profile.kor?.std), conv: conv(profile.kor?.conv) },
      math: { ...span('수학', profile.math?.pct, profile.math?.std), conv: conv(profile.math?.conv) },
      inq: rows.map((row) => ({ ...span(`탐구-${row.subject}`, row.pct, row.std), kind: row.kind, subject: row.subject, conv: conv(row.conv) })),
      eng: { grade: profile.eng?.grade ?? null },
      hist: { grade: profile.hist?.grade ?? null },
      mathElective: profile.math?.elective || null,
    };
  }

  const rulesFor = (rules, universityId) => (rules ? (rules.universities?.[universityId] || rules[universityId] || null) : null);

  // 모집단위에 맞는 산식 트랙. 모집단위를 못박은 트랙(appliesTo.depts)이 먼저다.
  function pickModelTrack(rules, universityId, dept) {
    const rule = rulesFor(rules, universityId);
    const tracks = Array.isArray(rule?.tracks) ? rule.tracks : [];
    if (tracks.length === 0) return null;
    const stamp = (track) => ({
      ...track,
      universityId,
      year: track.year ?? rule.year ?? null,
      status: track.status || rule.status || null,
      source: track.source || rule.source || null,
      sourceGrade: track.sourceGrade || rule.sourceGrade || null,
    });
    const name = dept?.name || '';
    // pickBest 트랙은 형제를 모두 달아 돌려준다 — 채점기가 전부 계산해 높은 쪽을 고른다(§1.2).
    const withSiblings = (track, match) => {
      const chosen = stamp(track);
      if (track.pickBest !== true) return chosen;
      const family = tracks.filter((row) => row.pickBest === true && match(row)).map(stamp);
      return family.length > 1 ? { ...chosen, siblings: family } : chosen;
    };
    const byDept = tracks.find((track) => Array.isArray(track.appliesTo?.depts) && track.appliesTo.depts.includes(name));
    if (byDept) return withSiblings(byDept, (row) => Array.isArray(row.appliesTo?.depts) && row.appliesTo.depts.includes(name));
    const wanted = [dept?.ruleTrack, dept?.track].filter(Boolean);
    if (dept?.track === '상경') wanted.push('인문');
    if (dept?.track === '의약') wanted.push('자연');
    if (dept?.track === '자유전공') wanted.push('인문', '자연');
    if (dept?.track === '예체능') wanted.push('인문');
    const matches = (track, key) => (Array.isArray(track.appliesTo) ? track.appliesTo.includes(key) : String(track.appliesTo || '').includes(key))
      || String(track.name || '').includes(key);
    for (const key of wanted) {
      const hit = tracks.find((track) => matches(track, key));
      if (hit) return withSiblings(hit, (row) => matches(row, key));
    }
    // 모집단위 지정 트랙만 있는 대학은 이름이 맞지 않으면 아무것도 고르지 않는다.
    if (tracks.every((track) => Array.isArray(track.appliesTo?.depts))) return null;
    return stamp(tracks[0]);
  }

  const formulaVerified = (check, universityId, trackName) => (check?.tracks || {})[`${universityId}::${trackName}`]?.status === 'verified';

  // L2 — 반영비율. 옛 형식(rules-2027.json weights)과 §1.2 형식(areas.factor) 둘 다 읽는다.
  function ratioWeights(track) {
    if (!track) return null;
    if (track.weights) {
      const kor = Number(track.weights.kor) || 0;
      const math = Number(track.weights.math) || 0;
      const inq = Number(track.weights.inq) || 0;
      const eng = Number(track.weights.eng) || 0;
      if (kor + math + inq <= 0) return null;
      return {
        kor, math, inq, eng, engTable: track.english?.table || null,
        engByRatio: eng > 0 && (track.english?.method || '비율반영') === '비율반영',
        count: Number(track.inquiry?.count) || 2, name: track.name || null,
      };
    }
    const areas = track.areas || null;
    if (!areas) return null;
    const kor = Number(areas.kor?.factor) || 0;
    const math = Number(areas.math?.factor) || 0;
    const inq = Number(areas.inq?.factor) || 0;
    if (kor + math + inq <= 0) return null;
    return {
      kor, math, inq, eng: 0, engTable: areas.eng?.table || null, engByRatio: false,
      count: Number(areas.inq?.count) || 2, name: track.name || null,
    };
  }

  const engPercentOf = (grade, table) => {
    const top = tableValue(table, 1);
    const mine = tableValue(table, grade);
    if (isNumber(top) && top > 0 && isNumber(mine)) return clamp(mine / top, 0, 1) * 100;
    return isNumber(grade) && grade === 1 ? 100 : null;
  };

  function ratioIndex(values, weights) {
    if (!weights) return null;
    const parts = [];
    const push = (key, weight, value) => { if (weight > 0 && isNumber(value)) parts.push({ key, weight, value }); };
    push('kor', weights.kor, values.kor);
    push('math', weights.math, values.math);
    push('inq', weights.inq, values.inq);
    if (weights.engByRatio) push('eng', weights.eng, values.eng);
    if (parts.length === 0) return null;
    const total = parts.reduce((sum, part) => sum + part.weight, 0);
    return {
      value: round(parts.reduce((sum, part) => sum + part.weight * part.value, 0) / total, 2),
      parts: parts.map((part) => ({ ...part, share: part.weight / total })),
      total,
    };
  }

  // 컷으로 쓸 학년도. 환산점수·학생 성적표가 있는 최근 해가 먼저다.
  function pickCutYear(dept, reference) {
    const years = Object.keys(dept?.jeongsi || {}).filter((key) => key !== 'alts').sort().reverse();
    const rich = years.find((year) => {
      const row = dept.jeongsi[year];
      return isNumber(cutRowScore(row, 'p70')) || row?.student?.p70;
    });
    return rich || reference?.primary?.year || years[0] || null;
  }

  // §5 연도 계열 — 화면·계약이 쓰는 짧은 이력.
  function historyRows(dept, reference) {
    const rows = [];
    for (const entry of reference?.series || []) {
      const row = dept?.jeongsi?.[entry.year] || null;
      rows.push({
        year: entry.year,
        score70: cutRowScore(row, 'p70'),
        avg70: isNumber(entry.value) ? entry.value : null,
        changed: Array.isArray(entry.changed) ? entry.changed : [],
        comparable: true,
      });
    }
    for (const entry of reference?.excluded || []) {
      rows.push({ year: entry.year, score70: null, avg70: isNumber(entry.value) ? entry.value : null, changed: ['컷 정의'], comparable: false });
    }
    return rows.sort((left, right) => String(right.year).localeCompare(String(left.year)));
  }

  // §7 계약을 결과에 얹는다. 옛 필드는 그대로 두고 새 필드만 더한다 —
  // 이름이 겹치는 mine·gap 은 result.model 안에 §7 모양으로 들어간다.
  function attachModel(result, info) {
    const { level, dept, reference, context, profile } = info;
    const cutYear = info.cutYear || reference?.primary?.year || null;
    const cutRow = cutYear ? dept?.jeongsi?.[cutYear] : null;
    const flags = [...(info.flags || [])];
    const add = (flag) => { if (flag && !flags.includes(flag)) flags.push(flag); };
    if (profile?.mode === 'grade' || profile?.mode === 'raw') add('estimated');
    if (profile?.sourceKind && profile.sourceKind !== 'actual') add(profile.sourceKind);
    const sources = [...(info.sources || [])];
    if (cutRow?.source) sources.push({ title: cutRow.source, url: cutRow.url || null });
    else if (reference?.primary?.source) sources.push({ title: reference.primary.source, url: reference.primary.url || null });
    const band = result.band ? { ...result.band, uncertainty: LAYER_UNCERTAINTY[level] ?? null, note: '70% 지점 대비' } : result.band;
    const apply = info.apply || {
      year: APPLY_YEAR, typeName: cutRow?.typeName || '',
      group: result.group || cutRow?.group || null, formula: null,
    };
    const history = info.history || historyRows(dept, reference);
    const model = {
      level,
      status: ['ok', 'blocked', 'hold'].includes(result.status) ? result.status : 'none',
      apply,
      mine: info.mineDetail || null,
      cut: result.cut || null,
      gap: info.gapDetail || null,
      band: band || null,
      areas: info.areas || [],
      sensitivity: info.sensitivity || null,
      history,
      flags,
      sources,
    };
    return {
      ...result,
      band,
      level,
      apply,
      areas: model.areas,
      sensitivity: model.sensitivity,
      history,
      flags,
      sources,
      assumptions: info.mineDetail?.assumptions || [],
      mineDetail: model.mine,
      gapDetail: model.gap,
      uncertainty: LAYER_UNCERTAINTY[level] ?? null,
      basisChanged: info.gapDetail?.basisChanged === true,
      cut2027: info.cut2027 ?? null,
      model,
    };
  }

  // 데이터가 허락하는 가장 높은 층위 하나. L1 → L2 순으로 시도하고, 둘 다 안 되면 null(=L3/L0).
  function resolveLayer(profile, university, dept, rule, reference, context) {
    if (!profile || !context || !profileComplete(profile)) return null;
    const universityId = university?.id ?? null;
    if (!universityId) return null;
    const std = context.std || null;
    const cutYear = pickCutYear(dept, reference);
    const cutRow = cutYear ? dept?.jeongsi?.[cutYear] : null;
    if (!cutRow) return null;
    const aggregation = String(cutRow.aggregation || 'adiga-score-rank');
    // 집계 방식을 모르는 행은 정밀 판정을 내리지 않는다(§1.1) — L3 참고까지다.
    if (aggregation === 'unknown') return null;
    const student70 = normalizeCutStudent(cutRow.student?.p70);
    const student50 = normalizeCutStudent(cutRow.student?.p50);
    const score70 = cutRowScore(cutRow, 'p70');
    const score50 = cutRowScore(cutRow, 'p50');
    const sameYear = String(profile.year || '') === String(cutYear || '');
    const base = {
      cutYear, cutRow, aggregation, student70, student50, cutScore70: score70, cutScore50: score50,
      flags: [], sources: [], blockers: [],
    };

    // ---------------------------------------------------------------- L1 환산
    const track = pickModelTrack(context.rules2026, universityId, dept);
    if (std && track && trackHasFormula(track) && isNumber(score70)
      && formulaVerified(context.formulaCheck, universityId, track.name)) {
      const ctx = { std, conv: context.conv, universityId, year: cutYear };
      const inputs = myFormulaInputs(profile, std, { sameYear });
      const mineScore = formulaScore2(track, inputs, ctx);
      const bumpedFirst = mineScore ? formulaScore2(track, myFormulaInputs(profile, std, { sameYear, bump: 1 }), ctx) : null;
      // 국소 기울기를 못 구하면 점수 차를 백분위로 옮길 수 없다 — L1로 올리지 않고 L2·L3로 내려간다.
      if (mineScore && bumpedFirst && bumpedFirst.value > mineScore.value) {
        const bumped = bumpedFirst;
        const slope = bumped.value - mineScore.value;
        const toPct = (points) => (isNumber(points) && isNumber(slope) ? round(points / slope, VERDICT_DIGITS) : null);
        const points = round(mineScore.value - score70, 4);
        const flags = [];
        if (!sameYear) flags.push('year-bridge');
        if (mineScore.conversion?.kind === 'approx') flags.push('approx-conversion');
        if (track.status === 'plan') flags.push('plan-formula');

        // 유리·불리: 같은 산식으로 채점한 70% 학생과의 영역별 점수 차.
        const cutParts = student70?.consistent ? formulaScore2(track, studentFormulaInputs(student70, std), ctx) : null;
        const areas = [];
        if (cutParts) {
          for (const part of mineScore.parts) {
            const twin = cutParts.parts.find((row) => row.area === part.area);
            if (!twin) continue;
            areas.push({ area: part.area, label: part.label, mine: part.points, cut: twin.points, contrib: round(part.points - twin.points, 2) });
          }
          areas.sort((left, right) => Math.abs(right.contrib) - Math.abs(left.contrib));
        }

        // 2027 산식이 따로 있고 다르면 70% 학생을 그 산식으로 다시 채점한다(§3).
        let basisChanged = false;
        let gap2027 = null;
        let cut2027 = null;
        const track2027 = pickModelTrack(context.rules2027, universityId, dept);
        if (track2027 && trackHasFormula(track2027) && JSON.stringify(track2027.areas) + JSON.stringify(track2027.scale || {}) !== JSON.stringify(track.areas) + JSON.stringify(track.scale || {})) {
          const cutRescored = student70?.consistent ? formulaScore2(track2027, studentFormulaInputs(student70, std), ctx) : null;
          const mineRescored = formulaScore2(track2027, inputs, ctx);
          if (cutRescored && mineRescored) {
            cut2027 = { score: cutRescored.value, track: track2027.name, status: track2027.status || null };
            const bumped2027 = formulaScore2(track2027, myFormulaInputs(profile, std, { sameYear, bump: 1 }), ctx);
            const slope2027 = bumped2027 && bumped2027.value > mineRescored.value ? bumped2027.value - mineRescored.value : null;
            gap2027 = isNumber(slope2027) ? round((mineRescored.value - cutRescored.value) / slope2027, VERDICT_DIGITS) : null;
            const left = bandOf(toPct(points), VERDICT_BANDS);
            const right = bandOf(gap2027, VERDICT_BANDS);
            basisChanged = Boolean(left && right && left.key !== right.key);
            if (track2027.status === 'plan' && !flags.includes('plan-formula')) flags.push('plan-formula');
          }
        }

        // §4 민감도 — 등급 입력에서 배점이 가장 큰 영역의 하한→상한 폭.
        let sensitivity = null;
        if (mineScore.max > mineScore.min) {
          const biggest = [...mineScore.parts]
            .filter((part) => ['kor', 'math', 'inq'].includes(part.area))
            .sort((left, right) => right.factorApplied - left.factorApplied)[0] || null;
          if (biggest) {
            sensitivity = {
              area: biggest.area, label: biggest.label,
              low: mineScore.min, high: mineScore.max,
              deltaPoints: round(mineScore.max - mineScore.min, 2),
              deltaPctEq: toPct(round(mineScore.max - mineScore.min, 4)),
            };
          }
        }

        const pctEq = gap2027 !== null && basisChanged ? gap2027 : toPct(points);
        return {
          ...base, level: 'L1', track, mineScore, slope, points, pctEq,
          gapMin: toPct(round(mineScore.min - score70, 4)),
          gapMax: toPct(round(mineScore.max - score70, 4)),
          gap2026: toPct(points), gap2027, basisChanged, cut2027,
          above50: isNumber(score50) ? mineScore.value >= score50 : null,
          areas, sensitivity, flags,
          blockers: mineScore.blockers || [],
          unit: 'points',
        };
      }
    }

    // ---------------------------------------------------------------- L2 지수
    const ratioTrack = pickModelTrack(context.rules2027, universityId, dept) || pickTrack(rule, dept?.track, dept?.ruleTrack);
    const weights = ratioWeights(ratioTrack);
    if (weights && student70?.consistent) {
      const cutInq = student70.inq.slice(0, weights.count);
      const cutValues = {
        kor: student70.kor, math: student70.math,
        inq: cutInq.length > 0 ? cutInq.reduce((sum, row) => sum + row.pct, 0) / cutInq.length : null,
        eng: engPercentOf(student70.eng, weights.engTable),
      };
      const myValues = {
        kor: profile.kor?.pct, math: profile.math?.pct,
        inq: inquiryPercentile(profile, weights.count),
        eng: engPercentOf(profile.eng?.grade, weights.engTable),
      };
      const cutIndex = ratioIndex(cutValues, weights);
      const myIndex = ratioIndex(myValues, weights);
      if (cutIndex && myIndex) {
        const areas = myIndex.parts.map((part) => {
          const twin = cutIndex.parts.find((row) => row.key === part.key) || null;
          return {
            area: part.key, label: SUBJECT_LABEL[part.key],
            mine: round(part.value, 2), cut: twin ? round(twin.value, 2) : null,
            contrib: twin ? round((part.value - twin.value) * part.share, 2) : null,
          };
        }).sort((left, right) => Math.abs(right.contrib ?? 0) - Math.abs(left.contrib ?? 0));
        const gap = round(myIndex.value - cutIndex.value, VERDICT_DIGITS);
        const cut50Index = student50?.consistent
          ? ratioIndex({
            kor: student50.kor, math: student50.math,
            inq: student50.inq.length > 0 ? student50.inq.slice(0, weights.count).reduce((sum, row) => sum + row.pct, 0) / Math.min(weights.count, student50.inq.length) : null,
            eng: engPercentOf(student50.eng, weights.engTable),
          }, weights)
          : null;
        return {
          ...base, level: 'L2', track: ratioTrack, myIndex, cutIndex,
          points: null, pctEq: gap, gapMin: gap, gapMax: gap, gap2026: gap, gap2027: null,
          basisChanged: false, cut2027: null,
          above50: cut50Index ? myIndex.value >= cut50Index.value : null,
          areas, sensitivity: null,
          flags: ratioTrack?.status === 'plan' ? ['plan-formula'] : [],
          blockers: [], unit: 'pct',
        };
      }
    }
    return null;
  }

  // 층위 판정을 옛 계약 모양으로 옮긴다. mine − cut.value = gap 이 유지되도록,
  // L1·L2의 컷은 **내 눈금의 백분위 상당**으로 적는다(실제 환산점수는 cut.score70에 그대로 있다).
  function decorateLayer(layer, env) {
    const { profile, dept, reference, shell, score, mine, std, context, university } = env;
    const blockers = [...(score?.blockers || []), ...(layer.blockers || [])];
    const status = blockers.length > 0 ? 'blocked' : 'ok';
    const gap = layer.pctEq;
    const estimateBand = bandOf(gap, VERDICT_BANDS);
    // 70%컷은 보장선이 아니다 — 50% 지점을 넘지 못하면 '안정'을 '적정'으로 내린다.
    const band = estimateBand?.key === 'safe' && layer.above50 === false
      ? VERDICT_BANDS.find((row) => row.key === 'fit')
      : estimateBand;
    const gapRange = isNumber(layer.gapMin) && isNumber(layer.gapMax) && (layer.gapMin !== gap || layer.gapMax !== gap)
      ? { min: layer.gapMin, max: layer.gapMax, minBand: bandOf(layer.gapMin, VERDICT_BANDS), maxBand: bandOf(layer.gapMax, VERDICT_BANDS) }
      : null;
    const mineValue = mine ? mine.value : null;
    const cutValue = isNumber(mineValue) && isNumber(gap) ? round(mineValue - gap, 2) : null;
    const row = layer.cutRow;
    const avgGap = isNumber(mineValue) && isNumber(row?.cut70) ? round(mineValue - row.cut70, VERDICT_DIGITS) : null;
    const floor = isNumber(row?.cut100) && isNumber(mineValue)
      ? { year: layer.cutYear, value: row.cut100, cleared: mineValue >= row.cut100 } : null;
    const fill = isNumber(row?.fill)
      ? { year: layer.cutYear, count: row.fill, rate: isNumber(row.fillRate) ? row.fillRate : null, lastWait: isNumber(row.lastWait) ? row.lastWait : null }
      : null;
    const formula = layer.track
      ? { year: layer.track.year ?? null, status: layer.track.status || null, sourceGrade: layer.track.sourceGrade || null, track: layer.track.name || null, source: layer.track.source || null }
      : null;
    const sources = [];
    if (layer.track?.source?.title) sources.push({ title: layer.track.source.title, url: layer.track.source.url || null });
    return attachModel({
      ...shell,
      status,
      group: row?.group || null,
      cut: {
        year: layer.cutYear,
        value: cutValue,
        kind: layer.level === 'L1' ? '70% 지점 · 환산 상당' : '70% 지점 · 지수 상당',
        basis: layer.level === 'L1' ? 'formula' : 'ratio',
        aggregation: layer.aggregation,
        score70: layer.cutScore70,
        score50: layer.cutScore50,
        student70: layer.student70,
        avg70: isNumber(row?.cut70) ? row.cut70 : null,
        verified: layer.level === 'L1',
        percentileCut: reference?.primary?.value ?? null,
        source: row?.source ?? reference?.primary?.source ?? null,
        url: row?.url ?? reference?.primary?.url ?? null,
      },
      gap,
      gapRange,
      hold: null,
      band: status === 'ok' ? band : null,
      estimateBand,
      estimated: mine ? mine.estimated : (profile?.mode === 'grade' || profile?.mode === 'raw'),
      bounds: mine ? mine.bounds : null,
      approxDef: reference?.approxDef ?? false,
      spread: reference?.spread ?? null,
      floor,
      fill,
      cut50: isNumber(row?.cut50) ? row.cut50 : null,
    }, {
      // 자격 미충족은 층위가 아니라 '없음'이다 (docs/MODEL.md §3 L0).
      level: status === 'blocked' ? 'L0' : layer.level,
      dept, university, reference, context, profile,
      cutYear: layer.cutYear,
      apply: { year: APPLY_YEAR, typeName: row?.typeName || '', group: row?.group || null, formula },
      mineDetail: layer.mineScore
        ? {
          score: layer.mineScore.value, min: layer.mineScore.min, max: layer.mineScore.max,
          parts: layer.mineScore.parts, adjustments: [],
          assumptions: layer.flags.includes('year-bridge')
            ? [`${profile.year || '내'} 수능 백분위를 ${std?.year || layer.cutYear} 수능 분포의 표준점수로 환산`]
            : [],
          unit: 'points',
        }
        : {
          score: layer.myIndex ? layer.myIndex.value : null,
          min: layer.myIndex ? layer.myIndex.value : null,
          max: layer.myIndex ? layer.myIndex.value : null,
          parts: layer.myIndex ? layer.myIndex.parts : [], adjustments: [], assumptions: [], unit: 'pct',
        },
      gapDetail: {
        points: layer.points, pctEq: gap, min: layer.gapMin, max: layer.gapMax,
        avgGap, basisChanged: layer.basisChanged === true, gap2026: layer.gap2026, gap2027: layer.gap2027,
      },
      areas: layer.areas || [],
      sensitivity: layer.sensitivity || null,
      cut2027: layer.cut2027 || null,
      flags: layer.flags || [],
      sources,
    });
  }

  // 한 모집단위에 대한 정시 판정.
  //   level : 'L1' | 'L2' | 'L3' | 'L0' — 데이터가 허락하는 가장 높은 층위 하나
  //   mine  : (옛 계약) 컷과 같은 정의로 만든 내 백분위 비교값. §7 계약은 result.model.mine 이다.
  //   gap   : (옛 계약) 백분위 상당 차이. L1은 환산점수 차 ÷ 국소 기울기다.
  //   cut   : (옛 계약) { value, year, kind … } + §7 { aggregation, score70, score50, student70, verified }
  //   index : 대학 반영비율로 만든 앱 자체 지수 — 컷에서 빼지 않는다(눈금이 다르다)
  //   status: ok · blocked(지원 자격 미충족) ·
  //           hold(그 정의에 필요한 성적이 없음) · basis-mismatch(환산점수 눈금이라 계산 불가) ·
  //           no-cut(백분위 컷 없음) · no-profile(성적 미입력)
  // 등급 입력은 보류하지 않는다 — 구간 중앙 백분위로 판정하고 estimated·gapRange로 폭을 알린다.
  // context = { std, conv, rules2026, rules2027, formulaCheck } — 없으면 L3까지만 간다.
  function evaluateJeongsi(profile, university, dept, rule, fallbackSpread, context = {}) {
    const reference = jeongsiReference(dept, isNumber(fallbackSpread) ? fallbackSpread : university?.volatility);
    // 반영비율 가중값은 지원 자격(blockers)과 화면 표시에만 쓴다. 컷과 비교하지 않는다.
    const score = universityScore(profile, rule, dept.track, dept.ruleTrack);
    const def = reference.def || COMPARE_BASIS;
    const mine = comparableScore(profile, def);
    const universityId = university?.id ?? null;
    const std = context.std || null;
    const layer = resolveLayer(profile, university, dept, rule, reference, context);
    const shell = {
      universityId,
      universityName: university?.short || university?.name || null,
      dept: dept?.name ?? null,
      track: dept?.track ?? null,
      reference,
      score,
      compare: mine,
      mine: mine ? mine.value : null,
      def,
      defLabel: cutDefInfo(def).label,
      index: score ? { value: score.value, basis: 'app-weighted', label: '반영비율 가중 지수', weighted: score.weighted } : null,
    };
    // L1·L2가 성립하면 그쪽이 이긴다 — 평균 백분위 컷이 없어도 판정이 나온다.
    if (layer) return decorateLayer(layer, { profile, university, dept, reference, shell, score, mine, def, std, context });
    const zero = (result) => attachModel(result, { level: 'L0', dept, university, reference, context, profile });
    if (!mine) {
      // 컷을 계산할 수 없는 두 가지를 가른다: 성적을 아예 안 넣었나(no-profile),
      // 이 정의에 필요한 영역만 비었나(hold).
      const missing = missingFor(profile, def);
      const entered = isNumber(profile?.kor?.pct) || isNumber(profile?.math?.pct) || (profile?.inquiries?.length > 0);
      if (!entered || missing.length === 0) return zero({ status: 'no-profile', ...shell, cut: null, gap: null, band: null });
      if (!reference.comparable) {
        return zero({
          status: 'basis-mismatch', ...shell, cut: null, gap: null, band: MISMATCH_BAND,
          hold: { reason: '환산점수 컷', need: '백분위 기준 입시결과' },
        });
      }
      return zero({
        status: 'hold', ...shell, cut: null, gap: null, band: HOLD_BAND,
        hold: { reason: `${missing.join('·')} 미입력`, need: missing.join('·') },
      });
    }
    if (!reference.primary) {
      // 컷이 없다. 환산점수로만 공개됐거나(계산 불가) 백분위 결과 자체가 없다.
      const mismatch = !reference.comparable || (reference.scoreRows || []).length > 0;
      return zero({
        status: mismatch ? 'basis-mismatch' : 'no-cut',
        ...shell,
        cut: null,
        gap: null,
        band: mismatch ? MISMATCH_BAND : null,
        hold: {
          reason: mismatch ? '환산점수 컷' : '컷 없음',
          need: mismatch ? '백분위로 공개된 70%컷' : '백분위 기준 입시결과',
        },
      });
    }
    const cutValue = reference.primary.value;
    // 반올림을 먼저 하고 그 값으로 판정한다 — 0.67을 '+0.7'로 적어 놓고 소신으로 부르지 않기 위해서다.
    const gap = round(mine.value - cutValue, VERDICT_DIGITS);
    const estimateBand = bandOf(gap, VERDICT_BANDS);
    // 등급만 넣었으면 값이 놓일 수 있는 구간이 넓다. 판정은 구간 **중앙값** 하나로 내고,
    // 하한·상한에서의 판정을 함께 돌려준다 — 화면이 폭을 값으로만 적는다.
    let gapRange = null;
    if (mine.bounds) {
      const low = round(mine.bounds.min - cutValue, VERDICT_DIGITS);
      const high = round(mine.bounds.max - cutValue, VERDICT_DIGITS);
      gapRange = { min: low, max: high, minBand: bandOf(low, VERDICT_BANDS), maxBand: bandOf(high, VERDICT_BANDS) };
    }
    const blocked = (score?.blockers || []).length > 0;
    const status = blocked ? 'blocked' : 'ok';
    // 판정은 70%컷만 본다. 100%컷(최종등록자 최저)과 추가합격은 옆에 적기만 하는 참고값이다.
    const latest = dept.jeongsi?.[reference.primary.year] || null;
    const floor = latest && isNumber(latest.cut100)
      ? { year: reference.primary.year, value: latest.cut100, cleared: mine.value >= latest.cut100 }
      : null;
    const fill = latest && isNumber(latest.fill)
      ? {
        year: reference.primary.year, count: latest.fill,
        rate: isNumber(latest.fillRate) ? latest.fillRate : null,
        lastWait: isNumber(latest.lastWait) ? latest.lastWait : null,
      }
      : null;
    const cutYear = reference.primary.year;
    return attachModel({
      ...shell,
      status,
      group: dept.jeongsi?.[cutYear]?.group || dept.jeongsi?.[Object.keys(dept.jeongsi || {}).sort().at(-1)]?.group || null,
      cut: {
        ...reference.primary,
        aggregation: String(latest?.aggregation || 'adiga-score-rank'),
        score70: cutRowScore(latest, 'p70'),
        score50: cutRowScore(latest, 'p50'),
        student70: normalizeCutStudent(latest?.student?.p70),
        avg70: isNumber(latest?.cut70) ? latest.cut70 : null,
        verified: false,
        percentileCut: reference.primary.value,
      },
      gap,
      gapRange,
      hold: null,
      // 불가에는 판정 띠를 주지 않는다. 화면이 상태 뱃지를 쓰게 한다.
      band: status === 'ok' ? estimateBand : null,
      estimateBand,
      estimated: mine.estimated,
      bounds: mine.bounds,
      approxDef: reference.approxDef,
      spread: reference.spread,
      floor,
      fill,
      cut50: latest && isNumber(latest.cut50) ? latest.cut50 : null,
    }, {
      level: status === 'blocked' ? 'L0' : 'L3',
      dept, university, reference, context, profile,
      mineDetail: { score: mine.value, min: mine.bounds?.min ?? mine.value, max: mine.bounds?.max ?? mine.value, parts: [], adjustments: [], assumptions: mine.assumptions || [], unit: 'pct' },
      gapDetail: {
        points: null, pctEq: gap, min: gapRange?.min ?? gap, max: gapRange?.max ?? gap,
        avgGap: gap, basisChanged: false, gap2026: null,
      },
      cutYear,
    });
  }

  // 수시(교과·학종) 판정. 내신 등급이 없으면 null.
  function evaluateSusi(profile, dept, kind) {
    if (!isNumber(profile?.gpa)) return null;
    const rows = dept?.[kind] || {};
    const years = Object.keys(rows).sort().reverse().filter((year) => isNumber(rows[year]?.cut70));
    if (years.length === 0) return null;
    const latest = { year: years[0], ...rows[years[0]] };
    const gap = round(latest.cut70 - profile.gpa, 2);
    const values = years.map((year) => rows[year].cut70);
    return {
      kind,
      typeName: latest.typeName || '',
      cut: latest.cut70,
      year: latest.year,
      gap,
      band: bandOf(gap, SUSI_BANDS),
      range: { min: Math.min(...values), max: Math.max(...values), years },
      source: latest.source,
      url: latest.url,
    };
  }

  // 목록 정렬 두 가지.
  //   byCutDesc : 라인 순위(서연고→서성한→…)가 1차 키, 예상 컷 내림차순이 2차 키다 (docs/FRAME.md §8.3).
  //               같은 대학·같은 컷이면 모집단위 이름 순.
  //   byGapAsc  : 컷과의 차이가 작은(아슬아슬한) 곳부터 — 판정별 묶음 안의 순서.
  function byCutDesc(left, right) {
    const lineLeft = left.universityOrder ?? 0;
    const lineRight = right.universityOrder ?? 0;
    if (lineLeft !== lineRight) return lineLeft - lineRight;
    const l = left.jeongsi?.cut?.value;
    const r = right.jeongsi?.cut?.value;
    if (isNumber(l) && isNumber(r)) {
      if (l !== r) return r - l;
    } else if (isNumber(l) !== isNumber(r)) {
      return isNumber(l) ? -1 : 1;
    }
    return String(left.dept?.name || '').localeCompare(String(right.dept?.name || ''), 'ko');
  }
  function byGapAsc(left, right) {
    const l = left.jeongsi?.gap;
    const r = right.jeongsi?.gap;
    if (isNumber(l) && isNumber(r)) {
      if (l !== r) return l - r;
    } else if (isNumber(l) !== isNumber(r)) {
      return isNumber(l) ? -1 : 1;
    }
    return (left.universityOrder ?? 0) - (right.universityOrder ?? 0);
  }

  // 전체 진단: 모든 대학·모집단위를 판정해 정렬한다.
  // filters: { track, universities:Set, group, sort: 'cut' | 'gap' }
  // 생성 데이터에서 층위 판정에 필요한 것만 뽑아 둔다. 없는 항목은 그냥 없다 —
  // rules2026·formulaCheck가 아직 없으면 판정은 지금까지처럼 L3에서 난다.
  function layerContext(data) {
    if (!data) return {};
    return { std: data.std || null, conv: data.conv || null, rules2026: data.rules2026 || null, rules2027: data.rules2027 || null, formulaCheck: data.formulaCheck || null };
  }

  function diagnose(profile, data, filters = {}) {
    const rows = [];
    const context = layerContext(data);
    for (const university of data.universities || []) {
      if (filters.universities && filters.universities.size > 0 && !filters.universities.has(university.id)) continue;
      const rule = data.rules?.[university.id];
      for (const dept of university.departments || []) {
        if (filters.track && filters.track !== '전체' && dept.track !== filters.track) continue;
        const result = evaluateJeongsi(profile, university, dept, rule, university.volatility ?? data.volatility, context);
        if (filters.group && filters.group !== '전체' && result.group && result.group !== filters.group) continue;
        rows.push({
          universityId: university.id,
          universityName: university.short || university.name,
          universityOrder: university.order ?? 0,
          dept,
          jeongsi: result,
          gyogwa: evaluateSusi(profile, dept, 'gyogwa'),
          hakjong: evaluateSusi(profile, dept, 'hakjong'),
        });
      }
    }
    rows.sort(filters.sort === 'gap' ? byGapAsc : byCutDesc);
    return rows;
  }

  // 목표 학과: 필요한 상승폭과 영역별 투자 효율.
  // 상승폭은 **비교 기준(국·수·탐(2) 평균)** 위에서 잰다 — 컷이 그 눈금이기 때문이다.
  // 그래서 세 영역의 비중은 대학 반영비율이 아니라 각각 1/3이고, 영어는 이 눈금에 들어가지
  // 않는다(대학 반영비율은 화면이 따로 적는다).
  function analyzeTarget(profile, university, dept, rule, fallbackSpread, context = {}) {
    const result = evaluateJeongsi(profile, university, dept, rule, fallbackSpread ?? university?.volatility, context);
    if (['no-profile', 'no-cut', 'basis-mismatch', 'hold'].includes(result.status)) return { ...result, plan: null };
    const { score } = result;
    const need = round(Math.max(0, result.cut.value + TARGET_MARGIN - result.mine), 2);
    const subjects = [];
    const inquiryRows = [...profile.inquiries].sort((left, right) => right.pct - left.pct).slice(0, 2);
    const addSubject = (key, label, current, share) => {
      if (!isNumber(current) || share <= 0) return;
      const perPoint = round(share, 3);
      const headroom = 100 - current;
      const needed = need > 0 ? round(need / share, 1) : 0;
      const reachable = needed <= headroom;
      const targetPct = reachable ? round(current + needed, 1) : 100;
      const currentGrade = gradeFromPercentile(current);
      const targetGrade = gradeFromPercentile(targetPct);
      // 효율 = 영역 비중 × 남은 여지. 이미 99인 영역은 올릴 곳이 없다.
      const efficiency = share * clamp(headroom / 10, 0, 1);
      // 이 영역만 100까지 올려도 모자라는 폭(백분위 점). 화면이 "얼마나 모자란지"를 말할 때 쓴다.
      const shortfall = need > 0 ? round(Math.max(0, need - headroom * share), 1) : 0;
      subjects.push({ key, label, current: round(current, 1), share: perPoint, needed, reachable, shortfall, targetPct, currentGrade, targetGrade, gradesUp: Math.max(0, currentGrade - targetGrade), efficiency: round(efficiency, 3) });
    };
    // 몫은 컷의 통계 정의가 정한다 — 국·탐 눈금이면 수학 몫은 0이라 화면에 나오지 않는다.
    const shares = scaleShares(result.def || COMPARE_BASIS, profile);
    addSubject('kor', `국어(${profile.kor.elective})`, profile.kor.pct, shares.kor);
    addSubject('math', `수학(${profile.math.elective})`, profile.math.pct, shares.math);
    for (const row of inquiryRows.slice(0, shares.inqUse)) addSubject(row.slot, `탐구 ${row.subject}`, row.pct, shares.inq);
    const ranked = [...subjects].sort((left, right) => right.efficiency - left.efficiency);
    // 세 영역을 같은 폭으로 올릴 때 필요한 상승폭(단순평균이므로 = need).
    const uniform = need > 0 ? round(need, 1) : 0;
    return {
      ...result,
      plan: {
        need,
        margin: TARGET_MARGIN,
        basis: result.def || COMPARE_BASIS,
        basisLabel: cutDefInfo(result.def || COMPARE_BASIS).label,
        subjects,
        ranked,
        best: ranked[0] || null,
        uniform,
        // 영어·한국사는 비교 기준(국·수·탐 평균)에 들어가지 않는다 — 여기서 상승 효과를 계산하지 않는다.
        english: null,
        // 대학 반영비율과 가감점은 참고로만 넘긴다(비교값에 더하지 않는다).
        weights: score.shares,
        adjustments: score.adjustments,
        blockers: score.blockers,
      },
      gyogwa: evaluateSusi(profile, dept, 'gyogwa'),
      hakjong: evaluateSusi(profile, dept, 'hakjong'),
    };
  }

  // 선택과목 유불리 요약(scales.exams[year]) — 같은 원점수의 만점 표준점수 차이 등을 화면이 쓴다.
  function electiveSummary(scales, year) {
    const exam = scales?.exams?.[year];
    if (!exam) return null;
    const pick = (key) => exam.subjects?.[key] || null;
    const summarize = (keys) => keys.map((key) => ({ key, label: key.split('-').pop(), maxStd: pick(key)?.maxStd ?? null, share: exam.electiveShare?.[key.split('-')[0]]?.[key.split('-').pop()] ?? null }));
    return {
      year,
      kor: summarize(KOR_ELECTIVES.map((name) => `국어-${name}`)),
      math: summarize(MATH_ELECTIVES.map((name) => `수학-${name}`)),
    };
  }

  const api = Object.freeze({
    GRADE_FLOORS, GRADE_MIDPOINTS, SOCIAL_SUBJECTS, SCIENCE_SUBJECTS, KOR_ELECTIVES, MATH_ELECTIVES, SUBJECT_LABEL,
    VERDICT_BANDS, SUSI_BANDS, TARGET_MARGIN, VERDICT_DIGITS, bandOf,
    gradeFromPercentile, percentileFromGrade, percentileFloorOfGrade, percentileFromRaw, inquiryKind,
    normalizeProfile, profileComplete, inquiryPercentile, simpleAverage, pickTrack, universityScore,
    CUT_DEFS, COMPARE_BASIS, cutDefInfo, cutScale, SCALE_NEEDS, HOLD_BAND, MISMATCH_BAND,
    comparableScore, missingFor, areaValues, scaleValue, scaleShares, percentileRangeOfGrade, gradeBounds,
    percentileFromStd, gradeFromStd, conversionTable, convertedStd, universityRawScore, stdKeyOf,
    jeongsiReference, evaluateJeongsi, evaluateSusi, diagnose, analyzeTarget, electiveSummary, round,
    byCutDesc, byGapAsc,
    // 판정 모델 v3 (docs/MODEL.md)
    stdRangeFromPercentile, stdSubjectKeys, formulaScore2, adaptLegacyFormulaTrack,
    myFormulaInputs, studentFormulaInputs, profileFormulaInputs, normalizeCutStudent,
    pickModelTrack, ratioWeights, ratioIndex, trackHasFormula, layerContext,
    APPLY_YEAR, LAYER_UNCERTAINTY,
  });
  globalThis.IPSI_ENGINE = api;
})();
