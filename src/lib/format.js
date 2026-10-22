// Dates and numbers, the Maltese way. Times are the computer's local time
// (Malta) — the backend works in UTC ISO strings.

export const DAYS = ['Ħad', 'Tne', 'Tli', 'Erb', 'Ħam', 'Ġim', 'Sib'];
export const DAYS_LONG = ['Il-Ħadd', 'It-Tnejn', 'It-Tlieta', 'L-Erbgħa', 'Il-Ħamis', 'Il-Ġimgħa', 'Is-Sibt'];
export const MONTHS = ['Jannar', 'Frar', 'Marzu', 'April', 'Mejju', 'Ġunju', 'Lulju', 'Awwissu', 'Settembru', 'Ottubru', 'Novembru', 'Diċembru'];
export const MONTHS_SHORT = ['Jan', 'Fra', 'Mar', 'Apr', 'Mej', 'Ġun', 'Lul', 'Aww', 'Set', 'Ott', 'Nov', 'Diċ'];

export const pad = n => String(n).padStart(2, '0');
export const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** <input type="datetime-local"> value */
export const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm(d)}`;
/** <input type="date"> value */
export const toDateInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function addHours(d, n) { const x = new Date(d); x.setHours(x.getHours() + n); return x; }

/** "Illum 18:30", "Għada 09:00", "Sib 24 · 12:00" */
export function whenLabel(date, { upper = false } = {}) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  let day;
  if (sameDay(d, now)) day = 'Illum';
  else if (sameDay(d, addDays(now, 1))) day = 'Għada';
  else if (sameDay(d, addDays(now, -1))) day = 'Il-bieraħ';
  else day = `${DAYS[d.getDay()]} ${d.getDate()}${d.getFullYear() !== now.getFullYear() ? ` ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` : ''}`;
  const s = `${day} · ${hhmm(d)}`;
  return upper ? s.toUpperCase() : s;
}

/** "Ħam 22 Ott · 20:00" */
export function shortDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${hhmm(d)}`;
}

/** "22 ta' Ottubru 2026" */
export function longDate(date) {
  const d = date instanceof Date ? date : new Date(date);
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

export const num = n => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
