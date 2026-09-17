/* Election 2026 polling centre.
   Renders the seat-trend chart and the full results table from data/polls.json. */

const BLOC_META = {
  netanyahu: { label: 'גוש נתניהו', color: '#2563eb' },
  opposition: { label: 'גוש האופוזיציה', color: '#f97316' },
  arab: { label: 'המפלגות הערביות', color: '#16a34a' },
};

const MAJORITY = 61;
const THRESHOLD_SEATS = 4; // 3.25% of the vote rounds to four seats
const THRESHOLD_PCT = 3.25;

const state = {
  data: null,
  metric: 'seats', // 'seats' or 'percent' (raw, unweighted vote share)
  mode: 'avg',
  window: 5,
  from: null,
  to: null,
  pollster: '',
  hidden: new Set(),
  sort: { key: 'date', dir: 'desc' },
  heat: true,
  coalitionSource: 'avg:5',
  coalition: new Set(),
};

const fmtDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' });
const fmtLongDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
const parseDate = (iso) => new Date(iso + 'T00:00:00');

/**
 * When a poll's fieldwork ran, as its PDF states it: "9 בספט׳", or a range such
 * as "7–8 בספט׳" when collection spanned more than one day.
 */
function fmtFieldwork(poll, formatter = fmtDate) {
  const end = parseDate(poll.fieldworkEnd || poll.date);
  const start = poll.fieldworkStart ? parseDate(poll.fieldworkStart) : end;
  if (start.getTime() === end.getTime() || !formatter.formatRange) return formatter.format(end);
  return formatter.formatRange(start, end);
}
const round1 = (n) => Math.round(n * 10) / 10;
// Party names carry double quotes (ש"ס, רע"ם); unescaped they truncate any
// HTML attribute they are interpolated into.
const attr = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const el = (id) => document.getElementById(id);

/* ---------------- data selection ---------------- */

/** The figures a poll contributes under the selected metric, or null if it has none. */
function valuesOf(poll, metric = state.metric) {
  return metric === 'percent' ? poll.percents || null : poll.seats;
}

/** Format one figure for display; percentages carry a decimal and a sign. */
function fmtValue(value, smoothed) {
  if (state.metric === 'percent') return round1(value).toFixed(1) + '%';
  return smoothed ? round1(value).toFixed(1) : String(value);
}

/** Explains what a raw share is, and how many polls do not publish one. */
function percentNote() {
  const missing = state.data.counts.parsed - state.data.counts.withPercents;
  const base = 'אחוזים גולמיים הם שיעור התמיכה כפי שדווח בסקר, לפני חלוקת המנדטים, '
    + 'ולכן הם אינם מסתכמים ב-100% — היתרה מתחלקת בין מתלבטים ובין רשימות שלא עברו את אחוז החסימה.';
  if (!missing) return base;
  return `${base} ${missing} סקרים אינם מציגים עמודת אחוזים אחידה ואינם נכללים בתצוגה זו.`;
}

/** Polls inside the current date range and pollster filter, oldest first. */
function filteredPolls() {
  return state.data.polls.filter((poll) => {
    if (!valuesOf(poll)) return false; // no raw percentages published
    if (state.from && poll.date < state.from) return false;
    if (state.to && poll.date > state.to) return false;
    if (state.pollster && poll.pollster !== state.pollster) return false;
    return true;
  });
}

/** Parties worth drawing: seen in the filtered range, most-polled first. */
function activeParties(polls) {
  const counts = new Map();
  polls.forEach((poll) => {
    Object.keys(valuesOf(poll)).forEach((party) => counts.set(party, (counts.get(party) || 0) + 1));
  });
  return state.data.parties
    .filter((party) => counts.has(party.name))
    .map((party) => ({ ...party, polls: counts.get(party.name) }))
    .sort((a, b) => b.polls - a.polls);
}

/** Value of one series (party or bloc) in a single poll, or null if absent. */
function valueIn(poll, key, isBloc, metric = state.metric) {
  const values = valuesOf(poll, metric);
  if (!values) return null;
  if (!isBloc) return key in values ? values[key] : null;
  const members = state.data.blocs[key] || [];
  let total = 0;
  let found = false;
  members.forEach((party) => {
    if (party in values) { total += values[party]; found = true; }
  });
  return found ? total : null;
}

/**
 * Trailing average of the last `window` polls that reported this series.
 * Smoothing runs over poll order rather than calendar days, so a burst of polls
 * in one week does not get flattened against a quiet week.
 */
function rollingSeries(polls, key, isBloc) {
  const recent = [];
  return polls.map((poll) => {
    const value = valueIn(poll, key, isBloc);
    if (value !== null) {
      recent.push(value);
      if (recent.length > state.window) recent.shift();
    }
    if (!recent.length) return null;
    return recent.reduce((sum, n) => sum + n, 0) / recent.length;
  });
}

/** The series drawn for the current mode. */
function buildSeries(polls) {
  if (state.mode === 'bloc') {
    return Object.keys(BLOC_META).map((key) => ({
      key,
      label: BLOC_META[key].label,
      color: BLOC_META[key].color,
      values: rollingSeries(polls, key, true),
      raw: polls.map((poll) => valueIn(poll, key, true)),
    }));
  }
  return activeParties(polls)
    .filter((party) => !state.hidden.has(party.name))
    .map((party) => ({
      key: party.name,
      label: party.name,
      color: party.color,
      values: state.mode === 'avg'
        ? rollingSeries(polls, party.name, false)
        : polls.map((poll) => valueIn(poll, party.name, false)),
      raw: polls.map((poll) => valueIn(poll, party.name, false)),
    }));
}

