// 한 화면에서 재는 것들. 브라우저 안에서 도는 함수라 밖의 변수를 쓰지 않는다.
// shots.mjs 와 e2e.mjs 가 page.evaluate(measure) 로 같은 함수를 쓴다.
export function measure() {
  const out = { over: 0, offenders: [], truncated: [], overlaps: [], small: [], contrast: [], empty: false };
  out.over = document.documentElement.scrollWidth - window.innerWidth;
  if (out.over > 0) {
    for (const node of document.querySelectorAll('body *')) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.right > window.innerWidth + 1) {
        out.offenders.push(`${node.tagName}.${(node.className || '').toString().split(' ')[0]} right=${Math.round(rect.right)}`);
      }
    }
    out.offenders = out.offenders.slice(0, 5);
  }
  const panel = document.getElementById('panel');
  out.empty = !panel || panel.childElementCount === 0;
  // 잘린 텍스트: 넘치는 것을 숨기는 칸인데 내용이 더 넓다.
  for (const node of document.querySelectorAll('#panel *')) {
    if (node.children.length > 0) continue;
    const style = getComputedStyle(node);
    if (style.overflowX === 'visible' && style.overflow === 'visible') continue;
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    if (node.scrollWidth > node.clientWidth + 1) {
      out.truncated.push(`${node.tagName}.${(node.className || '').toString().split(' ')[0]}: ${(node.textContent || '').slice(0, 24)}`);
    }
  }
  out.truncated = out.truncated.slice(0, 4);
  // 대비: 본문·부제·머리글이 배경과 4.5:1 이상인지 (WCAG AA). 반투명 배경은 재지 않는다.
  const luminance = (color) => {
    const parts = (color.match(/[\d.]+/gu) || []).map(Number);
    if (parts.length < 3) return null;
    if (parts.length > 3 && parts[3] < 1) return null;
    const [r, g, b] = parts.slice(0, 3).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const backgroundOf = (node) => {
    let current = node;
    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      if (color && !/rgba\(0, 0, 0, 0\)|transparent/u.test(color)) return color;
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  for (const selector of ['.seed-list-item__title', '.seed-list-item__detail', '.jr-group-head', '.jr-stat-label', '.jr-muted', '.jr-gap']) {
    const node = document.querySelector(`#panel ${selector}`);
    if (!node) continue;
    const front = luminance(getComputedStyle(node).color);
    const back = luminance(backgroundOf(node));
    if (front === null || back === null) continue;
    const ratio = (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
    if (ratio < 4.5) out.contrast.push(`${selector} ${Math.round(ratio * 100) / 100}:1`);
  }
  // 터치 타깃: 누를 수 있는 것은 44px 이상이어야 한다 (Apple HIG).
  const seen = new Set();
  for (const node of document.querySelectorAll('#panel button, #panel select, #panel input, #panel summary, #panel a, #panel [role="checkbox"]')) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.height >= 43.5 && rect.width >= 43.5) continue;
    const key = `${node.tagName}.${(node.className || '').toString().split(' ')[0]}: ${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.small.push(`${key} "${(node.textContent || '').trim().slice(0, 12)}"`);
  }
  out.small = out.small.slice(0, 6);
  // 겹침: 맨 위에서 첫 내용이 고정바에 가리는지, 스크롤 중 고정바가 비치거나 내용에 덮이는지.
  const head = document.querySelector('.jr-head');
  // 바텀시트가 떠 있는 동안은 고정바를 덮는 것이 맞다(모달) — 겹침을 재지 않는다.
  if (head && panel && !document.querySelector('.jr-sheet')) {
    window.scrollTo(0, 0);
    const headRect = head.getBoundingClientRect();
    const first = panel.firstElementChild;
    if (first && first.getBoundingClientRect().top < headRect.bottom - 1) {
      out.overlaps.push(`첫 내용이 고정바에 가림 (${Math.round(first.getBoundingClientRect().top)} < ${Math.round(headRect.bottom)})`);
    }
    const background = getComputedStyle(head).backgroundColor;
    if (/rgba\(/u.test(background) && !/,\s*1\)$/u.test(background)) out.overlaps.push(`고정바 배경이 비침 ${background}`);
    window.scrollTo(0, 400);
    const probe = document.elementFromPoint(Math.round(headRect.left + headRect.width / 2), Math.round(headRect.bottom - 6));
    if (probe && !head.contains(probe)) {
      out.overlaps.push(`스크롤 중 내용이 고정바 위로 올라옴: ${probe.tagName}.${(probe.className || '').toString().split(' ')[0]}`);
    }
    window.scrollTo(0, 0);
  }
  return out;
}
