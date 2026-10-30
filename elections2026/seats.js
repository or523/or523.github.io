/* How the 120 seats were apportioned, replayed step by step.

   The live panel shows the seat counts; this shows the arithmetic that produced
   them. It is recomputed in the browser from the same snapshot rather than
   written down once, so when the committee revises a figure the explanation
   revises with it. An explainer that can drift out of step with the numbers
   printed beside it is worse than no explainer at all.

   Three things here matter for correctness:

   Comparisons are done by cross-multiplication, never by dividing first. The
   measures that decided the last three seats in 2026 differ by a few hundredths
   of a vote, which is exactly where a float comparison stops deserving trust.
   Every quantity is a whole number of votes well below 2^31, so the products
   are exact and so are the comparisons.

   Surplus agreements (הסכמי עודפים) are not a correction applied at the end.
   Two signatory lists are a single list for the whole apportionment and come
   apart only in the final step, which is why the trace works on "units" rather
   than on lists. Which lists were paired cannot be recovered from the seat
   counts, so it is carried in the dataset.

   The result is checked against the seat counts the build already computed, by
   a different implementation of the same law in another language. If the two
   disagree the panel says so instead of printing a second set of numbers next
   to the first. */

const seatInt = new Intl.NumberFormat('he-IL');
const seatFix = (value, digits = 2) => value.toLocaleString('he-IL', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});

const seatMathState = { data: null };

/** Lists keyed by ballot letters, as live.js does. */
function seatNames(data) {
  const map = {};
  data.lists.forEach((entry) => { map[entry.letters] = entry; });
  return map;
}

const seatName = (names, key) => (names[key] || { name: key }).name;
const seatLabel = (names, members) => members
  .map((key) => seatName(names, key)).join(' + ');

/* --------------------------------------------------------------- the maths */

/** Seats for a set of units by quota and largest measure, recording each step.

    This is the method the law describes: every unit takes the whole number of
    times the quota goes into its votes, and the seats left over by all that
    rounding down go one at a time to the largest votes/(seats+1). It reaches
    the same allocation as plain d'Hondt -- which is how `results_build.py`
    computes it -- but d'Hondt gives no account of itself, and the account is
    the whole point here. */
function apportionTrace(units, seats) {
  const pot = units.reduce((sum, unit) => sum + unit.votes, 0);
  units.forEach((unit) => {
    unit.seats = Math.floor((unit.votes * seats) / pot);
    // `seats` is mutated as the leftover seats are handed out below, so the
    // first-round figure has to be kept separately: a table that showed the
    // final count under the heading "whole times the quota goes in" would
    // contradict the sentence under it.
    unit.base = unit.seats;
  });
  const firstRound = units.reduce((sum, unit) => sum + unit.seats, 0);
  const rounds = [];
  for (let left = seats - firstRound; left > 0; left -= 1) {
    const ranked = [...units].sort((a, b) => (b.votes * (a.seats + 1))
      - (a.votes * (b.seats + 1)));
    const winner = ranked[0];
    const second = ranked[1];
    rounds.push({
      ranked: ranked.map((unit) => ({
        unit, votes: unit.votes, over: unit.seats + 1,
        measure: unit.votes / (unit.seats + 1),
      })),
      winner,
      second,
      // An exact tie is not a rounding curiosity: the law settles it by lot,
      // so a page that simply named a winner would be inventing one.
      tied: second !== undefined && winner.votes * (second.seats + 1)
        === second.votes * (winner.seats + 1),
      // What the runner-up was short by, in its own votes. The seat moves if it
      // gains this much, which is the only honest way to say "how close".
      shortBy: second === undefined ? null
        : Math.ceil((winner.votes / (winner.seats + 1)) * (second.seats + 1))
          - second.votes,
    });
    winner.seats += 1;
  }
  return { pot, quota: pot / seats, firstRound, rounds };
}

