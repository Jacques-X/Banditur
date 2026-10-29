import { maltaWall, maltaInstant } from './malta-time.js';
// Dates and numbers, the Maltese way. Absolute timestamps are displayed
// in Europe/Malta regardless of the computer's timezone.

export const DAYS = ['Ħad', 'Tne', 'Tli', 'Erb', 'Ħam', 'Ġim', 'Sib'];
export const DAYS_LONG = ['Il-Ħadd', 'It-Tnejn', 'It-Tlieta', 'L-Erbgħa', 'Il-Ħamis', 'Il-Ġimgħa', 'Is-Sibt'];
export const MONTHS = [
  'Jannar',
  'Frar',
  'Marzu',
  'April',
  'Mejju',
  'Ġunju',
  'Lulju',
  'Awwissu',
  'Settembru',
  'Ottubru',
  'Novembru',
  'Diċembru',
];
export const MONTHS_SHORT = [
  'Jan',
  'Fra',
  'Mar',
  'Apr',
  'Mej',
  'Ġun',
  'Lul',
  'Aww',
  'Set',
  'Ott',
  'Nov',
  'Diċ',
];

export const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => maltaWall(d).slice(11, 16);

/** <input type="datetime-local"> value */
export const toLocalInput = (d) => maltaWall(d);
/** <input type="date"> value */
export const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function addHours(d, n) {
  const x = new Date(d);
  x.setHours(x.getHours() + n);
  return x;
}

/** "Illum 18:30", "Għada 09:00", "Sib 24 · 12:00" */
export function whenLabel(date, { upper = false } = {}) {
  let raw;
  try {
    raw =
      date instanceof Date
        ? date
        : new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(date) ? maltaInstant(date) : date);
  } catch {
    return '';
  }
  if (Number.isNaN(raw.getTime())) return '';
  const d = new Date(maltaWall(raw));
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date(maltaWall());
  let day;
  if (sameDay(d, now)) day = 'Illum';
  else if (sameDay(d, addDays(now, 1))) day = 'Għada';
  else if (sameDay(d, addDays(now, -1))) day = 'Il-bieraħ';
  else
    day = `${DAYS[d.getDay()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? ` ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : ''}`;
  const s = `${day} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return upper ? s.toUpperCase() : s;
}

/** "Ħam 22 Ott · 20:00" */
export function shortDateTime(date) {
  let raw;
  try {
    raw =
      date instanceof Date
        ? date
        : new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(date) ? maltaInstant(date) : date);
  } catch {
    return '';
  }
  if (Number.isNaN(raw.getTime())) return '';
  const d = new Date(maltaWall(raw));
  if (Number.isNaN(d.getTime())) return '';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "22 ta' Ottubru 2026" */
export function longDate(date) {
  let raw;
  try {
    raw =
      date instanceof Date
        ? date
        : new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(date) ? maltaInstant(date) : date);
  } catch {
    return '';
  }
  if (Number.isNaN(raw.getTime())) return '';
  const d = new Date(maltaWall(raw));
  return `${d.getDate()} ta' ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "5 min ilu", "2 sigħat ilu" … */
export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'issa stess';
  if (m < 60) return `${m} min ilu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'siegħa' : 'sigħat'} ilu`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? 'jum' : 'ijiem'} ilu`;
}

export const num = (n) =>
  n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US');
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