/* ---------------- chart ---------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const node = (name, attrs = {}) => {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
};

let chartHit = null; // geometry kept for the hover handler

const DAY = 24 * 60 * 60 * 1000;

/**
 * X positions for the polls. Several polls often share a survey date, which
 * would stack them on one vertical line and turn every trend into a staircase,
 * so same-day polls are spread evenly across that day.
 */
function spreadWithinDay(polls) {
  const perDay = new Map();
  polls.forEach((poll) => perDay.set(poll.date, (perDay.get(poll.date) || 0) + 1));
  const placed = new Map();
  return polls.map((poll) => {
    const total = perDay.get(poll.date);
    const index = placed.get(poll.date) || 0;
    placed.set(poll.date, index + 1);
    const offset = total > 1 ? ((index + 1) / (total + 1)) * DAY : 0;
    return parseDate(poll.date).getTime() + offset;
  });
}

function renderChart() {
  const host = el('chart');
  host.textContent = '';
  const polls = filteredPolls();
  const note = el('chart-note');

  if (polls.length < 2) {
    note.textContent = 'אין מספיק סקרים בטווח שנבחר כדי להציג מגמה.';
    chartHit = null;
    return;
  }

  const series = buildSeries(polls);
  const width = 1000;
  const height = 440;
  const margin = { top: 18, right: 46, bottom: 38, left: 40 };
  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;

  const times = spreadWithinDay(polls);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const span = Math.max(1, maxTime - minTime);
  // Time runs right-to-left, matching the reading direction of the page.
  const x = (time) => plotRight - ((time - minTime) / span) * (plotRight - plotLeft);

  const allValues = series.flatMap((s) => s.values.filter((v) => v !== null));
  const maxValue = Math.max(10, Math.ceil((Math.max(...allValues, 0) + 2) / 5) * 5);
  const y = (value) => plotBottom - (value / maxValue) * (plotBottom - plotTop);

  const svg = node('svg', {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'presentation',
  });

  // horizontal grid + value labels on the right, as RTL convention expects
  const percent = state.metric === 'percent';
  const step = maxValue > 40 ? 10 : 5;
  for (let value = 0; value <= maxValue; value += step) {
    svg.appendChild(node('line', {
      class: 'grid-line', x1: plotLeft, x2: plotRight, y1: y(value), y2: y(value),
    }));
    const label = node('text', {
      class: 'axis-text', x: plotRight + 8, y: y(value) + 4, 'text-anchor': 'start',
    });
    label.textContent = percent ? value + '%' : value;
    svg.appendChild(label);
  }

  // Reference line: the electoral threshold, or a majority in bloc mode. Raw
  // shares do not add up to 100%, so a bloc's raw total has no majority mark.
  let reference = null;
  let referenceLabel = '';
  if (state.mode === 'bloc') {
    if (!percent) {
      reference = MAJORITY;
      referenceLabel = 'רוב — 61';
    }
  } else {
    reference = percent ? THRESHOLD_PCT : THRESHOLD_SEATS;
    referenceLabel = percent ? 'אחוז חסימה — 3.25%' : 'אחוז חסימה — 4';
  }
  if (reference !== null && reference <= maxValue) {
    svg.appendChild(node('line', {
      class: 'threshold-line', x1: plotLeft, x2: plotRight, y1: y(reference), y2: y(reference),
    }));
    // Hebrew text anchored "start" grows leftward, so pin it to the right edge.
    const refLabel = node('text', {
      class: 'axis-text major', x: plotRight - 10, y: y(reference) - 6, 'text-anchor': 'start',
    });
    refLabel.textContent = referenceLabel;
    svg.appendChild(refLabel);
  }

  // date ticks
  const tickCount = Math.min(7, polls.length);
  const seen = new Set();
  for (let i = 0; i < tickCount; i += 1) {
    const time = minTime + (span * i) / Math.max(1, tickCount - 1);
    const text = fmtDate.format(new Date(time));
    if (seen.has(text)) continue;
    seen.add(text);
    const tick = node('text', {
      class: 'axis-text', x: x(time), y: plotBottom + 22, 'text-anchor': 'middle',
    });
    tick.textContent = text;
    svg.appendChild(tick);
  }

  // series
  series.forEach((line) => {
    const points = [];
    line.values.forEach((value, index) => {
      if (value === null) return;
      points.push([x(times[index]), y(value)]);
    });
    if (points.length > 1) {
      svg.appendChild(node('path', {
        class: 'series-line',
        stroke: line.color,
        'stroke-width': state.mode === 'raw' ? 1.2 : 2.4,
        'stroke-opacity': state.mode === 'raw' ? 0.28 : 1,
        d: points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),
      }));
    }
    if (state.mode === 'raw') {
      points.forEach((point) => {
        svg.appendChild(node('circle', {
          class: 'dot', cx: point[0], cy: point[1], r: 3.1, fill: line.color,
        }));
      });
    }
  });

  const hover = node('g', { opacity: 0 });
  hover.appendChild(node('line', { class: 'hover-line', y1: plotTop, y2: plotBottom }));
  svg.appendChild(hover);

  const capture = node('rect', {
    x: plotLeft, y: plotTop, width: plotRight - plotLeft, height: plotBottom - plotTop,
    fill: 'transparent', style: 'cursor:crosshair',
  });
  svg.appendChild(capture);
  host.appendChild(svg);

  chartHit = { svg, hover, polls, series, times, x, y, plotTop, plotBottom };
  capture.addEventListener('pointermove', onHover);
  capture.addEventListener('pointerleave', hideTooltip);

  const windowNote = state.mode === 'raw'
    ? 'כל נקודה היא סקר בודד.'
    : `כל נקודה היא ממוצע ${state.window} הסקרים האחרונים באותו מועד.`;
  note.textContent = `${windowNote} ${polls.length} סקרים בטווח. הזמן מתקדם מימין לשמאל. `
    + (percent ? percentNote() : 'הפערים בין מכוני הסקרים גדולים — '
       + 'סננו לפי מכון כדי לראות את המגמה של כל אחד בנפרד.');
}

