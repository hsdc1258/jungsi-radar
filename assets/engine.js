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
//   - **차이를 낼 수 있는 값은 하나뿐이다.** 컷이 '국·수·탐(2) 백분위 단순평균'이므로 우리도
//     같은 정의의 값(comparableScore)만 컷에서 뺀다. 정의가 다른 값(상위 2개 영역 평균 등)은
//     빼지 않고 'basis-mismatch'로 보류한다.
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
  const CUT_DEFS = Object.freeze({
    'ksi-mean': { label: '국·수·탐(2) 백분위 단순평균', comparable: true, approx: false },
    'subject-mean70': { label: '과목별 70%컷의 국·수·탐 산술평균', comparable: true, approx: true },
    'top2-mean': { label: '국·수·탐(2) 중 상위 2개 영역 백분위 평균', comparable: false, approx: false },
  });
  const COMPARE_BASIS = 'ksi-mean';
  const cutDefInfo = (key) => CUT_DEFS[key] || CUT_DEFS[COMPARE_BASIS];
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
    return {
      mode,
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
  // 등급 입력 프로필의 비교값이 놓일 수 있는 구간(국·수·탐(2) 평균 기준).
  function gradeBounds(profile) {
    const rangeOf = (pct) => percentileRangeOfGrade(gradeFromPercentile(pct));
    const kor = rangeOf(profile.kor.pct);
    const math = rangeOf(profile.math.pct);
    const rows = [...(profile.inquiries || [])].slice(0, 2).map((row) => rangeOf(row.pct));
    if (rows.length === 0) return null;
    const inqMin = rows.reduce((sum, row) => sum + row.min, 0) / rows.length;
    const inqMax = rows.reduce((sum, row) => sum + row.max, 0) / rows.length;
    return {
      min: round((kor.min + math.min + inqMin) / 3, 2),
      max: round((kor.max + math.max + inqMax) / 3, 2),
    };
  }

  // 판정에 쓰는 **비교값**. 컷과 같은 정의(국·수·탐(2) 백분위 단순평균) 하나뿐이다.
  //   value      : 컷에서 뺄 수 있는 값
  //   estimated  : 등급·원점수 입력이라 대표값을 가정한 경우 true
  //   bounds     : 등급 입력일 때 값이 놓일 수 있는 구간(등급 경계에서 나온다)
  //   assumptions: 무엇을 무엇으로 가정했는지 (화면이 그대로 적는다)
  function comparableScore(profile) {
    if (!profileComplete(profile)) return null;
    const mode = profile.mode || 'pct';
    const inq = inquiryPercentile(profile, 2);
    const value = round((profile.kor.pct + profile.math.pct + inq) / 3, 2);
    const assumptions = [];
    if (mode === 'grade') {
      const say = (label, pct) => {
        const grade = gradeFromPercentile(pct);
        const span = percentileRangeOfGrade(grade);
        assumptions.push(`${label} ${grade}등급 → ${pct} (구간 ${span.min}~${span.max}의 중앙)`);
      };
      say('국어', profile.kor.pct);
      say('수학', profile.math.pct);
      for (const row of (profile.inquiries || []).slice(0, 2)) say(`탐구 ${row.subject}`, row.pct);
    } else if (mode === 'raw') {
      assumptions.push('원점수 → 백분위는 등급컷 표 사이를 이은 추정값입니다');
    }
    return {
      basis: COMPARE_BASIS,
      label: CUT_DEFS[COMPARE_BASIS].label,
      value,
      mode,
      estimated: mode === 'grade' || mode === 'raw',
      bounds: mode === 'grade' ? gradeBounds(profile) : null,
      assumptions,
    };
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
  function conversionTable(conv, universityId) {
    const official = conv?.universities?.[universityId];
    if (official?.table) {
      return { kind: 'official', table: official.table, name: official.name, note: official.note, source: official.source, formula: official.formula || null };
    }
    if (conv?.approx?.table) return { kind: 'approx', table: conv.approx.table, note: conv.approx.note, source: null, formula: null };
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

  // 입학처가 낸 산출식(conv.universities[id].formula)을 그대로 계산한다.
  //   각 영역 = 지표(표준점수/변환점수/등급 배점) × 계수, 합에 scale(× multiply ÷ divide)을 걸고
  //   한국사 감점을 뺀다. 대학이 적어 둔 반올림 자리수(roundTo)까지 맞춘다.
  function formulaScore(profile, formula, deptTrack, table, std) {
    const tracks = Array.isArray(formula?.tracks) ? formula.tracks : [];
    const spec = tracks.find((row) => (row.appliesTo || []).includes(deptTrack)) || tracks[0];
    if (!spec) return null;
    const parts = [];
    const areaValue = (area, config, best) => {
      if (!config) return null;
      const factor = Number(config.factor) || 1;
      if (area === 'eng') {
        const value = Number(config.table?.[String(profile.eng.grade)]);
        return Number.isFinite(value) ? value : null;
      }
      if (area === 'inq') {
        const rows = [...(profile.inquiries || [])].sort((left, right) => right.pct - left.pct).slice(0, Number(config.count) || 2);
        if (rows.length === 0) return null;
        const each = rows.map((row) => {
          const converted = best ? convertedStd(100, table) : convertedStd(row.pct, table);
          if (converted === null) return null;
          const bonus = row.kind === 'science' ? Number(config.scienceBonus) || 0 : Number(config.socialBonus) || 0;
          return converted * (1 + bonus);
        });
        if (each.some((value) => value === null)) return null;
        const sum = each.reduce((total, value) => total + value, 0);
        return factor * (config.aggregate === 'mean' ? sum / each.length : sum);
      }
      const source = area === 'kor' ? profile.kor : profile.math;
      const value = best ? std?.subjects?.[stdKeyOf(area)]?.maxStd : source.std;
      return isNumber(value) ? factor * value : null;
    };
    const compute = (best) => {
      let sum = 0;
      for (const area of ['kor', 'math', 'eng', 'inq']) {
        const config = area === 'eng' ? spec.eng : spec[area];
        if (!config) continue;
        const value = best && area === 'eng' ? Number(config.table?.['1']) : areaValue(area, config, best);
        if (value === null || !Number.isFinite(value)) return null;
        if (!best) parts.push({ key: area, label: SUBJECT_LABEL[area], points: round(value, 4) });
        sum += value;
      }
      const scale = spec.scale || {};
      const multiply = Number(scale.multiply) || 1;
      const divide = Number(scale.divide) || 1;
      let scaled = (sum * multiply) / divide;
      const history = best ? 0 : Number(spec.hist?.table?.[String(profile.hist.grade)]) || 0;
      scaled -= history;
      return { value: round(scaled, Number(formula.roundTo) || 4), history: round(history, 4) };
    };
    const mine = compute(false);
    if (!mine) return null;
    const top = compute(true);
    return {
      basis: 'official', approx: false, track: spec.name, parts,
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
        const top = Number(conversion.table['100']);
        const each = rows.map((row) => convertedStd(row.pct, conversion.table));
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
        .filter((year) => (dept.jeongsi[year].metric || 'pct') === 'pct' && isNumber(dept.jeongsi[year].cut70)
          && cutDefInfo(dept.jeongsi[year].def).comparable)
        .map((year) => ({ year, value: dept.jeongsi[year].cut70, kind: '70%컷', def: dept.jeongsi[year].def || COMPARE_BASIS, basis: 'adiga', source: dept.jeongsi[year].source, url: dept.jeongsi[year].url }));
    }
    series = [...series].sort((left, right) => right.year.localeCompare(left.year));
    // 비교 기준(정의)이 섞이지 않았는지 여기서 한 번 더 본다 — 생성물이 바뀌어도 엔진이 막는다.
    const defs = [...new Set(series.map((row) => row.def || COMPARE_BASIS))];
    const comparable = defs.every((key) => cutDefInfo(key).comparable);
    const approxDef = defs.some((key) => cutDefInfo(key).approx);
    const excluded = years
      .map((year) => ({ year, row: dept.jeongsi[year] }))
      .filter(({ row }) => row && (row.metric || 'pct') === 'pct' && isNumber(row.cut70) && !cutDefInfo(row.def).comparable)
      .map(({ year, row }) => ({ year, def: row.def, label: cutDefInfo(row.def).label, value: row.cut70, source: row.source, url: row.url }));

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
      basis: COMPARE_BASIS, basisLabel: CUT_DEFS[COMPARE_BASIS].label,
      defs, comparable, approxDef, excluded,
      primary, series, history, estimates, scoreRows, range, spread, official: dept.official || {},
    };
  }

  function bandOf(gap, bands) {
    if (!isNumber(gap)) return null;
    return bands.find((band) => gap >= band.min) || bands[bands.length - 1];
  }

  // 한 모집단위에 대한 정시 판정.
  //   mine  : 컷과 같은 정의의 비교값(국·수·탐(2) 백분위 단순평균)
  //   index : 대학 반영비율로 만든 앱 자체 지수 — 컷에서 빼지 않는다(눈금이 다르다)
  //   status: ok · hold(등급만이라 판정 보류) · basis-mismatch(컷 정의 불일치) ·
  //           no-cut(비교 가능한 컷 없음) · no-profile · blocked(지원 자격 미충족)
  function evaluateJeongsi(profile, university, dept, rule, fallbackSpread) {
    const reference = jeongsiReference(dept, isNumber(fallbackSpread) ? fallbackSpread : university?.volatility);
    // 반영비율 가중값은 지원 자격(blockers)과 화면 표시에만 쓴다. 컷과 비교하지 않는다.
    const score = universityScore(profile, rule, dept.track, dept.ruleTrack);
    const mine = comparableScore(profile);
    const shell = {
      universityId: university?.id ?? null,
      universityName: university?.short || university?.name || null,
      dept: dept?.name ?? null,
      track: dept?.track ?? null,
      reference,
      score,
      compare: mine,
      mine: mine ? mine.value : null,
      index: score ? { value: score.value, basis: 'app-weighted', label: '반영비율 가중 지수', weighted: score.weighted } : null,
    };
    if (!score || !mine) return { status: 'no-profile', ...shell, cut: null, gap: null, band: null };
    if (!reference.primary) {
      const mismatch = reference.excluded.length > 0;
      return {
        status: mismatch ? 'basis-mismatch' : 'no-cut',
        ...shell,
        cut: null,
        gap: null,
        band: mismatch ? MISMATCH_BAND : null,
        hold: {
          reason: mismatch
            ? `컷이 ${reference.excluded[0].label}이라 국·수·탐 평균과 뺄 수 없습니다`
            : '백분위로 공개된 정시 결과가 없습니다',
          need: mismatch ? '같은 정의(국·수·탐(2) 평균)의 공개값' : '백분위 기준 입시결과',
        },
      };
    }
    const cutValue = reference.primary.value;
    // 반올림을 먼저 하고 그 값으로 판정한다 — 0.67을 '+0.7'로 적어 놓고 소신으로 부르지 않기 위해서다.
    const gap = round(mine.value - cutValue, VERDICT_DIGITS);
    const estimateBand = bandOf(gap, VERDICT_BANDS);
    // 등급만 넣었으면 값이 놓일 수 있는 구간이 판정 띠 하나보다 훨씬 넓다. 구간이 두 띠 이상에
    // 걸치면 한 띠를 고르지 않고 보류한다 — 대표 백분위 하나로 정밀한 판정을 내리지 않는다.
    let gapRange = null;
    let hold = null;
    if (mine.bounds) {
      const low = round(mine.bounds.min - cutValue, VERDICT_DIGITS);
      const high = round(mine.bounds.max - cutValue, VERDICT_DIGITS);
      const lowBand = bandOf(low, VERDICT_BANDS);
      const highBand = bandOf(high, VERDICT_BANDS);
      gapRange = { min: low, max: high, minBand: lowBand, maxBand: highBand };
      if (lowBand.key !== highBand.key) {
        hold = {
          reason: '등급만으로는 백분위 구간이 넓어 판정을 보류합니다',
          need: '국어·수학·탐구 백분위(또는 표준점수)',
          span: `${highBand.label} ~ ${lowBand.label}`,
        };
      }
    }
    const blocked = score.blockers.length > 0;
    const status = blocked ? 'blocked' : hold ? 'hold' : 'ok';
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
    return {
      ...shell,
      status,
      group: dept.jeongsi?.[reference.primary.year]?.group || dept.jeongsi?.[Object.keys(dept.jeongsi || {}).sort().at(-1)]?.group || null,
      cut: reference.primary,
      gap,
      gapRange,
      hold,
      // 보류·불가에는 판정 띠를 주지 않는다. 화면이 상태 뱃지를 쓰게 한다.
      band: status === 'ok' ? estimateBand : status === 'hold' ? HOLD_BAND : null,
      estimateBand,
      estimated: mine.estimated,
      approxDef: reference.approxDef,
      spread: reference.spread,
      floor,
      fill,
      cut50: latest && isNumber(latest.cut50) ? latest.cut50 : null,
    };
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
  function diagnose(profile, data, filters = {}) {
    const rows = [];
    for (const university of data.universities || []) {
      if (filters.universities && filters.universities.size > 0 && !filters.universities.has(university.id)) continue;
      const rule = data.rules?.[university.id];
      for (const dept of university.departments || []) {
        if (filters.track && filters.track !== '전체' && dept.track !== filters.track) continue;
        const result = evaluateJeongsi(profile, university, dept, rule, university.volatility ?? data.volatility);
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
  function analyzeTarget(profile, university, dept, rule, fallbackSpread) {
    const result = evaluateJeongsi(profile, university, dept, rule, fallbackSpread ?? university?.volatility);
    if (['no-profile', 'no-cut', 'basis-mismatch'].includes(result.status)) return { ...result, plan: null };
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
    const third = 1 / 3;
    addSubject('kor', `국어(${profile.kor.elective})`, profile.kor.pct, third);
    addSubject('math', `수학(${profile.math.elective})`, profile.math.pct, third);
    const inqShareEach = third / Math.max(1, inquiryRows.length);
    for (const row of inquiryRows) addSubject(row.slot, `탐구 ${row.subject}`, row.pct, inqShareEach);
    const ranked = [...subjects].sort((left, right) => right.efficiency - left.efficiency);
    // 세 영역을 같은 폭으로 올릴 때 필요한 상승폭(단순평균이므로 = need).
    const uniform = need > 0 ? round(need, 1) : 0;
    return {
      ...result,
      plan: {
        need,
        margin: TARGET_MARGIN,
        basis: COMPARE_BASIS,
        basisLabel: CUT_DEFS[COMPARE_BASIS].label,
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
    CUT_DEFS, COMPARE_BASIS, cutDefInfo, HOLD_BAND, MISMATCH_BAND, comparableScore, percentileRangeOfGrade, gradeBounds,
    percentileFromStd, gradeFromStd, conversionTable, convertedStd, universityRawScore, stdKeyOf,
    jeongsiReference, evaluateJeongsi, evaluateSusi, diagnose, analyzeTarget, electiveSummary, round,
    byCutDesc, byGapAsc,
  });
  globalThis.IPSI_ENGINE = api;
})();
