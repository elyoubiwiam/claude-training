// Small SVG and HTML charts with no library. Text is always set with textContent.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
}

function htmlEl(tag, className, text, parent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  if (parent) parent.append(el);
  return el;
}

// --- tooltip -------------------------------------------------------------------

let tip;
function getTip() {
  if (!tip) {
    tip = htmlEl('div', 'tooltip');
    tip.hidden = true;
    document.body.append(tip);
  }
  return tip;
}

/** rows: [{ value, name, color, kind: 'line' | 'rect' }] */
export function showTip(clientX, clientY, title, rows) {
  const t = getTip();
  t.replaceChildren();
  htmlEl('div', 'tip-title', title, t);
  for (const r of rows) {
    const row = htmlEl('div', 'tip-row', undefined, t);
    if (r.color) {
      const key = htmlEl('span', `tip-key ${r.kind === 'rect' ? 'rect' : 'line'}`, undefined, row);
      key.style.background = r.color;
    }
    htmlEl('strong', '', r.value, row);
    if (r.name) htmlEl('span', 'tip-name', r.name, row);
  }
  t.hidden = false;
  const { width, height } = t.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY + 14;
  if (left + width > window.innerWidth - 8) left = Math.max(8, clientX - width - 14);
  if (top + height > window.innerHeight - 8) top = Math.max(8, clientY - height - 14);
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

export function hideTip() {
  if (tip) tip.hidden = true;
}

function tipAtElement(el, title, rows) {
  const box = el.getBoundingClientRect();
  showTip(box.left + box.width / 2, box.top, title, rows);
}

// --- helpers -------------------------------------------------------------------

function niceScale(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { min: lo, max: hi, ticks };
}

/** Draws at the element's real width and redraws when it changes size. */
function mount(el, draw) {
  el._draw = draw;
  if (!el._observer) {
    el._observer = new ResizeObserver(() => {
      const w = Math.floor(el.clientWidth);
      if (w > 0 && w !== el._width) {
        el._width = w;
        el._draw(w);
      }
    });
    el._observer.observe(el);
  }
  const w = Math.floor(el.clientWidth);
  if (w > 0) {
    el._width = w;
    draw(w);
  }
}

function cssVar(name) {
  return `var(${name})`;
}

function legend(parent, items) {
  const box = htmlEl('div', 'legend', undefined, parent);
  for (const item of items) {
    const entry = htmlEl('span', 'legend-item', undefined, box);
    const key = htmlEl('span', `legend-key ${item.kind || 'rect'}`, undefined, entry);
    key.style.background = cssVar(item.color);
    htmlEl('span', '', item.name, entry);
  }
  return box;
}

// --- line chart ------------------------------------------------------------------

/**
 * opts: { title, labels, series: [{ name, values, color }], format, refLine, height, endLabels }
 * Draws one y-axis only. A crosshair snaps to the nearest month and lists every series.
 */
export function lineChart(el, opts) {
  mount(el, (width) => {
    el.replaceChildren();
    const multi = opts.series.length > 1;
    if (multi) legend(el, opts.series.map((s) => ({ name: s.name, color: s.color, kind: 'line' })));

    const height = opts.height || 220;
    const endLabels = opts.endLabels !== false;
    const m = { top: 14, right: endLabels ? 104 : 18, bottom: 28, left: 44 };
    const plotW = Math.max(60, width - m.left - m.right);
    const plotH = height - m.top - m.bottom;
    const all = opts.series.flatMap((s) => s.values);
    if (opts.refLine !== undefined) all.push(opts.refLine);
    const scale = niceScale(Math.min(...all), Math.max(...all));
    const n = opts.labels.length;
    const x = (i) => m.left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
    const y = (v) => m.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;

    const svg = svgEl('svg', {
      width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': opts.title, tabindex: 0,
      class: 'chart-svg',
    }, el);

    for (const t of scale.ticks) {
      svgEl('line', { x1: m.left, x2: m.left + plotW, y1: y(t), y2: y(t), class: 'grid' }, svg);
      svgEl('text', { x: m.left - 8, y: y(t), class: 'axis-text', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, svg)
        .textContent = opts.tickFormat ? opts.tickFormat(t) : opts.format(t);
    }
    if (opts.refLine !== undefined) {
      svgEl('line', { x1: m.left, x2: m.left + plotW, y1: y(opts.refLine), y2: y(opts.refLine), class: 'baseline' }, svg);
    }
    opts.labels.forEach((label, i) => {
      svgEl('text', { x: x(i), y: height - 8, class: 'axis-text', 'text-anchor': 'middle' }, svg).textContent = label;
    });

    for (const s of opts.series) {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
      svgEl('path', { d, class: 'series-line', stroke: cssVar(s.color) }, svg);
    }
    // End markers and selective end labels.
    const ends = opts.series.map((s) => ({ s, y: y(s.values[n - 1]) }));
    const labelsFit = ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a.y - b.y) >= 16));
    for (const { s, y: ey } of ends) {
      svgEl('circle', { cx: x(n - 1), cy: ey, r: 4, class: 'marker', fill: cssVar(s.color) }, svg);
      if (endLabels && labelsFit) {
        const t = svgEl('text', { x: x(n - 1) + 10, y: ey, class: 'end-label', 'dominant-baseline': 'middle' }, svg);
        const value = svgEl('tspan', { class: 'end-value' }, t);
        value.textContent = s.endText || opts.format(s.values[n - 1]);
        if (multi) svgEl('tspan', { dx: 4 }, t).textContent = s.short || '';
      }
    }

    // Crosshair layer.
    const cross = svgEl('g', { class: 'crosshair', visibility: 'hidden' }, svg);
    const vline = svgEl('line', { y1: m.top, y2: m.top + plotH, class: 'cross-line' }, cross);
    const dots = opts.series.map((s) => svgEl('circle', { r: 4, class: 'marker', fill: cssVar(s.color) }, cross));
    const hit = svgEl('rect', { x: m.left - 12, y: 0, width: plotW + 24, height, fill: 'transparent' }, svg);

    let current = -1;
    const show = (i, clientX, clientY) => {
      current = i;
      cross.setAttribute('visibility', 'visible');
      vline.setAttribute('x1', x(i));
      vline.setAttribute('x2', x(i));
      dots.forEach((dot, k) => {
        dot.setAttribute('cx', x(i));
        dot.setAttribute('cy', y(opts.series[k].values[i]));
      });
      const rows = opts.series.map((s) => ({
        value: (s.tipFormat || opts.format)(s.values[i], i), name: multi ? s.name : '', color: cssVar(s.color), kind: 'line',
      }));
      if (clientX === undefined) {
        const box = svg.getBoundingClientRect();
        clientX = box.left + x(i);
        clientY = box.top + m.top;
      }
      showTip(clientX, clientY, opts.tipLabels ? opts.tipLabels[i] : opts.labels[i], rows);
    };
    const hide = () => {
      current = -1;
      cross.setAttribute('visibility', 'hidden');
      hideTip();
    };
    hit.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      const px = e.clientX - box.left;
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
      show(best, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', () => show(n - 1));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = Math.max(0, Math.min(n - 1, (current < 0 ? n - 1 : current) + (e.key === 'ArrowLeft' ? -1 : 1)));
        show(next);
      } else if (e.key === 'Escape') hide();
    });
  });
}

