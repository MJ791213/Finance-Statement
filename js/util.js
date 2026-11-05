/* Shared helpers. Every module attaches to the global FS namespace so the app
 * works when index.html is opened straight from disk (file://), where browsers
 * refuse to load ES modules. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function iso(y, m, d) {
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function fullYear(y) {
    y = Number(y);
    if (y < 100) y += 2000;
    return y;
  }

  function monthIndex(name) {
    const i = MONTHS.indexOf(String(name).slice(0, 3).toLowerCase());
    return i < 0 ? 0 : i + 1;
  }

  /** Parse a stand-alone date string into ISO yyyy-mm-dd (US month-first order). */
  function parseDate(s, fallbackYear) {
    if (s == null) return null;
    s = String(s).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/)) || (m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) {
      const y = m[3] ? fullYear(m[3]) : fallbackYear;
      return iso(y, +m[1], +m[2]);
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/))) {
      const mi = monthIndex(m[1]);
      if (!mi) return null;
      return iso(m[3] ? +m[3] : fallbackYear, mi, +m[2]);
    }
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s*(\d{4})?/))) {
      const mi = monthIndex(m[2]);
      if (!mi) return null;
      return iso(m[3] ? +m[3] : fallbackYear, mi, +m[1]);
    }
    return null;
  }

  /** Parse "$1,234.56", "(12.00)", "-5.00", "12.00 CR", "12.00-" into a signed number. */
  function parseAmount(s) {
    if (s == null) return null;
    if (typeof s === 'number') return s;
    let t = String(s).trim();
    if (!t) return null;
    let neg = false;
    if (/\bCR\b\.?$/i.test(t)) { neg = true; t = t.replace(/\s*CR\.?$/i, ''); }
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
    if (/^[-−–]/.test(t)) { neg = true; t = t.slice(1); }
    t = t.replace(/^[+]/, '').replace(/[$€£¥\s]/g, '').replace(/,/g, '');
    if (/^[-−–]/.test(t)) { neg = !neg; t = t.slice(1); }
    if (!/^\d*\.?\d+$/.test(t)) return null;
    const v = parseFloat(t);
    return neg ? -v : v;
  }

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '';
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function addDays(isoDate, n) {
    const d = new Date(isoDate + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
  }

  /** Small non-cryptographic hash (FNV-1a) used for de-duplication keys. */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  let idCounter = 0;
  function uid(prefix) {
    idCounter = (idCounter + 1) % 1e6;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** RFC-4180-ish CSV parser (handles quotes, embedded commas/newlines). */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => String(f).trim() !== ''));
  }

  const US_STATES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR').split(' '));

  Object.assign(FS, {
    MONTHS, pad, iso, fullYear, monthIndex, parseDate, parseAmount, round2, fmtMoney,
    addDays, daysBetween, hash, uid, escapeRegex, escapeHtml, parseCSV, US_STATES,
  });
})(typeof window !== 'undefined' ? window : globalThis);
