const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Malta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
export function maltaWall(value = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Reject spring's missing hour and autumn's ambiguous hour explicitly rather
// than silently interpreting the computer's timezone or choosing the wrong fold.
export function maltaInstant(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value || '')) throw new Error('Agħżel data u ħin validi.');
  const naive = Date.parse(value + 'Z');
  const matches = [1, 2].map((h) => new Date(naive - h * 3600000)).filter((d) => maltaWall(d) === value);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? 'Dan il-ħin jirrepeti fil-bidla tas-siegħa. Agħżel ħin ieħor.'
        : 'Dan il-ħin ma jeżistix fil-bidla tas-siegħa. Agħżel ħin ieħor.',
    );
  return matches[0].toISOString();
}

export function schedulePreset(kind, now = new Date()) {
  if (kind === 'hour') return maltaWall(new Date(now.getTime() + 3600000));
  const wall = maltaWall(now),
    d = new Date(wall + 'Z');
  if (kind === 'am' || kind === 'pm') d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(kind === 'am' ? 9 : kind === 'pm' ? 18 : 20, kind === 'pm' ? 30 : 0, 0, 0);
  let result = d.toISOString().slice(0, 16);
  if (kind === 'tonight' && result <= wall) {
    d.setUTCDate(d.getUTCDate() + 1);
    result = d.toISOString().slice(0, 16);
  }
  return result;
}