// --- column chart ----------------------------------------------------------------

function columnPath(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  if (h <= 0) return '';
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** opts: { title, labels, values, format, color, height, tipLabels }. One series, zero baseline, last column labelled. */
export function columnChart(el, opts) {
  mount(el, (width) => {
    el.replaceChildren();
    const height = opts.height || 200;
    const m = { top: 22, right: 12, bottom: 28, left: 48 };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;
    const scale = niceScale(0, Math.max(...opts.values));
    const n = opts.values.length;
    const band = plotW / n;
    const barW = Math.min(24, band * 0.6);
    const y = (v) => m.top + plotH - (v / scale.max) * plotH;

    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': opts.title, class: 'chart-svg' }, el);
    for (const t of scale.ticks) {
      svgEl('line', { x1: m.left, x2: m.left + plotW, y1: y(t), y2: y(t), class: t === 0 ? 'baseline' : 'grid' }, svg);
      svgEl('text', { x: m.left - 8, y: y(t), class: 'axis-text', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, svg)
        .textContent = (opts.tickFormat || opts.format)(t);
    }
    opts.values.forEach((v, i) => {
      const cx = m.left + band * i + band / 2;
      const group = svgEl('g', { class: 'col', tabindex: 0, role: 'img', 'aria-label': `${opts.tipLabels?.[i] || opts.labels[i]}: ${opts.format(v)}` }, svg);
      svgEl('rect', { x: m.left + band * i, y: m.top, width: band, height: plotH, fill: 'transparent' }, group);
      svgEl('path', { d: columnPath(cx - barW / 2, y(v), barW, y(0) - y(v), 4), fill: cssVar(opts.color || '--series-1'), class: 'col-bar' }, group);
      svgEl('text', { x: cx, y: height - 8, class: 'axis-text', 'text-anchor': 'middle' }, svg).textContent = opts.labels[i];
      if (i === n - 1) {
        svgEl('text', { x: cx, y: y(v) - 7, class: 'end-value', 'text-anchor': 'middle' }, svg).textContent = opts.format(v);
      }
      const title = opts.tipLabels?.[i] || opts.labels[i];
      const rows = [{ value: opts.format(v), color: cssVar(opts.color || '--series-1'), kind: 'rect' }];
      group.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, title, rows));
      group.addEventListener('pointerleave', hideTip);
      group.addEventListener('focus', () => tipAtElement(group, title, rows));
      group.addEventListener('blur', hideTip);
    });
  });
}