/* ---------------- hover ---------------- */

function onHover(event) {
  if (!chartHit) return;
  const { svg, hover, polls, series, times, x, y, plotTop, plotBottom } = chartHit;
  const box = svg.getBoundingClientRect();
  const scale = 1000 / box.width;
  // The page is RTL, so client-x grows leftward relative to the SVG origin.
  const localX = (event.clientX - box.left) * scale;

  let index = 0;
  let best = Infinity;
  times.forEach((time, i) => {
    const distance = Math.abs(x(time) - localX);
    if (distance < best) { best = distance; index = i; }
  });

  const poll = polls[index];
  const px = x(times[index]);
  hover.setAttribute('opacity', 1);
  const line = hover.querySelector('.hover-line');
  line.setAttribute('x1', px);
  line.setAttribute('x2', px);
  hover.querySelectorAll('circle').forEach((circle) => circle.remove());

  const rows = [];
  series.forEach((line2) => {
    const value = line2.values[index];
    if (value === null || value === undefined) return;
    rows.push({ label: line2.label, color: line2.color, value, raw: line2.raw[index] });
    const dot = node('circle', {
      class: 'hover-dot', cx: px, cy: y(value), r: 4, fill: line2.color,
    });
    hover.appendChild(dot);
  });
  rows.sort((a, b) => b.value - a.value);
  showTooltip(event, poll, rows, plotTop, plotBottom);
}

function showTooltip(event, poll, rows, plotTop, plotBottom) {
  const tip = el('tooltip');
  const smoothed = state.mode !== 'raw';
  tip.innerHTML = `
    <h4>${fmtFieldwork(poll, fmtLongDate)}</h4>
    <div class="tip-meta">${poll.pollster}${poll.publisher ? ' · ' + poll.publisher : ''}</div>
    ${rows.map((row) => `
      <div class="tip-row">
        <span class="swatch" style="background:${row.color}"></span>
        <span>${row.label}</span>
        <span class="val">${fmtValue(row.value, smoothed)}</span>
      </div>`).join('')}
  `;
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  let left = event.clientX - box.width - 16;
  if (left < 8) left = event.clientX + 16;
  let top = event.clientY - box.height / 2;
  top = Math.max(8, Math.min(window.innerHeight - box.height - 8, top));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTooltip() {
  el('tooltip').hidden = true;
  if (chartHit) chartHit.hover.setAttribute('opacity', 0);
}

/* ---------------- legend ---------------- */

function renderLegend() {
  const host = el('legend');
  host.textContent = '';
  host.hidden = false;

  if (state.mode === 'bloc') {
    const polls = filteredPolls();
    Object.entries(BLOC_META).forEach(([key, meta]) => {
      const chip = document.createElement('span');
      chip.className = 'chip on static';
      const members = state.data.blocs[key].filter(
        (party) => polls.some((poll) => party in poll.seats));
      chip.innerHTML = `<span class="swatch" style="background:${meta.color}"></span>` +
        `<span>${meta.label}</span><span class="count">${members.join(' · ')}</span>`;
      host.appendChild(chip);
    });
    return;
  }

  activeParties(filteredPolls()).forEach((party) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (state.hidden.has(party.name) ? '' : ' on');
    chip.innerHTML = `<span class="swatch" style="background:${party.color}"></span>` +
      `<span>${party.name}</span><span class="count">${party.polls}</span>`;
    chip.setAttribute('aria-pressed', String(!state.hidden.has(party.name)));
    chip.addEventListener('click', () => {
      if (state.hidden.has(party.name)) state.hidden.delete(party.name);
      else state.hidden.add(party.name);
      renderLegend();
      renderChart();
    });
    host.appendChild(chip);
  });
}

/* ---------------- stats ---------------- */

