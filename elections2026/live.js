/* Live count panel.
   Renders data/results.json: one snapshot of the committee's running count every
   ten minutes, kept as a series so the night can be watched as a trend rather
   than a single number that keeps replacing itself.

   Loaded after app.js and driven by it, like forecast.js -- `initLive` is called
   once the poll dataset is in, because `node`, `BLOC_META` and the chart CSS
   classes come from there. If results.json is absent the panel stays hidden, so
   the site is unchanged on a day when nothing is being counted. */

const liveState = {
  data: null,
  mode: 'parties', // 'parties' or 'blocs'
  timer: null,
};

const LIVE_REFRESH_MS = 120000; // the feed moves every ten minutes; this is cheap
const liveInt = new Intl.NumberFormat('he-IL');
const livePct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const liveTime = (iso) => iso.slice(11, 16);

/* At the start of the night the counted share rounds to 0.0%, which reads as
   "nothing" when it is in fact tens of thousands of votes. */
const liveShare = (value) => (value < 0.001 ? 'פחות מ-0.1%' : `כ-${livePct(value)}`);

const liveLatest = () => liveState.data.snapshots[liveState.data.snapshots.length - 1];
const livePrevious = () => liveState.data.snapshots[liveState.data.snapshots.length - 2] || null;

/** Lists keyed by their ballot letters. */
function liveMeta() {
  const map = {};
  liveState.data.lists.forEach((entry) => { map[entry.letters] = entry; });
  return map;
}

function renderLiveStats() {
  const latest = liveLatest();
  const meta = liveState.data;
  const invalid = latest.voters ? latest.invalid / latest.voters : 0;
  const boxes = [...meta.snapshots].reverse().find((one) => one.ballots !== null
    && one.ballots !== undefined);
  const cards = [
    {
      label: 'קולות שנספרו',
      value: liveInt.format(latest.voters),
      note: latest.progress
        ? `${liveShare(latest.progress)} מהקולות, לפי אומדן ההצבעה של 22:00`
        : 'מתוך כלל הקולות',
    },
    {
      label: 'קלפיות שנספרו',
      // The box count comes from a second file that is occasionally unreachable;
      // the vote totals do not depend on it, so fall back to the last one read.
      value: boxes ? liveInt.format(boxes.ballots) : '—',
      note: !boxes ? `${liveInt.format(latest.localities)} יישובים`
        : boxes === latest ? `${liveInt.format(latest.localities)} יישובים`
          : `נכון ל-${liveTime(boxes.ts)} · ${liveInt.format(latest.localities)} יישובים`,
    },
    {
      label: 'קולות פסולים',
      value: livePct(invalid, 2),
      note: `${liveInt.format(latest.invalid)} מתוך ${liveInt.format(latest.voters)}`,
    },
    {
      label: 'עודכן לאחרונה',
      value: liveTime(latest.ts),
      note: meta.snapshots.length === 1
        ? 'צילום המצב הראשון של הלילה'
        : `${meta.snapshots.length} צילומי מצב מאז ${liveTime(meta.snapshots[0].ts)}`,
    },
  ];
  el('live-stats').innerHTML = cards.map((card) => `
    <div class="stat">
      <div class="stat-label">${card.label}</div>
      <div class="stat-value">${card.value}</div>
      <div class="stat-note">${card.note}</div>
    </div>`).join('');
}

