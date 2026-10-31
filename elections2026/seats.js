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

   Surplus agreements (הסכמי עודפים) enter at one specific stage and not
   before it. Every list takes its own whole quotas alone; only then do two
   signatories become a single body, for the seats the quota left over. That
   ordering is the law's -- see `seatTrace` -- and getting it wrong does not
   change the 120 seats, but it does change what the page claims the law says.
   Which lists were paired cannot be recovered from the seat counts, so it is
   carried in the dataset.

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

/** Hand out seats one at a time to the largest votes/(seats+1).

    This is section 81(ד), the Bader-Ofer amendment itself, and it is used twice:
    once among the bodies competing for the seats the quota left over, and again
    inside a linked pair to settle which partner keeps what the pair won.

    `bodies` are mutated -- each gains the seats it wins -- and one record per
    seat is returned, holding every contender's measure at the moment that seat
    was decided, so the page can show the contest and not just its outcome. */
function shareOutRemainder(bodies, seats) {
  const held = () => bodies.reduce((sum, body) => sum + body.seats, 0);
  const rounds = [];
  while (held() < seats) {
    const ranked = [...bodies].sort((a, b) => (b.votes * (a.seats + 1))
      - (a.votes * (b.seats + 1)));
    const winner = ranked[0];
    const second = ranked[1];
    rounds.push({
      ranked: ranked.map((body) => ({
        body, votes: body.votes, over: body.seats + 1,
        measure: body.votes / (body.seats + 1),
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
  return rounds;
}

/** The whole apportionment of one snapshot, as a readable trace.

    The order of the two stages is the law's, not a presentational choice.
    Section 67(א) says an agreement between two lists has no effect except the
    one section 82 gives it, and section 82 makes the pair a single list only
    "לענין חלוקת המנדטים לפי סעיף 81(ד)" -- the seats left over. So every list
    takes its own whole quotas alone first, and the pairing begins after that.

    Combining the pair's votes before the quota instead reaches the same 120
    seats by a shorter route, because the quota floor can never exceed what
    d'Hondt gives a body; `pairedFirstRound` records what that route would have
    reported, since a reader who has seen that number elsewhere deserves to
    find it here rather than conclude one of the two is wrong. */
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

  // Section 81: the quota, and the whole number of times it goes into each
  // list's own votes. No list is yet paired with any other.
  const pot = Object.keys(passing).reduce((sum, key) => sum + passing[key], 0);
  const quota = pot / total;
  const base = {};
  Object.keys(passing).forEach((key) => {
    base[key] = Math.floor((passing[key] * total) / pot);
  });
  const firstRound = Object.keys(base).reduce((sum, key) => sum + base[key], 0);

  // Section 82: only now do linked lists become one body, carrying in both
  // their votes and the seats they have each already won.
  const pairs = (data.agreements || [])
    .filter(([one, two]) => passing[one] && passing[two]);
  const paired = new Set(pairs.reduce((all, pair) => all.concat(pair), []));
  const bodies = pairs
    .map(([one, two]) => ({
      members: [one, two],
      votes: passing[one] + passing[two],
      seats: base[one] + base[two],
    }))
    .concat(Object.keys(passing).filter((key) => !paired.has(key))
      .map((key) => ({ members: [key], votes: passing[key], seats: base[key] })))
    .sort((a, b) => b.votes - a.votes);
  bodies.forEach((body) => { body.entry = body.seats; });
  const pairedFirstRound = bodies
    .reduce((sum, body) => sum + Math.floor((body.votes * total) / pot), 0);

  const rounds = shareOutRemainder(bodies, total);

  // Section 82 again: what a pair won together is then settled between its two
  // members by that same rule, each starting from its own first-round seats.
  const splits = [];
  const seats = {};
  bodies.forEach((body) => {
    if (body.members.length === 1) {
      seats[body.members[0]] = body.seats;
      return;
    }
    const inner = body.members
      .map((key) => ({
        members: [key], votes: passing[key], seats: base[key], entry: base[key],
      }))
      .sort((a, b) => b.votes - a.votes);
    const innerRounds = shareOutRemainder(inner, body.seats);
    inner.forEach((one) => { seats[one.members[0]] = one.seats; });
    splits.push({ body, inner, innerRounds });
  });

  const lost = Object.keys(failing).reduce((sum, key) => sum + failing[key], 0);
  return {
    passing, failing, lost, pairs, bodies, base, pot, quota, firstRound,
    pairedFirstRound, rounds, splits, seats, valid, total, threshold,
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

function seatTable(head, rows, extra = '') {
  return `<div class="table-wrap"><table class="polls-table seat-table ${extra}">
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
  const { pot, quota } = trace;
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
  const { quota, firstRound, pairedFirstRound } = trace;
  const left = trace.total - firstRound;
  const rows = Object.keys(trace.base)
    .sort((a, b) => trace.passing[b] - trace.passing[a])
    .map((key) => `<tr>
      <th scope="row">${attr(seatName(names, key))}</th>
      <td class="num">${seatInt.format(trace.passing[key])}</td>
      <td class="num muted">${seatFix(trace.passing[key] / quota, 3)}</td>
      <td class="num strong">${trace.base[key]}</td>
    </tr>`).join('');
  return {
    title: 'הסיבוב הראשון',
    body: `
    <p class="step-text">
      כל רשימה מקבלת את <strong>המספר השלם</strong> של הפעמים שהמודד נכנס
      בקולות שלה. ${!trace.pairs.length ? '' : `בשלב הזה <strong>הסכמי העודפים
      עדיין לא נכנסו לתמונה</strong> — כל רשימה עומדת לבדה, גם אם חתמה.`}
    </p>
    ${seatTable(['רשימה', 'קולות', 'חלקי המודד', 'מנדטים'], rows)}
    <p class="step-note">
      סך הכול <strong>${firstRound} מנדטים</strong>. השברים נזרקו, ולכן
      <strong>${left === 1 ? 'מנדט אחד נותר' : `${left} מנדטים נותרו`}</strong>
      לחלוקה.
    </p>
    ${pairedFirstRound === firstRound ? '' : `<p class="step-note">
      יש מי שמציג כאן <strong>${pairedFirstRound}</strong> ולא
      ${firstRound}, בחישוב שמחבר את קולות הזוגות כבר בשלב הזה. שתי הדרכים
      מגיעות לאותה חלוקה סופית, אבל סעיף 67(א) קובע שלהסכם אין תוצאה מלבד זו
      שבסעיף 82, וסעיף 82 מצרף את החותמות לרשימה אחת רק
      <em>לעניין חלוקת המנדטים לפי סעיף 81(ד)</em> — כלומר רק לשלב הבא.
    </p>`}`,
  };
}

function seatLeftoverStep(trace, names) {
  const { rounds } = trace;
  if (!rounds.length) {
    return {
      title: 'המנדטים הנותרים',
      body: `<p class="step-text">המודד חילק את כל ${trace.total} המנדטים בלי
        שארית — מצב שאינו קורה כמעט לעולם, ואין מה לחלק הלאה.</p>`,
    };
  }
  const cards = rounds.map((round, index) => {
    const rows = round.ranked.map((entry) => {
      const wins = entry.body === round.winner;
      return `<tr class="${wins ? 'wins' : ''}">
        <th scope="row">${attr(seatLabel(names, entry.body.members))}</th>
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
      ${!trace.pairs.length ? '' : `<strong>רק כאן</strong> נכנסים הסכמי
      העודפים: זוג חותמות נחשב מעכשיו לגוף אחד, ומביא איתו גם את הקולות של
      שתיהן וגם את המנדטים שכל אחת כבר זכתה בהם בסיבוב הראשון.`}
    </p>
    <div class="leftovers">${cards}</div>`,
  };
}

function seatSplitStep(trace, names) {
  if (!trace.splits.length) return null;
  const cards = trace.splits.map(({ body, inner, innerRounds }) => {
    const won = body.seats - body.entry;
    // Only the seats the pair won together are at stake here; what each member
    // brought in from the first round is already hers and is shown as such.
    const rows = inner.map((one) => {
      const takes = innerRounds.some((round) => round.winner === one);
      const first = innerRounds[0]
        && innerRounds[0].ranked.find((entry) => entry.body === one);
      return `<tr class="${takes ? 'wins' : ''}">
        <th scope="row">${attr(seatName(names, one.members[0]))}</th>
        <td class="num muted">${one.entry}</td>
        <td class="num muted calc">${!first ? '—'
    : `${seatInt.format(one.votes)} ÷ ${first.over}`}</td>
        <td class="num strong">${!first ? '' : seatFix(first.measure)}</td>
        <td class="num strong">${one.seats}</td>
      </tr>`;
    }).join('');
    return `<div class="leftover">
      <div class="leftover-head">
        <strong>${attr(seatLabel(names, body.members))}</strong>
        <span>${won === 1 ? 'מנדט אחד לחלוקה' : `${won} מנדטים לחלוקה`}</span>
      </div>
      ${seatTable(['רשימה', 'מהסיבוב הראשון', 'החישוב', 'המודד שלה', 'סה"כ'],
    rows, 'split-table')}
    </div>`;
  }).join('');
  return {
    title: 'פיצול הזוגות',
    body: `
    <p class="step-text">
      מה שזוג זכה בו יחד נחלק עכשיו בין שתי חברותיו — <strong>באותו כלל
      בדיוק</strong>, סעיף 81(ד) שוב, רק שהפעם הוא מופעל בתוך הזוג. כל אחת
      יוצאת למרוץ הזה ממספר המנדטים שלה מהסיבוב הראשון, ומי שהמודד שלה גבוה
      יותר לוקחת את המנדט. המנדטים שכל אחת כבר זכתה בהם לבדה אינם על הפרק.
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