function renderStats() {
  const { counts, polls } = state.data;
  const latest = polls[polls.length - 1];
  const recent = polls.slice(-state.window);

  const partyAverages = new Map();
  recent.forEach((poll) => {
    Object.entries(poll.seats).forEach(([party, seats]) => {
      const entry = partyAverages.get(party) || { sum: 0, n: 0 };
      entry.sum += seats;
      entry.n += 1;
      partyAverages.set(party, entry);
    });
  });
  let largest = { name: '—', value: 0 };
  partyAverages.forEach((entry, party) => {
    const value = entry.sum / entry.n;
    if (value > largest.value) largest = { name: party, value };
  });

  const blocAverage = (key) => {
    const values = recent.map((poll) => valueIn(poll, key, true, 'seats')).filter((v) => v !== null);
    if (!values.length) return 0;
    return values.reduce((sum, n) => sum + n, 0) / values.length;
  };
  const netanyahu = blocAverage('netanyahu');

  // A duplicate filing does carry a national projection -- it is just counted once.
  const duplicates = state.data.excluded
    .filter((poll) => (poll.reason || '').startsWith('duplicate filing')).length;
  const excludedNote = [`${counts.excluded - duplicates} פרסומים ללא תחזית מנדטים ארצית`]
    .concat(duplicates
      ? [duplicates === 1 ? 'סקר אחד שהוגש פעמיים' : `${duplicates} סקרים שהוגשו פעמיים`]
      : [])
    .join(' · ');

  const cards = [
    {
      label: 'סקרים שנותחו',
      value: `${counts.parsed}<span class="unit"> / ${counts.published}</span>`,
      note: excludedNote,
    },
    {
      label: 'הסקר האחרון',
      value: fmtDate.format(parseDate(latest.date)),
      note: `${latest.pollster} · ${latest.publisher || '—'}`,
    },
    {
      label: `המפלגה הגדולה (ממוצע ${state.window} אחרונים)`,
      value: `${round1(largest.value).toFixed(1)}<span class="unit"> מנדטים</span>`,
      note: largest.name,
    },
    {
      label: `גוש נתניהו (ממוצע ${state.window} אחרונים)`,
      value: `${round1(netanyahu).toFixed(1)}<span class="unit"> מנדטים</span>`,
      note: netanyahu >= MAJORITY ? 'מעל רוב של 61' : `${round1(MAJORITY - netanyahu).toFixed(1)} מנדטים מרוב`,
    },
  ];

  el('hero-stats').innerHTML = cards.map((card) => `
    <div class="stat">
      <div class="stat-label">${card.label}</div>
      <div class="stat-value">${card.value}</div>
      <div class="stat-note">${card.note}</div>
    </div>`).join('');
}

/* ---------------- table ---------------- */

function tableRows() {
  const polls = filteredPolls().slice();
  const { key, dir } = state.sort;
  polls.sort((a, b) => {
    let left;
    let right;
    if (key === 'date') {
      left = a.date;
      right = b.date;
    } else if (key === 'pollster') {
      left = a.pollster;
      right = b.pollster;
    } else {
      const leftValues = valuesOf(a);
      const rightValues = valuesOf(b);
      left = key in leftValues ? leftValues[key] : -1;
      right = key in rightValues ? rightValues[key] : -1;
    }
    if (left < right) return dir === 'asc' ? -1 : 1;
    if (left > right) return dir === 'asc' ? 1 : -1;
    return a.date < b.date ? 1 : -1;
  });
  return polls;
}