/** The 120-seat bloc bar for the latest snapshot. */
function renderLiveBar() {
  const blocs = liveLatest().blocSeats;
  const segments = ['netanyahu', 'opposition', 'arab', 'other']
    .filter((bloc) => blocs[bloc])
    .map((bloc) => {
      const info = BLOC_META[bloc] || { label: 'אחר', color: '#9ca3af' };
      return `<span class="variant-seg" style="flex:${blocs[bloc]};background:${info.color}"
        title="${attr(info.label)} — ${blocs[bloc]} מנדטים">`
        + `${blocs[bloc] >= 8 ? blocs[bloc] : ''}</span>`;
    }).join('');
  const netanyahu = blocs.netanyahu || 0;
  const gap = MAJORITY - netanyahu;
  const verdict = gap <= 0
    ? `<span class="variant-verdict yes">רוב — ${netanyahu} מנדטים</span>`
    : `<span class="variant-verdict no">${gap === 1 ? 'חסר מנדט' : `חסרים ${gap}`}</span>`;
  const numbers = ['netanyahu', 'opposition', 'arab']
    .map((bloc) => `<span><i style="background:${(BLOC_META[bloc] || {}).color}"></i>`
      + `${(BLOC_META[bloc] || {}).label} ${blocs[bloc] || 0}</span>`).join('');
  el('live-bar').innerHTML = `
    <div class="variant">
      <div class="variant-head">
        <strong>לפי הקולות שנספרו עד כה</strong>
        ${verdict}
      </div>
      <div class="variant-bar">${segments}<span class="majority-line" aria-hidden="true"></span></div>
      <div class="variant-nums">${numbers}</div>
    </div>`;
}

function renderLiveTable() {
  const latest = liveLatest();
  const before = livePrevious();
  const meta = liveMeta();
  const letters = Object.keys(latest.votes)
    .filter((key) => latest.votes[key] > 0)
    .sort((a, b) => latest.votes[b] - latest.votes[a]);

  const rows = letters.map((key) => {
    const info = meta[key] || { name: key, color: '#6b7280' };
    const share = latest.valid ? latest.votes[key] / latest.valid : 0;
    const seats = latest.seats[key] || 0;
    const was = before ? (before.seats[key] || 0) : seats;
    const delta = seats - was;
    const move = !before || delta === 0 ? ''
      : `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</span>`;
    const passed = latest.passed.indexOf(key) !== -1;
    return `<tr class="${passed ? '' : 'below'}">
      <th scope="row"><span class="chip" style="background:${info.color}"></span>${info.name}</th>
      <td class="num">${liveInt.format(latest.votes[key])}</td>
      <td class="num">${(share * 100).toFixed(2)}%</td>
      <td class="num">${passed ? seats + move : '<span class="muted" title="מתחת לאחוז החסימה">—</span>'}</td>
    </tr>`;
  }).join('');

  el('live-table').querySelector('thead').innerHTML = `<tr>
    <th scope="col">רשימה</th>
    <th scope="col">קולות</th>
    <th scope="col">אחוז</th>
    <th scope="col">מנדטים</th>
  </tr>`;
  el('live-table').querySelector('tbody').innerHTML = rows;
}

/* ------------------------------------------------------------------ the chart */

/** Series to plot: one line per party holding seats, or one per bloc. */
function liveSeries() {
  const { snapshots } = liveState.data;
  const meta = liveMeta();
  if (liveState.mode === 'blocs') {
    return ['netanyahu', 'opposition', 'arab']
      .map((bloc) => ({
        key: bloc,
        label: (BLOC_META[bloc] || {}).label || bloc,
        color: (BLOC_META[bloc] || {}).color || '#6b7280',
        points: snapshots.map((snapshot) => snapshot.blocSeats[bloc] || 0),
      }))
      .filter((series) => series.points.some((value) => value > 0));
  }
  // Any list that held a seat at any point in the night, so a list that has
  // just dropped below the threshold does not vanish from its own history.
  const everHeld = {};
  snapshots.forEach((snapshot) => Object.keys(snapshot.seats).forEach((key) => {
    everHeld[key] = Math.max(everHeld[key] || 0, snapshot.seats[key]);
  }));
  return Object.keys(everHeld)
    .sort((a, b) => everHeld[b] - everHeld[a])
    .map((key) => ({
      key,
      label: (meta[key] || {}).name || key,
      color: (meta[key] || {}).color || '#6b7280',
      points: snapshots.map((snapshot) => snapshot.seats[key] || 0),
    }));
}