/** The whole apportionment of one snapshot, as a readable trace. */
function seatTrace(snapshot, data) {
  const total = data.seatsTotal;
  const threshold = data.threshold;
  const valid = snapshot.valid;
  const passing = {};
  const failing = {};
  Object.keys(snapshot.votes).forEach((key) => {
    const count = snapshot.votes[key];
    if (count > 0) (count / valid >= threshold ? passing : failing)[key] = count;
  });

  const pairs = (data.agreements || [])
    .filter(([one, two]) => passing[one] && passing[two]);
  const paired = new Set(pairs.reduce((all, pair) => all.concat(pair), []));
  const units = pairs
    .map(([one, two]) => ({ members: [one, two], votes: passing[one] + passing[two] }))
    .concat(Object.keys(passing).filter((key) => !paired.has(key))
      .map((key) => ({ members: [key], votes: passing[key] })))
    .sort((a, b) => b.votes - a.votes);

  const main = apportionTrace(units, total);

  // Each pair now divides what it won between its two members by the very same
  // method: the pair's own votes over the pair's own seats is the inner quota,
  // and a seat left over goes to the larger measure.
  const splits = [];
  const seats = {};
  units.forEach((unit) => {
    if (unit.members.length === 1) {
      seats[unit.members[0]] = unit.seats;
      return;
    }
    const inner = unit.members
      .map((key) => ({ members: [key], votes: passing[key] }))
      .sort((a, b) => b.votes - a.votes);
    const inside = apportionTrace(inner, unit.seats);
    inner.forEach((one) => { seats[one.members[0]] = one.seats; });
    splits.push({ unit, inner, inside });
  });

  const lost = Object.keys(failing).reduce((sum, key) => sum + failing[key], 0);
  return {
    passing, failing, lost, pairs, units, main, splits, seats, valid, total,
    threshold,
  };
}

/** A list with fewer votes than another yet more seats, if one exists.

    This is the plainest thing a surplus agreement does, and it cannot be
    written into the page in advance because whether it happens at all depends
    on the count. The narrowest such gap is the one worth showing. */
function seatInversion(trace) {
  const letters = Object.keys(trace.seats).filter((key) => trace.seats[key] > 0);
  let best = null;
  letters.forEach((low) => letters.forEach((high) => {
    if (trace.passing[low] >= trace.passing[high]) return;
    if (trace.seats[low] <= trace.seats[high]) return;
    const gap = trace.passing[high] - trace.passing[low];
    if (!best || gap < best.gap) best = { low, high, gap };
  }));
  return best;
}

/* ------------------------------------------------------------- the markup */