function renderTable() {
  const polls = filteredPolls();
  const parties = activeParties(polls);
  const table = el('polls-table');
  const flag = (key) => (state.sort.key === key
    ? `<span class="sort-flag">${state.sort.dir === 'desc' ? '▼' : '▲'}</span>` : '');

  table.querySelector('thead').innerHTML = `
    <tr>
      <th class="sticky-col party-col" data-sort="date">מועד איסוף ${flag('date')}</th>
      <th class="party-col" data-sort="pollster">מכון ${flag('pollster')}</th>
      <th>מפרסם</th>
      ${parties.map((party) => `
        <th class="party-col" data-sort="${attr(party.name)}" title="${attr(party.name)}">
          <span class="party-swatch" style="background:${party.color}"></span>${party.name} ${flag(party.name)}
        </th>`).join('')}
      <th>${state.metric === 'percent' ? 'סה״כ %' : 'סה״כ'}</th>
      <th>מקור</th>
    </tr>`;

  const max = Math.max(...polls.flatMap((poll) => Object.values(valuesOf(poll))), 1);
  table.querySelector('tbody').innerHTML = tableRows().map((poll) => `
    <tr>
      <td class="sticky-col cell-date">${fmtFieldwork(poll)}${poll.dateSource === 'cec'
        ? '<span class="date-note" title="מועד האיסוף לא צוין בקובץ הסקר; מוצג תאריך ועדת הבחירות">*</span>'
        : ''}</td>
      <td class="cell-meta">${poll.pollster}</td>
      <td class="cell-meta">${poll.publisher || '—'}</td>
      ${parties.map((party) => {
        const values = valuesOf(poll);
        if (!(party.name in values)) return '<td class="cell-empty">–</td>';
        const value = values[party.name];
        const style = state.heat
          ? ` style="background:${party.color}${Math.round((value / max) * 40 + 8)
              .toString(16).padStart(2, '0')}"`
          : '';
        return `<td${style}>${fmtValue(value, false)}</td>`;
      }).join('')}
      <td>${state.metric === 'percent' ? poll.percentTotal.toFixed(1) + '%' : poll.total}</td>
      <td>${poll.pdf ? `<a class="pdf-link" href="${poll.pdf}" target="_blank" rel="noopener"
             title="קובץ הסקר המקורי">↗</a>` : '–'}</td>
    </tr>`).join('');

  table.querySelectorAll('th[data-sort]').forEach((header) => {
    header.addEventListener('click', () => {
      const key = header.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'desc' ? 'asc' : 'desc';
      else state.sort = { key, dir: 'desc' };
      renderTable();
    });
  });
}

/* ---------------- excluded ---------------- */

function renderExcluded() {
  const list = state.data.excluded;
  const box = el('excluded');
  box.querySelector('summary').textContent =
    `${list.length} פרסומים שאינם כלולים בטבלה — למה?`;
  box.querySelector('.excluded-body').innerHTML = `
    <p>ועדת הבחירות פרסמה ${state.data.counts.published} סקרים. ${state.data.counts.parsed}
       מהם כוללים תחזית מנדטים ארצית מלאה ונכללים כאן. השאר:</p>
    <ul>${list.map((poll) => `
      <li>
        <strong>${fmtFieldwork(poll)}</strong> · ${poll.pollster}
        ${poll.publisher ? '(' + poll.publisher + ')' : ''} — ${poll.reasonHe || poll.reason}
        ${poll.pdf ? `<a href="${poll.pdf}" target="_blank" rel="noopener">קובץ המקור</a>` : ''}
      </li>`).join('')}</ul>`;
}

/* ---------------- csv ---------------- */

function downloadCsv() {
  const polls = tableRows();
  const parties = activeParties(filteredPolls());
  const unit = state.metric === 'percent' ? ' (%)' : ' (מנדטים)';
  const head = ['תאריך', 'תחילת איסוף', 'סיום איסוף', 'מקור התאריך', 'מכון', 'מפרסם',
    ...parties.map((p) => p.name + unit), 'סה״כ', 'קישור'];
  const lines = [head, ...polls.map((poll) => {
    const values = valuesOf(poll);
    return [
      poll.date,
      poll.fieldworkStart || poll.date,
      poll.fieldworkEnd || poll.date,
      poll.dateSource === 'cec' ? 'ועדת הבחירות' : 'קובץ הסקר',
      poll.pollster,
      poll.publisher || '',
      ...parties.map((party) => (party.name in values ? values[party.name] : '')),
      state.metric === 'percent' ? poll.percentTotal : poll.total,
      poll.pdf || '',
    ];
  })];
  const csv = '﻿' + lines
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = state.metric === 'percent'
    ? 'knesset-26-polls-percent.csv' : 'knesset-26-polls-seats.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/* ---------------- wiring ---------------- */

function renderAll() {
  renderStats();
  renderLegend();
  renderChart();
  renderTable();
}

function setupControls() {
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      state.mode = button.dataset.mode;
      renderLegend();
      renderChart();
    });
  });

  document.querySelectorAll('[data-metric]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-metric]').forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      state.metric = button.dataset.metric;
      renderAll();
    });
  });

  el('window-select').addEventListener('change', (event) => {
    state.window = Number(event.target.value);
    renderAll();
  });

  const dates = state.data.polls.map((poll) => poll.date);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const fromInput = el('from-date');
  const toInput = el('to-date');
  [fromInput, toInput].forEach((input) => {
    input.min = first;
    input.max = last;
  });
  fromInput.value = first;
  toInput.value = last;
  state.from = first;
  state.to = last;
  fromInput.addEventListener('change', () => { state.from = fromInput.value; renderAll(); });
  toInput.addEventListener('change', () => { state.to = toInput.value; renderAll(); });

  const pollsters = [...new Set(state.data.polls.map((poll) => poll.pollster))].sort((a, b) => a.localeCompare(b, 'he'));
  const select = el('pollster-select');
  pollsters.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.addEventListener('change', () => { state.pollster = select.value; renderAll(); });

  el('reset-filters').addEventListener('click', () => {
    state.from = first;
    state.to = last;
    state.pollster = '';
    state.hidden.clear();
    fromInput.value = first;
    toInput.value = last;
    select.value = '';
    renderAll();
  });

  el('heat-toggle').addEventListener('change', (event) => {
    state.heat = event.target.checked;
    renderTable();
  });

  el('csv-btn').addEventListener('click', downloadCsv);
  window.addEventListener('resize', hideTooltip);
}

/** Highlight the nav link for whichever section is currently in view. */
function setupNav() {
  const links = [...document.querySelectorAll('.site-nav a')]
    .map((link) => ({ link, section: document.querySelector(link.getAttribute('href')) }))
    .filter((entry) => entry.section);
  if (!links.length) return;
  const mark = () => {
    // The last section whose top has crossed the upper third of the viewport.
    const line = window.scrollY + window.innerHeight * 0.35;
    let current = null;
    links.forEach((entry) => {
      const top = entry.section.getBoundingClientRect().top + window.scrollY;
      if (top <= line) current = entry;
    });
    links.forEach((entry) => entry.link.classList.toggle('active', entry === current));
  };
  window.addEventListener('scroll', mark, { passive: true });
  window.addEventListener('resize', mark);
  mark();
}

/** Relative luminance of a #rrggbb colour, per WCAG. */
function luminance(hex) {
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function mixWithWhite(hex, amount) {
  return '#' + [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(value + (255 - value) * amount).toString(16).padStart(2, '0');
  }).join('');
}

const DARK_SURFACE = '#131826'; // --bg-elev in the dark theme
const MIN_CONTRAST = 3; // WCAG minimum for graphical marks

const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Party colours as drawn in the current theme. Several are too dark to make out
 * against the dark background, so in dark mode they are lifted toward white.
 * Near-black ones (Shas, the Haredi public list) go to a light grey -- a small
 * lift would leave them a mid grey indistinguishable from United Torah Judaism's
 * -- and the rest are lifted only as far as needed, so they keep their hue.
 */
function applyPartyColors() {
  const dark = document.documentElement.dataset.theme === 'dark';
  state.data.parties.forEach((party) => {
    if (!party.baseColor) party.baseColor = party.color;
    let color = party.baseColor;
    if (dark && luminance(color) < 0.06) {
      color = mixWithWhite(color, 0.75);
    } else if (dark) {
      for (let amount = 0.05; contrastRatio(color, DARK_SURFACE) < MIN_CONTRAST && amount <= 1; amount += 0.05) {
        color = mixWithWhite(party.baseColor, amount);
      }
    }
    party.color = color;
  });
}

function setupTheme() {
  const stored = localStorage.getItem('theme');
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('[data-theme-icon]').textContent = theme === 'dark' ? '☀' : '☾';
  };
  apply(stored || preferred);
  el('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    apply(next);
    if (!state.data) return;
    // Colours are baked into the chart, table and seat map, so redraw them all.
    applyPartyColors();
    renderAll();
    renderCoalition();
  });
}

async function init() {
  setupTheme();
  // Revalidate rather than trust the cache: the dataset is rewritten whenever
  // new polls are published, and a returning visitor must not see stale seats.
  const response = await fetch('data/polls.json', { cache: 'no-cache' });
  state.data = await response.json();

  applyPartyColors();

  // Hide the long tail so the default chart stays readable.
  state.data.parties.forEach((party) => {
    if (party.polls < state.data.counts.parsed * 0.4) state.hidden.add(party.name);
  });

  el('source-link').href = state.data.source.page;
  const last = state.data.polls[state.data.polls.length - 1];
  el('build-note').textContent =
    `הנתונים מכסים ${state.data.counts.published} פרסומים, עד לסקר מיום ${fmtLongDate.format(parseDate(last.date))}.`;

  setupControls();
  setupNav();
  renderExcluded();
  renderAll();
  setupCoalition();
}

/* ---------------- coalition panel ---------------- */

// Right to left across the chamber, so the right-wing bloc sits on the right.
const BLOC_ORDER = ['netanyahu', 'opposition', 'arab', 'other'];

const PRESETS = [
  { label: 'גוש נתניהו', blocs: ['netanyahu'] },
  { label: 'גוש האופוזיציה', blocs: ['opposition'] },
  { label: 'אופוזיציה + רשימות ערביות', blocs: ['opposition', 'arab'] },
  { label: 'ניקוי', blocs: [] },
];

/**
 * Whole seats for the chamber map. Poll averages are fractional, so the means
 * are apportioned to exactly 120 by the largest-remainder method.
 */
function apportion(means, total) {
  const entries = Object.entries(means).filter(([, value]) => value > 0);
  const sum = entries.reduce((acc, [, value]) => acc + value, 0);
  if (!sum) return {};
  const rows = entries.map(([party, value]) => {
    const exact = (value / sum) * total;
    return { party, seats: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let assigned = rows.reduce((acc, row) => acc + row.seats, 0);
  rows.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; assigned < total; i += 1, assigned += 1) rows[i % rows.length].seats += 1;
  const out = {};
  rows.forEach((row) => { if (row.seats > 0) out[row.party] = row.seats; });
  return out;
}

/**
 * Apply the electoral threshold and hand the surviving lists all 120 seats.
 *
 * Averaging a list that cleared the threshold in only some of the polls leaves
 * it with a fractional seat count no real projection can produce -- no single
 * poll in this data gives any list between one and three seats. Dropping those
 * and reallocating is what the real count does with below-threshold votes.
 */
function applyThreshold(values) {
  const kept = {};
  const below = {};
  Object.entries(values).forEach(([party, value]) => {
    if (value >= THRESHOLD_SEATS) kept[party] = value;
    else if (value > 0) below[party] = value;
  });
  return { seats: apportion(kept, 120), below };
}

/** How many of the last `count` polls the chosen coalition wins a majority in. */
function coalitionHistory(count) {
  return state.data.polls.slice(-count).map((poll) => {
    const total = [...state.coalition]
      .reduce((acc, party) => acc + (poll.seats[party] || 0), 0);
    return { poll, total, majority: total >= MAJORITY };
  });
}

/** Seats the coalition panel works from: one poll, or an average of the latest. */
function coalitionBase() {
  const source = state.coalitionSource || 'avg:5';
  if (source.startsWith('poll:')) {
    const poll = state.data.polls.find((entry) => entry.id === source.slice(5));
    if (poll) {
      const { seats, below } = applyThreshold(poll.seats);
      return {
        seats,
        below,
        window: 5,
        note: `לפי סקר ${poll.pollster}, שנערך ${fmtFieldwork(poll, fmtLongDate)}.`,
      };
    }
  }
  const count = Number(source.split(':')[1]) || 5;
  const recent = state.data.polls.slice(-count);
  const means = {};
  state.data.parties.forEach((party) => {
    const sum = recent.reduce((acc, poll) => acc + (poll.seats[party.name] || 0), 0);
    if (sum > 0) means[party.name] = sum / recent.length;
  });
  const { seats, below } = applyThreshold(means);
  return {
    seats,
    below,
    window: recent.length,
    note: `ממוצע ${recent.length} הסקרים האחרונים, מחולק ל-120 מנדטים בשיטת השארית הגדולה. `
      + 'רשימה שלא הופיעה באחד הסקרים נספרת בו כאפס'
      + (Object.keys(below).length
        ? ', ולכן יש רשימות שנותרו מתחת ל-4 מנדטים בממוצע; המנדטים שלהן חולקו מחדש.'
        : '.'),
  };
}

const partyMeta = (party) => state.data.parties.find((entry) => entry.name === party) || {};
const blocOf = (party) => partyMeta(party).bloc || 'other';
const colorOf = (party) => partyMeta(party).color || '#9ca3af';

/** Parties ordered across the chamber: by bloc, then largest first. */
function orderedParties(seats) {
  return Object.keys(seats).sort((a, b) => {
    const blocDiff = BLOC_ORDER.indexOf(blocOf(a)) - BLOC_ORDER.indexOf(blocOf(b));
    if (blocDiff) return blocDiff;
    return seats[b] - seats[a];
  });
}

/** Positions for `total` seats laid out in a hemicycle, right to left. */
function hemicycleLayout(total) {
  const rowCount = 5;
  const radii = [];
  for (let i = 0; i < rowCount; i += 1) radii.push(0.46 + (0.54 * i) / (rowCount - 1));
  const weight = radii.reduce((acc, r) => acc + r, 0);
  const counts = radii.map((r) => Math.max(1, Math.round((total * r) / weight)));
  let drift = total - counts.reduce((acc, n) => acc + n, 0);
  for (let i = counts.length - 1; drift !== 0; i = (i - 1 + counts.length) % counts.length) {
    const step = Math.sign(drift);
    counts[i] += step;
    drift -= step;
  }
  const points = [];
  counts.forEach((count, row) => {
    for (let seat = 0; seat < count; seat += 1) {
      const t = count === 1 ? 0.5 : seat / (count - 1);
      points.push({ angle: Math.PI * t, radius: radii[row], row });
    }
  });
  points.sort((a, b) => a.angle - b.angle || a.row - b.row); // angle 0 = right edge
  return points;
}

const coalitionTotal = (base) => [...state.coalition]
  .reduce((acc, party) => acc + (base.seats[party] || 0), 0);

function renderSeatMap(base) {
  const host = el('seatmap');
  host.textContent = '';
  const order = orderedParties(base.seats);
  const total = Object.values(base.seats).reduce((acc, n) => acc + n, 0);
  const layout = hemicycleLayout(total);

  const width = 820;
  const height = 430;
  const cx = width / 2;
  const cy = height - 26;
  const scale = 292;

  const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'presentation' });
  let index = 0;
  order.forEach((party) => {
    const inCoalition = state.coalition.has(party);
    for (let i = 0; i < base.seats[party]; i += 1, index += 1) {
      const point = layout[index];
      if (!point) break;
      const dot = node('circle', {
        cx: cx + scale * point.radius * Math.cos(point.angle),
        cy: cy - scale * point.radius * Math.sin(point.angle),
        r: 8,
        fill: colorOf(party),
        class: 'seat' + (inCoalition ? ' seat-in' : ''),
      });
      const label = node('title');
      label.textContent = `${party} — ${base.seats[party]} מנדטים`;
      dot.appendChild(label);
      svg.appendChild(dot);
    }
  });

  // A bare number, with the "of 120" in the caption: mixing digits and a slash
  // inside RTL text reorders them on screen.
  const centre = node('text', { x: cx, y: cy - 44, 'text-anchor': 'middle', class: 'seatmap-total' });
  centre.textContent = coalitionTotal(base);
  svg.appendChild(centre);
  const caption = node('text', { x: cx, y: cy - 20, 'text-anchor': 'middle', class: 'seatmap-caption' });
  caption.textContent = 'מנדטים בקואליציה, מתוך 120';
  svg.appendChild(caption);

  host.appendChild(svg);
  el('seatmap-note').textContent = base.note;
}

function renderBlocBars(base) {
  const totals = {};
  Object.entries(base.seats).forEach(([party, seats]) => {
    totals[blocOf(party)] = (totals[blocOf(party)] || 0) + seats;
  });
  el('bloc-bars').innerHTML = BLOC_ORDER
    .filter((bloc) => totals[bloc] > 0 && BLOC_META[bloc])
    .map((bloc) => `
      <div class="bloc-row">
        <div class="bloc-label">
          <span class="swatch" style="background:${BLOC_META[bloc].color}"></span>
          <span>${BLOC_META[bloc].label}</span>
          <strong>${totals[bloc]}</strong>
        </div>
        <div class="bloc-track">
          <div class="bloc-fill" style="width:${(totals[bloc] / 120) * 100}%;
               background:${BLOC_META[bloc].color}"></div>
          <div class="bloc-majority" style="inset-inline-start:${(MAJORITY / 120) * 100}%"></div>
        </div>
      </div>`).join('');
}

/** "A majority in 3 of the last 5 polls", with the spread and a dot per poll. */
function historyBlock(base) {
  const history = coalitionHistory(base.window);
  if (!history.length) return '';
  const wins = history.filter((entry) => entry.majority).length;
  const totals = history.map((entry) => entry.total);
  const low = Math.min(...totals);
  const high = Math.max(...totals);
  const spread = low === high ? `${low} מנדטים בכל אחד מהם`
    : `בין ${low} ל-${high} מנדטים`;
  const dots = history.map((entry) => `
    <span class="poll-dot${entry.majority ? ' is-majority' : ''}"
          title="${attr(`${fmtFieldwork(entry.poll)} · ${entry.poll.pollster} — ${entry.total} מנדטים`)}"></span>`).join('');
  return `
    <div class="history">
      <div class="history-line">
        <strong>${wins}</strong> מתוך ${history.length} הסקרים האחרונים מזכים אותה ברוב
      </div>
      <div class="poll-strip">${dots}</div>
      <div class="history-note">${spread} · מהישן לחדש, מימין לשמאל</div>
    </div>`;
}

function renderVerdict(base) {
  const total = coalitionTotal(base);
  const gap = MAJORITY - total;
  const host = el('coalition-verdict');
  if (!state.coalition.size) {
    host.className = 'verdict';
    host.innerHTML = '<strong>לא נבחרו רשימות</strong>'
      + '<span>סמנו רשימות כדי לבדוק אם הן מרכיבות רוב.</span>';
    return;
  }
  if (gap <= 0) {
    host.className = 'verdict has-majority';
    host.innerHTML = `<strong>יש רוב — ${total} מנדטים</strong>`
      + `<span>${total === MAJORITY ? 'רוב מינימלי' : `${total - MAJORITY} מעבר ל-61`}</span>`
      + historyBlock(base);
    return;
  }
  const helpers = Object.keys(base.seats)
    .filter((party) => !state.coalition.has(party) && base.seats[party] >= gap)
    .sort((a, b) => base.seats[a] - base.seats[b]);
  host.className = 'verdict no-majority';
  host.innerHTML = `<strong>אין רוב — ${total} מנדטים</strong>`
    + `<span>חסרים ${gap} מנדטים${helpers.length ? `. הוספת ${helpers[0]} משלימה לרוב` : ''}</span>`
    + historyBlock(base);
}

function renderPartyPicker(base) {
  const host = el('party-picker');
  const card = (party, seats, below) => `
    <button type="button" class="party-card${state.coalition.has(party) ? ' on' : ''}${below ? ' below' : ''}"
            data-party="${attr(party)}" aria-pressed="${state.coalition.has(party)}"
            title="${attr(below
              ? `${party} — מתחת לאחוז החסימה בבסיס הנתונים שנבחר, אך קיבלה מנדטים בחלק מהסקרים`
              : `${party} — ${seats} מנדטים`)}">
      <span class="swatch" style="background:${colorOf(party)}"></span>
      <span class="party-name">${party}</span>
      <span class="party-seats">${below ? 'מתחת לחסימה' : seats}</span>
    </button>`;
  const seated = orderedParties(base.seats).map((party) => card(party, base.seats[party], false));
  const below = orderedParties(base.below).map((party) => card(party, 0, true));
  host.innerHTML = seated.join('') + below.join('');
  host.querySelectorAll('.party-card').forEach((card) => {
    card.addEventListener('click', () => {
      const party = card.dataset.party;
      if (state.coalition.has(party)) state.coalition.delete(party);
      else state.coalition.add(party);
      renderCoalition();
    });
  });
}

function renderCoalition() {
  const base = coalitionBase();
  // Keep only lists the current base knows about, seated or below the threshold.
  [...state.coalition].forEach((party) => {
    if (!(party in base.seats) && !(party in base.below)) state.coalition.delete(party);
  });
  renderSeatMap(base);
  renderBlocBars(base);
  renderVerdict(base);
  renderPartyPicker(base);
}

function setupCoalition() {
  const select = el('coalition-source');
  const averages = [3, 5, 10]
    .map((n) => `<option value="avg:${n}">ממוצע ${n} הסקרים האחרונים</option>`).join('');
  const polls = state.data.polls.slice().reverse()
    .map((poll) => `<option value="poll:${poll.id}">`
      + `${fmtFieldwork(poll)} · ${poll.pollster}</option>`).join('');
  select.innerHTML = `${averages}<optgroup label="סקר בודד">${polls}</optgroup>`;
  select.value = 'avg:5';
  state.coalitionSource = 'avg:5';
  select.addEventListener('change', () => {
    state.coalitionSource = select.value;
    renderCoalition();
  });

  el('coalition-presets').innerHTML = PRESETS
    .map((preset, index) => `<button type="button" class="ghost-btn" data-preset="${index}">`
      + `${preset.label}</button>`).join('');
  el('coalition-presets').querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = PRESETS[Number(button.dataset.preset)];
      state.coalition = new Set(state.data.parties
        .filter((party) => preset.blocs.includes(party.bloc))
        .map((party) => party.name));
      renderCoalition();
    });
  });

  // Open on the incumbent bloc so the map is populated on arrival.
  state.coalition = new Set(state.data.parties
    .filter((party) => party.bloc === 'netanyahu').map((party) => party.name));
  renderCoalition();
}

init();
