/* Trip detection. A trip is a date range; restaurant (and other configured)
 * spending inside a trip is re-categorised as Travel.
 *
 * Auto-detection uses on-site travel charges (hotels, car rentals) and
 * in-person purchases whose descriptor shows a state other than home, plus
 * foreign-transaction fees. Prepaid bookings (airfare, Airbnb, Expedia) are
 * ignored as date signals because they are usually charged weeks ahead. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const C = () => FS.Categories;

  const CITY_PREFIX = new Set('SAN LOS LAS NEW SANTA ST ST. FORT FT PALM SALT EL LA PALO MOUNTAIN SOUTH NORTH WEST EAST PORT LAKE LONG GRAND SIOUX BATON CORPUS COLORADO KANSAS OKLAHOMA JERSEY VIRGINIA CEDAR ANN DEL REDWOOD HALF MORENO RANCHO DALY FOSTER UNION CULVER BEVERLY HUNTINGTON NEWPORT DANA LAGUNA MISSION CHULA'.split(' '));
  const ONLINE_RE = /\.COM|WWW\.|HTTP|\bHELP\b|\bONLINE\b|\bINTERNET\b|\d{3}[-.]\d{3}[-.]\d{4}|\b8(00|33|44|55|66|77|88)[-\s]?\d{3}/i;
  const FOREIGN_RE = /FOREIGN TRANS(ACTION)? FEE|INTL TRANSACTION FEE|INTERNATIONAL TRANSACTION|FX FEE/i;

  /** Pull "CITY ST" off the end of a card descriptor, if present. */
  function location(desc) {
    const d = String(desc || '').toUpperCase().replace(/[#*]\S*/g, ' ').replace(/\s+\d[\d-]*\s*$/, '').replace(/\s+/g, ' ').trim();
    const m = d.match(/(?:^|\s)([A-Z][A-Z.'-]*(?:\s[A-Z][A-Z.'-]*)?)\s([A-Z]{2})$/);
    if (!m || !FS.US_STATES.has(m[2])) return null;
    const words = m[1].split(' ');
    const city = words.length === 2 && CITY_PREFIX.has(words[0]) ? m[1] : words[words.length - 1];
    return { city, state: m[2] };
  }

  // Categories that are billed remotely and say nothing about where you are.
  const REMOTE = new Set(['Entertainment Sub', 'AI Tool Sub', 'Bills & Utilities', 'Payments & Transfers', 'Income', 'Fitness Club']);
  const isInPerson = (t) => !REMOTE.has(t.baseCategory) && !ONLINE_RE.test(t.description);

  function inferHomeStates(txs) {
    const counts = {};
    for (const t of txs) {
      if (!isInPerson(t)) continue;
      const loc = location(t.description);
      if (loc) counts[loc.state] = (counts[loc.state] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? [top[0]] : [];
  }

  /** @param txs transactions with .baseCategory already set */
  function detectTrips(txs, settings) {
    const home = settings.homeStates && settings.homeStates.length ? settings.homeStates : inferHomeStates(txs);
    const homeSet = new Set(home.map((s) => s.toUpperCase()));
    const gap = settings.tripGapDays == null ? 3 : settings.tripGapDays;
    const signals = [];
    for (const t of txs) {
      if (t.amount <= 0) continue;
      const desc = String(t.description).toUpperCase();
      if (FOREIGN_RE.test(desc)) { signals.push({ date: t.date, kind: 'foreign', place: 'Abroad' }); continue; }
      if (C().PREPAID_TRAVEL_RE.test(desc)) continue;
      const loc = location(desc);
      if (C().LODGING_RE.test(desc) && t.baseCategory === C().TRAVEL) {
        signals.push({ date: t.date, kind: 'lodging', place: loc && !homeSet.has(loc.state) ? `${titleCase(loc.city)}, ${loc.state}` : null, away: !!(loc && !homeSet.has(loc.state)), home: !!(loc && homeSet.has(loc.state)) });
        continue;
      }
      if (!isInPerson(t) || !loc || homeSet.size === 0) continue;
      if (!homeSet.has(loc.state)) signals.push({ date: t.date, kind: 'away', place: `${titleCase(loc.city)}, ${loc.state}`, away: true });
    }
    signals.sort((a, b) => (a.date < b.date ? -1 : 1));

    const clusters = [];
    for (const s of signals) {
      const c = clusters[clusters.length - 1];
      if (c && FS.daysBetween(c.end, s.date) <= gap) { c.end = s.date; c.signals.push(s); }
      else clusters.push({ start: s.date, end: s.date, signals: [s] });
    }

    const trips = [];
    for (const c of clusters) {
      const lodging = c.signals.filter((s) => s.kind === 'lodging');
      const awayish = c.signals.filter((s) => s.kind !== 'lodging');
      // Needs an away-from-home (or unknown-location) hotel/rental, or several away purchases.
      // A hotel in the home state only counts together with another signal.
      const strong = lodging.some((s) => !s.home) || awayish.length >= 2 || (lodging.length && awayish.length);
      if (!strong) continue;
      let start = c.start;
      // Hotels and car rentals usually post at check-out: assume at least one night before.
      if (c.signals[0].kind === 'lodging') start = FS.addDays(start, -1);
      const places = {};
      c.signals.forEach((s) => { if (s.place) places[s.place] = (places[s.place] || 0) + 1; });
      const place = Object.entries(places).sort((a, b) => b[1] - a[1])[0];
      trips.push({
        id: 'auto_' + start + '_' + c.end,
        key: start + '|' + c.end,
        name: place ? `Trip: ${place[0]}` : 'Trip',
        start, end: c.end, source: 'auto',
        reason: `${lodging.length} hotel/rental charge(s), ${awayish.length} away-from-home purchase(s)`,
      });
    }
    return { trips, homeStates: home };
  }

  function titleCase(s) { return String(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()); }

  function tripFor(date, trips) {
    return trips.find((t) => date >= t.start && date <= t.end) || null;
  }

  FS.Trips = { location, detectTrips, inferHomeStates, tripFor };
})(typeof window !== 'undefined' ? window : globalThis);
