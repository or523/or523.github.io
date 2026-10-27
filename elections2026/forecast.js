/* Election-day forecast panel.
   Renders data/forecast.json: a seat projection built from how heavily each
   locality has voted today, read against how that locality voted in 2022.

   Loaded after app.js and driven by it -- `initForecast` is called once the poll
   dataset is in, because the party colours come from there. If forecast.json is
   not on the server the panel stays hidden, so the site works on an ordinary day. */

const FORECAST_VARIANTS = [
  {
    id: 'bloc',
    label: 'גושים מ-2022',
    note: 'הקריאה הקפדנית: הגוש שהצביע ב-2022 הוא הגוש שמצביע היום. מקבע את יחס ימין/שמאל ל-2022.',
  },
  {
    id: 'sector',
    label: 'מגזרים מ-2022',
    note: 'מקבע את גודל המגזרים ל-2022, ומשאיר לסקרים את ציר ימין/שמאל בתוך הציבור הכללי.',
  },
  {
    id: 'anchoredBloc',
    label: 'סקרים + תזוזת גושים',
    note: 'ממוצע הסקרים כבסיס, כשכל גוש מוכפל בתזוזת ההצבעה שלו מאז 2022.',
  },
  {
    id: 'anchoredSector',
    label: 'סקרים + תזוזת מגזרים',
    note: 'ממוצע הסקרים כבסיס, כשכל מגזר מוכפל בתזוזת ההצבעה שלו מאז 2022.',
  },
];

const forecastState = {
  data: null,
  round: 0,
  grouping: 'sector',
};

const pct1 = (value) => `${(value * 100).toFixed(1)}%`;
const factor = (value) => (value === null || value === undefined ? '—' : value.toFixed(2));
const fmtInt = new Intl.NumberFormat('he-IL');

const currentRound = () => forecastState.data.snapshots[forecastState.round];

/** Seats a variant gives a bloc, or 0. */
const blocOf26 = (party) => (forecastState.data.parties2026[party] || {}).bloc || 'other';

function renderForecastRounds() {
  const { snapshots } = forecastState.data;
  el('forecast-rounds').innerHTML = snapshots.map((snapshot, index) => {
    const thin = snapshot.coverage.localitiesImputed > 50;
    return `<button type="button" data-round="${index}"
      class="${index === forecastState.round ? 'active' : ''}"
      title="${thin ? 'סבב חלקי: רוב היישובים לא דיווחו' : 'כיסוי מלא'}">`
      + `${snapshot.hour}${thin ? ' ◦' : ''}</button>`;
  }).join('');
  el('forecast-rounds').querySelectorAll('[data-round]').forEach((button) => {
    button.addEventListener('click', () => {
      forecastState.round = Number(button.dataset.round);
      renderForecast();
    });
  });
}

function renderForecastNational() {
  const round = currentRound();
  const { coverage } = round;
  const national = round.nationalEstimate;
  const cards = [
    {
      label: `אומדן הצבעה ארצי בשעה ${round.hour}`,
      value: national ? pct1(national.turnout) : '—',
      note: national
        ? `${fmtInt.format(national.voters)} מצביעים · כולל מעטפות חיצוניות`
        : 'הוועדה לא פרסמה אומדן לסבב זה',
    },
    {
      label: 'הצבעה בקלפיות שדיווחו',
      value: pct1(coverage.nationalRate),
      note: `${fmtInt.format(coverage.votersReported)} מצביעים · ללא מעטפות חיצוניות`,
    },
    {
      label: 'קלפיות שדיווחו',
      value: fmtInt.format(coverage.ballotsReported),
      note: `${pct1(coverage.registerReported / coverage.registerTotal)} ממצאי המצביעים`,
    },
    {
      label: 'יישובים שדיווחו',
      value: `${fmtInt.format(coverage.localitiesReported)}`
        + `<span class="unit"> / ${fmtInt.format(coverage.localitiesReported + coverage.localitiesImputed)}</span>`,
      note: coverage.localitiesImputed > 50
        ? 'סבב חלקי — האות מדולל, ראו הערות'
        : `${coverage.localitiesImputed} הושלמו לפי הממוצע הארצי`,
    },
  ];
  el('forecast-national').innerHTML = cards.map((card) => `
    <div class="stat">
      <div class="stat-label">${card.label}</div>
      <div class="stat-value">${card.value}</div>
      <div class="stat-note">${card.note}</div>
    </div>`).join('');
}