// --- horizontal bars (HTML, so long labels wrap) ----------------------------------

/**
 * opts: {
 *   title, max, legend: [{ name, color }],
 *   rows: [{ label, sub, segments: [{ name, value, color }], endText, tipTitle, tipRows }]
 * }
 * Segments stack from the left with a 2px gap; only the outer end is rounded.
 */
export function hBars(el, opts) {
  el.replaceChildren();
  if (opts.legend) legend(el, opts.legend);
  const list = htmlEl('div', 'hbars', undefined, el);
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', opts.title);
  const max = opts.max || Math.max(...opts.rows.map((r) => r.segments.reduce((t, s) => t + s.value, 0)));
  for (const row of opts.rows) {
    const item = htmlEl('div', `hbar-row${row.emphasis === false ? ' muted' : ''}`, undefined, list);
    item.setAttribute('role', 'listitem');
    item.tabIndex = 0;
    const label = htmlEl('div', 'hbar-label', undefined, item);
    htmlEl('span', 'hbar-name', row.label, label);
    if (row.sub) htmlEl('span', 'hbar-sub', row.sub, label);
    const line = htmlEl('div', 'hbar-line', undefined, item);
    const track = htmlEl('div', 'hbar-track', undefined, line);
    const visible = row.segments.filter((s) => s.value > 0);
    visible.forEach((s, i) => {
      const seg = htmlEl('span', 'hbar-seg', undefined, track);
      seg.style.width = `${(s.value / max) * 100}%`;
      seg.style.background = cssVar(s.color);
      if (i === visible.length - 1) seg.classList.add('end');
    });
    htmlEl('span', 'hbar-value', row.endText, line);
    const rows = row.tipRows || row.segments.map((s) => ({ value: String(s.value), name: s.name, color: cssVar(s.color), kind: 'rect' }));
    const title = row.tipTitle || row.label;
    item.setAttribute('aria-label', `${title}: ${rows.map((r) => `${r.name ? `${r.name} ` : ''}${r.value}`).join(', ')}`);
    item.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, title, rows));
    item.addEventListener('pointerleave', hideTip);
    item.addEventListener('focus', () => tipAtElement(track, title, rows));
    item.addEventListener('blur', hideTip);
  }
}

// --- table view ----------------------------------------------------------------------

/** A collapsible table that repeats a chart's numbers. columns: [{ label, numeric }], rows: [[cell, ...]] */
export function tableView(el, summary, columns, rows) {
  el.replaceChildren();
  const details = htmlEl('details', 'table-view', undefined, el);
  htmlEl('summary', '', summary, details);
  const wrap = htmlEl('div', 'table-wrap', undefined, details);
  const table = htmlEl('table', 'data-table', undefined, wrap);
  const head = htmlEl('tr', '', undefined, htmlEl('thead', '', undefined, table));
  for (const c of columns) htmlEl('th', c.numeric ? 'num' : '', c.label, head).scope = 'col';
  const body = htmlEl('tbody', '', undefined, table);
  for (const r of rows) {
    const tr = htmlEl('tr', '', undefined, body);
    r.forEach((cell, i) => htmlEl('td', columns[i].numeric ? 'num' : '', cell, tr));
  }
}