function renderLiveChart() {
  const host = el('live-chart');
  host.innerHTML = '';
  const { snapshots } = liveState.data;
  const series = liveSeries();

  if (snapshots.length < 2) {
    host.innerHTML = '<p class="chart-note">צילום מצב אחד בלבד עד כה — הגרף ייבנה ככל'
      + ' שיצטברו עוד, אחד כל עשר דקות.</p>';
    el('live-legend').innerHTML = '';
    return;
  }

  const width = 900;
  const height = 320;
  const margin = { top: 16, right: 44, bottom: 28, left: 24 };
  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;

  const times = snapshots.map((snapshot) => Date.parse(snapshot.ts));
  const minTime = times[0];
  const span = Math.max(1, times[times.length - 1] - minTime);
  // Time runs right to left, matching the trends chart on this page.
  const x = (time) => plotRight - ((time - minTime) / span) * (plotRight - plotLeft);

  const peak = Math.max(4, ...series.map((one) => Math.max(...one.points)));
  // Bloc totals run to 120 where a party line rarely passes 35, so the gridline
  // step follows the range rather than being fixed at five.
  const step = peak <= 20 ? 2 : (peak <= 45 ? 5 : 20);
  const top = Math.ceil(peak / step) * step;
  const y = (seats) => plotBottom - (seats / top) * (plotBottom - plotTop);

  const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
  svg.setAttribute('aria-label', 'מגמת המנדטים לאורך ספירת הקולות');

  for (let value = 0; value <= top; value += step) {
    svg.appendChild(node('line', {
      class: 'grid-line', x1: plotLeft, x2: plotRight, y1: y(value), y2: y(value),
    }));
    const label = node('text', {
      class: 'axis-text', x: plotRight + 8, y: y(value) + 4, 'text-anchor': 'start',
    });
    label.textContent = value;
    svg.appendChild(label);
  }

  times.forEach((time, index) => {
    if (index % Math.ceil(times.length / 6) && index !== times.length - 1) return;
    const label = node('text', {
      class: 'axis-text', x: x(time), y: plotBottom + 18, 'text-anchor': 'middle',
    });
    label.textContent = liveTime(snapshots[index].ts);
    svg.appendChild(label);
  });

  series.forEach((one) => {
    const path = one.points
      .map((value, index) => `${index ? 'L' : 'M'}${x(times[index])},${y(value)}`)
      .join(' ');
    svg.appendChild(node('path', {
      d: path, fill: 'none', stroke: one.color, 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    const last = one.points[one.points.length - 1];
    svg.appendChild(node('circle', {
      cx: x(times[times.length - 1]), cy: y(last), r: 3.5, fill: one.color,
    }));
  });

  host.appendChild(svg);
  renderLiveLegend(series);
}

/** Names go under the chart, not on the lines: a dozen lists converging on the
    same few seats would stack their labels on top of each other. */
function renderLiveLegend(series) {
  el('live-legend').innerHTML = series.map((one) => {
    const last = one.points[one.points.length - 1];
    return `<span class="live-key">
      <i style="background:${one.color}"></i>${one.label}
      <strong>${last}</strong>
    </span>`;
  }).join('');
}

function renderLiveModes() {
  el('live-modes').innerHTML = [
    ['parties', 'לפי רשימה'],
    ['blocs', 'לפי גוש'],
  ].map(([mode, label]) => `<button type="button" data-live-mode="${mode}"
      class="${liveState.mode === mode ? 'active' : ''}">${label}</button>`).join('');
  el('live-modes').querySelectorAll('[data-live-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      liveState.mode = button.dataset.liveMode;
      renderLiveModes();
      renderLiveChart();
    });
  });
}

function renderLive() {
  if (!liveState.data || !liveState.data.snapshots.length) return;
  renderLiveStats();
  renderLiveBar();
  renderLiveModes();
  renderLiveChart();
  renderLiveTable();
}

async function loadLive() {
  try {
    const response = await fetch('data/results.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function initLive() {
  const data = await loadLive();
  if (!data || !data.snapshots || !data.snapshots.length) return;
  liveState.data = data;
  el('live').hidden = false;
  renderLive();

  // A browser left open overnight should keep up on its own.
  if (liveState.timer) clearInterval(liveState.timer);
  liveState.timer = setInterval(async () => {
    const fresh = await loadLive();
    if (fresh && fresh.generated !== liveState.data.generated) {
      liveState.data = fresh;
      renderLive();
    }
  }, LIVE_REFRESH_MS);
}