/** One horizontal 120-seat bar per variant, with the 61 line marked. */
function renderForecastVariants() {
  const round = currentRound();
  const bars = FORECAST_VARIANTS.map((variant) => {
    const data = round.variants[variant.id];
    if (!data) return '';
    const blocs = data.blocSeats;
    const segments = ['netanyahu', 'opposition', 'arab', 'other']
      .filter((bloc) => blocs[bloc])
      .map((bloc) => {
        const meta = BLOC_META[bloc] || { label: 'אחר', color: '#9ca3af' };
        return `<span class="variant-seg" style="flex:${blocs[bloc]};background:${meta.color}"
          title="${attr(meta.label)} — ${blocs[bloc]} מנדטים">`
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
    return `
      <div class="variant">
        <div class="variant-head">
          <strong>${variant.label}</strong>
          ${verdict}
        </div>
        <div class="variant-bar">${segments}<span class="majority-line" aria-hidden="true"></span></div>
        <div class="variant-nums">${numbers}</div>
        <p class="variant-note">${variant.note}</p>
      </div>`;
  }).join('');
  el('forecast-variants').innerHTML =
    '<p class="variant-legend"><span class="majority-key" aria-hidden="true"></span>'
    + 'הקו האנכי מסמן 61 מנדטים. כל פס הוא 120 מנדטים ברוחב מלא, כך שהגרסאות ניתנות להשוואה בעין.</p>'
    + bars;
}

function renderForecastSectors() {
  const round = currentRound();
  const { grouping } = forecastState;
  const groups = round.groups[grouping];
  const order = forecastState.data.groupOrder[grouping];
  const rows = order.filter((group) => groups[group]).map((group) => {
    const data = groups[group];
    const moved = data.movement === null || data.movement === undefined
      ? ''
      : (data.movement >= 1.03 ? ' up' : (data.movement <= 0.97 ? ' down' : ''));
    return `<tr>
      <th scope="row">${data.label}</th>
      <td>${pct1(data.share22)}</td>
      <td>${pct1(data.share26)}</td>
      <td class="movement${moved}">×${factor(data.movement)}</td>
      <td>${factor(data.turnoutFactor)}</td>
      <td>${factor(data.registerFactor)}</td>
    </tr>`;
  }).join('');
  el('forecast-sectors').innerHTML = `
    <div class="seg seg-small" role="group" aria-label="חלוקה לקבוצות">
      <button type="button" data-grouping="sector" class="${grouping === 'sector' ? 'active' : ''}">מגזרים</button>
      <button type="button" data-grouping="bloc" class="${grouping === 'bloc' ? 'active' : ''}">גושים</button>
    </div>
    <div class="table-wrap">
      <table class="polls-table forecast-table">
        <thead><tr>
          <th scope="col">קבוצה</th>
          <th scope="col">ב-2022</th>
          <th scope="col">היום</th>
          <th scope="col">תזוזה</th>
          <th scope="col" title="שינוי בהצבעה, יחסית לארץ">הצבעה</th>
          <th scope="col" title="שינוי בגודל מצאי המצביעים, יחסית לארץ">מצאי</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  el('forecast-sectors').querySelectorAll('[data-grouping]').forEach((button) => {
    button.addEventListener('click', () => {
      forecastState.grouping = button.dataset.grouping;
      renderForecastSectors();
    });
  });
}

function renderForecastTable() {
  const round = currentRound();
  const { baseline, baselineSeats } = forecastState.data;
  const parties = Object.keys(baseline)
    .filter((party) => baseline[party] > 0)
    .sort((a, b) => baseline[b] - baseline[a]);

  const head = `<tr>
    <th scope="col">רשימה</th>
    <th scope="col">ממוצע הסקרים</th>
    <th scope="col">הסקרים בלבד</th>
    ${FORECAST_VARIANTS.map((v) => `<th scope="col">${v.label}</th>`).join('')}
  </tr>`;

  const cell = (seats) => (seats ? `<td class="num">${seats}</td>`
    : '<td class="num muted" title="מתחת לאחוז החסימה">—</td>');

  const body = parties.map((party) => `
    <tr>
      <th scope="row"><span class="chip" style="background:${colorOf(party)}"></span>${party}</th>
      <td class="num">${(baseline[party] * 100).toFixed(1)}%</td>
      ${cell(baselineSeats[party])}
      ${FORECAST_VARIANTS.map((v) => cell(round.variants[v.id].seats[party])).join('')}
    </tr>`).join('');

  const totals = `<tr class="total-row">
    <th scope="row">סך מנדטים</th>
    <td class="num">—</td>
    <td class="num">${sumSeats(baselineSeats)}</td>
    ${FORECAST_VARIANTS.map((v) => `<td class="num">${sumSeats(round.variants[v.id].seats)}</td>`).join('')}
  </tr>`;

  el('forecast-table').querySelector('thead').innerHTML = head;
  el('forecast-table').querySelector('tbody').innerHTML = body + totals;
}

const sumSeats = (seats) => Object.values(seats).reduce((acc, n) => acc + n, 0);

function renderForecast() {
  if (!forecastState.data) return;
  renderForecastRounds();
  renderForecastNational();
  renderForecastVariants();
  renderForecastSectors();
  renderForecastTable();
}

async function initForecast() {
  let data;
  try {
    const response = await fetch('data/forecast.json', { cache: 'no-cache' });
    if (!response.ok) return; // not an election day: leave the panel hidden
    data = await response.json();
  } catch (error) {
    return;
  }
  if (!data.snapshots || !data.snapshots.length) return;
  forecastState.data = data;
  // Open on the latest round, which is the only one with full coverage.
  forecastState.round = data.snapshots.length - 1;

  const polls = data.method.pollsUsed || [];
  const pollsters = [...new Set(polls.map((poll) => poll.pollster))];
  el('forecast-polls-note').textContent =
    `היחסים בתוך כל קבוצה מחושבים מ-${polls.length} סקרים עם אחוזים גולמיים שאיסופם`
    + ` הסתיים מ-${data.method.pollWindowFrom.split('-').reverse().join('.')} ואילך,`
    + ` מ-${pollsters.length} מכוני סקרים. הנתונים עודכנו ב-${data.generated.slice(11, 16)}.`;

  el('forecast').hidden = false;
  renderForecast();
}