function seatTable(head, rows) {
  return `<div class="table-wrap"><table class="polls-table seat-table">
    <thead><tr>${head.map((cell) => `<th scope="col">${cell}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function seatThresholdStep(trace, names) {
  const bar = Math.ceil(trace.valid * trace.threshold);
  const failed = Object.keys(trace.failing)
    .sort((a, b) => trace.failing[b] - trace.failing[a]);
  const shown = failed.filter((key) => trace.failing[key] / trace.valid >= 0.003);
  const rest = failed.length - shown.length;
  const rows = shown.map((key) => `<tr>
      <th scope="row">${attr(seatName(names, key))}</th>
      <td class="num">${seatInt.format(trace.failing[key])}</td>
      <td class="num">${seatFix(trace.failing[key] / trace.valid * 100)}%</td>
      <td class="num muted">${seatInt.format(bar - trace.failing[key])}</td>
    </tr>`).join('');
  return {
    title: 'אחוז החסימה',
    body: `
    <p class="step-text">
      אחוז החסימה הוא ${seatFix(trace.threshold * 100)}% מהקולות הכשרים, כלומר
      <strong>${seatInt.format(bar)} קולות</strong> מתוך
      ${seatInt.format(trace.valid)}.
      ${Object.keys(trace.passing).length} רשימות עברו אותו. מי שלא עבר יוצא
      מהחישוב כליל — ${seatInt.format(trace.lost)} קולות,
      <strong>${seatFix(trace.lost / trace.valid * 100)}% מהקולות הכשרים</strong>,
      שאינם מיוצגים בכנסת.
    </p>
    ${!shown.length ? '' : seatTable(
    ['מי לא עבר', 'קולות', 'אחוז', 'חסרו לו'], rows)}
    ${rest > 0 ? `<p class="step-note">ועוד ${rest} רשימות קטנות.</p>` : ''}`,
  };
}

function seatQuotaStep(trace) {
  const { pot, quota } = trace.main;
  return {
    title: 'המודד הכללי',
    body: `
    <p class="step-text">
      נשארו <strong>${seatInt.format(pot)} קולות</strong> של הרשימות שעברו, והם
      מתחלקים ל-${trace.total} מנדטים. המודד — מספר הקולות שעולה מנדט אחד — הוא
      החלוקה הזו.
    </p>
    <div class="formula">
      <span>${seatInt.format(pot)}</span>
      <span class="op">÷</span>
      <span>${trace.total}</span>
      <span class="op">=</span>
      <strong>${seatFix(quota)}</strong>
      <span class="unit">קולות למנדט</span>
    </div>
    <p class="step-note">
      המודד מחושב <em>אחרי</em> שהנופלות הוצאו. כל קול שהלך לרשימה שלא עברה את
      החסימה מקטין את המודד, כלומר מוזיל את המנדט לכל מי שכן עבר.
    </p>`,
  };
}

function seatFirstRoundStep(trace, names) {
  const { quota, firstRound } = trace.main;
  const left = trace.total - firstRound;
  const rows = trace.units.map((unit) => `<tr>
      <th scope="row">${attr(seatLabel(names, unit.members))}${unit.members.length > 1
    ? '<span class="pair-tag">הסכם עודפים</span>' : ''}</th>
      <td class="num">${seatInt.format(unit.votes)}</td>
      <td class="num muted">${seatFix(unit.votes / quota, 3)}</td>
      <td class="num strong">${unit.base}</td>
    </tr>`).join('');
  return {
    title: 'הסיבוב הראשון',
    body: `
    <p class="step-text">
      כל רשימה מקבלת את <strong>המספר השלם</strong> של הפעמים שהמודד נכנס
      בקולות שלה.${!trace.pairs.length ? '' : ` וכאן נכנסים הסכמי העודפים: שני
      חותמים על הסכם מחולקים <strong>כגוף אחד</strong> לכל אורך החישוב,
      ומתפצלים ביניהם רק בשלב האחרון.`}
    </p>
    ${seatTable([trace.pairs.length ? 'גוף' : 'רשימה', 'קולות', 'חלקי המודד',
    'מנדטים'], rows)}
    <p class="step-note">
      סך הכול <strong>${firstRound} מנדטים</strong>. השברים נזרקו, ולכן
      <strong>${left === 1 ? 'מנדט אחד נותר' : `${left} מנדטים נותרו`}</strong>
      לחלוקה.
    </p>`,
  };
}

function seatLeftoverStep(trace, names) {
  const { rounds } = trace.main;
  if (!rounds.length) {
    return {
      title: 'המנדטים הנותרים',
      body: `<p class="step-text">המודד חילק את כל ${trace.total} המנדטים בלי
        שארית — מצב שאינו קורה כמעט לעולם, ואין מה לחלק הלאה.</p>`,
    };
  }
  const cards = rounds.map((round, index) => {
    const rows = round.ranked.map((entry) => {
      const wins = entry.unit === round.winner;
      return `<tr class="${wins ? 'wins' : ''}">
        <th scope="row">${attr(seatLabel(names, entry.unit.members))}</th>
        <td class="num muted calc">${seatInt.format(entry.votes)} ÷ ${entry.over}</td>
        <td class="num strong">${seatFix(entry.measure)}</td>
        <td class="takes">${wins ? 'זוכה' : ''}</td>
      </tr>`;
    }).join('');
    return `<div class="leftover">
      <div class="leftover-head">
        <strong>מנדט ${trace.total - rounds.length + index + 1}</strong>
        <span>${attr(seatLabel(names, round.winner.members))}</span>
      </div>
      ${seatTable(['גוף', 'החישוב', 'המודד שלו', ''], rows)}
      ${round.tied ? `<p class="step-note warn">שוויון מדויק בין שני הראשונים —
        במצב כזה החוק קובע הגרלה, והחישוב כאן בחר שרירותית.</p>`
    : round.shortBy === null ? '' : `<p class="step-note">
        ל${attr(seatLabel(names, round.second.members))} היו חסרים
        <strong>${seatInt.format(round.shortBy)} קולות</strong> כדי לקחת את
        המנדט הזה.</p>`}
    </div>`;
  }).join('');
  return {
    title: rounds.length === 1 ? 'המנדט הנותר' : `${rounds.length} המנדטים הנותרים`,
    body: `
    <p class="step-text">
      כאן המודד הופך <strong>אישי</strong>. לכל גוף מחשבים את הקולות שלו חלקי
      מספר המנדטים שבידיו <em>ועוד אחד</em> — כמה היה עולה לו כל מנדט אם יקבל
      עוד אחד. מי שהמספר הזה הוא הגדול ביותר אצלו זוכה, ואז מחשבים הכול מחדש.
      מנדט שמתווסף מוריד את המודד של הזוכה, ולכן גוף גדול אינו גורף את כולם.
    </p>
    <div class="leftovers">${cards}</div>`,
  };
}

function seatSplitStep(trace, names) {
  if (!trace.splits.length) return null;
  const cards = trace.splits.map(({ unit, inner, inside }) => {
    const rows = inner.map((one) => {
      const wins = inside.rounds.length && inside.rounds[0].winner === one;
      return `<tr class="${wins ? 'wins' : ''}">
        <th scope="row">${attr(seatName(names, one.members[0]))}</th>
        <td class="num">${seatInt.format(one.votes)}</td>
        <td class="num muted">${seatFix(one.votes / inside.quota, 3)}</td>
        <td class="num strong">${one.base}${one.seats > one.base
    ? ` <span class="plus">+${one.seats - one.base}</span>` : ''}</td>
      </tr>`;
    }).join('');
    return `<div class="leftover">
      <div class="leftover-head">
        <strong>${attr(seatLabel(names, unit.members))}</strong>
        <span>${unit.seats} מנדטים · מודד פנימי ${seatFix(inside.quota)}</span>
      </div>
      ${seatTable(['רשימה', 'קולות', 'חלקי המודד הפנימי', 'מנדטים'],
    rows)}
      ${!inside.rounds.length ? '' : `<p class="step-note">
        העודף נפל ל<strong>${attr(seatLabel(names,
    inside.rounds[0].winner.members))}</strong> —
        ${seatFix(inside.rounds[0].ranked[0].measure)} מול
        ${seatFix(inside.rounds[0].ranked[1].measure)}.</p>`}
    </div>`;
  }).join('');
  return {
    title: 'פיצול הזוגות',
    body: `
    <p class="step-text">
      עכשיו כל זוג מחלק בין שני חבריו את מה שזכה בו — <strong>באותה שיטה
      בדיוק</strong>. המודד הפנימי הוא קולות הזוג חלקי המנדטים שהזוג קיבל, וגם
      כאן מנדט שנותר הולך למודד הגדול.
    </p>
    <div class="leftovers">${cards}</div>`,
  };
}

function seatResultStep(trace, names, snapshot) {
  const letters = Object.keys(trace.seats)
    .filter((key) => trace.seats[key] > 0)
    .sort((a, b) => trace.seats[b] - trace.seats[a]
      || trace.passing[b] - trace.passing[a]);
  const rows = letters.map((key) => {
    const info = names[key] || { name: key, color: '#6b7280' };
    return `<tr>
      <th scope="row"><span class="chip static" style="background:${info.color}"></span>${attr(info.name)}</th>
      <td class="num">${seatInt.format(trace.passing[key])}</td>
      <td class="num strong">${trace.seats[key]}</td>
      <td class="num muted">${seatInt.format(Math.round(trace.passing[key]
      / trace.seats[key]))}</td>
    </tr>`;
  }).join('');
  const sum = letters.reduce((count, key) => count + trace.seats[key], 0);
  // The stored seat counts come from another implementation of the same law.
  // If the two ever disagree, say so rather than quietly printing one number
  // here and a different one in the results table above.
  const keys = new Set(Object.keys(trace.seats).concat(Object.keys(snapshot.seats)));
  const agrees = [...keys].every((key) => (trace.seats[key] || 0)
    === (snapshot.seats[key] || 0));
  const inversion = seatInversion(trace);
  return {
    title: 'התוצאה',
    body: `
    ${seatTable(['רשימה', 'קולות', 'מנדטים', 'קולות למנדט בפועל'], rows)}
    <p class="step-note">
      ${sum} מנדטים.
      ${agrees ? `החישוב הזה מגיע בדיוק לאותם מספרים שבטבלת התוצאות למעלה,
        שמחושבים בשיטה אחרת (ד'הונט ישיר) ובשפה אחרת — שתי הדרכים שקולות
        מתמטית, וההסכמה ביניהן היא הבדיקה.`
    : `<strong class="warn-text">אזהרה: החישוב כאן אינו תואם את טבלת התוצאות
        למעלה. זהו באג באתר, ועד שיתוקן יש להעדיף את הנתונים הרשמיים של ועדת
        הבחירות.</strong>`}
    </p>
    ${!inversion ? '' : `<p class="callout">
      <strong>${attr(seatName(names, inversion.low))} קיבלה
      ${trace.seats[inversion.low]} מנדטים עם פחות קולות
      מ${attr(seatName(names, inversion.high))}, שקיבלה
      ${trace.seats[inversion.high]}</strong> — הפרש של
      ${seatInt.format(inversion.gap)} קולות בכיוון ההפוך. זה לא באג, זה מה
      שהסכם עודפים עושה: מה שנמדד אינו כמה קולות יש לרשימה, אלא כמה קולות יש
      לגוף שהיא חלק ממנו ואיך הם מתחלקים בתוכו.
    </p>`}`,
  };
}

function seatCounterfactualStep(trace, snapshot, data, names) {
  if (!trace.pairs.length) return null;
  const alt = seatTrace(snapshot, { ...data, agreements: [] });
  const moved = Object.keys({ ...trace.seats, ...alt.seats })
    .filter((key) => (trace.seats[key] || 0) !== (alt.seats[key] || 0))
    .sort((a, b) => ((alt.seats[b] || 0) - (trace.seats[b] || 0))
      - ((alt.seats[a] || 0) - (trace.seats[a] || 0)));
  if (!moved.length) {
    return {
      title: 'ומה אם לא היו הסכמי עודפים',
      body: `<p class="step-text">בספירה הזו ההסכמים אינם משנים את התוצאה: אותם
        ${trace.total} מנדטים היו מתחלקים כך גם בלעדיהם. זה לא קבוע — הם כן שינו
        את התוצאה בשלבים אחרים של הספירה, ועשויים לשנות אותה שוב בכל תיקון.</p>`,
    };
  }
  // Seats that changed hands, not lists that changed -- one seat moving shows
  // up as two lists, and three lists can be two seats.
  const shifted = moved.reduce((sum, key) => sum
    + Math.max(0, (alt.seats[key] || 0) - (trace.seats[key] || 0)), 0);
  const blocs = {};
  Object.keys(alt.seats).forEach((key) => {
    const bloc = (names[key] || {}).bloc;
    if (bloc && alt.seats[key]) blocs[bloc] = (blocs[bloc] || 0) + alt.seats[key];
  });
  const now = snapshot.blocSeats || {};
  const blocLine = ['netanyahu', 'opposition', 'arab']
    .filter((bloc) => now[bloc] || blocs[bloc])
    .map((bloc) => {
      const info = BLOC_META[bloc] || { label: bloc, color: '#9ca3af' };
      const delta = (blocs[bloc] || 0) - (now[bloc] || 0);
      return `<span class="cf-bloc">
        <i style="background:${info.color}"></i>${info.label}
        <strong>${now[bloc] || 0} → ${blocs[bloc] || 0}</strong>
        ${delta ? `<em class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</em>`
        : '<em class="same">ללא שינוי</em>'}
      </span>`;
    }).join('');
  return {
    title: 'ומה אם לא היו הסכמי עודפים',
    body: `
    <p class="step-text">
      אותו חישוב בלי הזוגות מזיז
      <strong>${shifted === 1 ? 'מנדט אחד' : `${shifted} מנדטים`}</strong>:
      ${moved.map((key) => `${attr(seatName(names, key))}
        ${trace.seats[key] || 0} → ${alt.seats[key] || 0}`).join(' · ')}.
    </p>
    <div class="cf-blocs">${blocLine}</div>
    <p class="step-note">
      כל ההסכמים הם תוך-גושיים ונראים לכן בלתי מזיקים — אבל המנדט שעודף משולב
      זוכה בו נלקח ממישהו, ולא בהכרח מאותו גוש. זו הסיבה שחישוב שמתעלם מהם אינו
      קירוב גרוע אלא פשוט שגוי.
    </p>`,
  };
}

/* -------------------------------------------------------------- the panel */

function renderSeatMath() {
  const data = seatMathState.data;
  const snapshot = data.snapshots[data.snapshots.length - 1];
  const names = seatNames(data);
  const trace = seatTrace(snapshot, data);
  const steps = [
    seatThresholdStep(trace, names),
    seatQuotaStep(trace),
    seatFirstRoundStep(trace, names),
    seatLeftoverStep(trace, names),
    seatSplitStep(trace, names),
    seatResultStep(trace, names, snapshot),
    seatCounterfactualStep(trace, snapshot, data, names),
  ].filter(Boolean);
  el('seat-math').innerHTML = steps.map((step, index) => `
    <section class="step">
      <div class="step-head">
        <span class="step-num">${index + 1}</span>
        <h3>${step.title}</h3>
      </div>
      ${step.body}
    </section>`).join('');
  el('seat-math-sub').textContent = 'החישוב שלמטה מורץ בדפדפן על צילום המצב'
    + ` האחרון — ${seatInt.format(snapshot.valid)} קולות כשרים נכון ל-`
    + `${snapshot.ts.slice(11, 16)}. כל מספר כאן נגזר מהנתון הזה ואף אחד מהם לא`
    + ' הוקלד, כך שהוא ממשיך להיות נכון גם אחרי תיקון של הוועדה.';
}

/** Called by live.js once the results dataset is in. */
function initSeatMath(data) {
  if (!data || !data.snapshots || !data.snapshots.length) return;
  seatMathState.data = data;
  el('seats').hidden = false;
  renderSeatMath();
}
