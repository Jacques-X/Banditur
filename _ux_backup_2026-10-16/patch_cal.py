import re
miss=[]
def F(p): return [p, open(p,encoding='utf8').read()]
def rep(f,a,b,count=1):
    n=f[1].count(a)
    if n!=count: miss.append((f[0],n,a[:70]))
    f[1]=f[1].replace(a,b)
def done(f): open(f[0],'w',encoding='utf8').write(f[1])

# ---- backend: optional date window on /api/history (older clients ignore it)
b=F('backend/api/history.js')
rep(b,"  const profileId = (req.query.profile_id || '').trim();\n","  const profileId = (req.query.profile_id || '').trim();\n  const from = (req.query.from || '').trim();\n  const to   = (req.query.to   || '').trim();\n")
rep(b,"  if (search)           query = query.ilike('caption', `%${search}%`);\n","  if (search)           query = query.ilike('caption', `%${search}%`);\n  if (from && !Number.isNaN(Date.parse(from))) query = query.gte('scheduled_time', from);\n  if (to   && !Number.isNaN(Date.parse(to)))   query = query.lt('scheduled_time', to);\n")
done(b)

# ---- markup
h=F('index.html')
rep(h,'''              <section class="calendar-side-section calendar-inspector-section">''','''              <section class="calendar-side-section calendar-posts-section" aria-labelledby="calendar-posts-title">
                <div class="calendar-section-hdr">
                  <div>
                    <div class="panel-kicker">Għal qari biss</div>
                    <h2 class="panel-title" id="calendar-posts-title">Posts skedati</h2>
                  </div>
                  <button class="btn-secondary btn-sm" id="calendar-posts-open" type="button">Arkivju</button>
                </div>
                <div id="calendar-day-posts-list" class="calendar-day-posts-list" aria-live="polite"></div>
              </section>
              <section class="calendar-side-section calendar-inspector-section">''')
done(h)

# ---- logic
m=F('src/main.js')
rep(m,"function renderSelectedDayAgenda() {\n  const title = document.getElementById('calendar-agenda-title');\n  const list = document.getElementById('calendar-day-agenda-list');\n  if (!title || !list) return;\n\n  const selected = _calendarState.selectedDate || new Date();\n  title.textContent = fmtCalendarDay(selected);\n",
r'''// ── Scheduled posts for the selected day (read-only; posts are never edited from here) ──
const _dayPostsCache = new Map();   // "profile|yyyy-mm-dd" -> posts[]
let _dayPostsToken = 0;

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function renderDayPosts(posts, day) {
  const box = document.getElementById('calendar-day-posts-list');
  if (!box) return;
  if (!posts.length) {
    box.innerHTML = `<div class="calendar-agenda-empty">M'hemm l-ebda post skedat f'dan il-jum.</div>`;
    return;
  }
  box.innerHTML = posts.map(p => {
    const t = new Date(p.scheduled_time);
    const status = queueStatusLabel(p);
    const caption = (p.caption || '').trim().split('\n')[0] || '(mingħajr kaption)';
    const type = p.content_type && p.content_type !== 'post' ? `<span class="plat-pill plat-pill-type">${escHtml(p.content_type)}</span>` : '';
    return `
      <div class="calendar-post-item">
        <span class="calendar-post-time tnum">${escHtml(fmtCalendarTime(t))}</span>
        <span class="calendar-post-main">
          <span class="calendar-post-caption">${escHtml(caption.slice(0, 70))}${caption.length > 70 ? '…' : ''}</span>
          <span class="calendar-post-meta">${renderPlatformPills(p)}${type}<span class="status-pill ${status.className}">${escHtml(status.label)}</span></span>
        </span>
      </div>`;
  }).join('');
}

async function loadDayPosts() {
  const box = document.getElementById('calendar-day-posts-list');
  if (!box) return;
  const cfg = loadConfig();
  if (!cfg.vercelUrl || !cfg.apiKey) {
    box.innerHTML = `<div class="calendar-agenda-empty">Issettja s-Settings biex tara l-posts skedati.</div>`;
    withSettingsButton(box);
    return;
  }
  const day = new Date(_calendarState.selectedDate || new Date());
  day.setHours(0, 0, 0, 0);
  const next = new Date(day); next.setDate(next.getDate() + 1);
  const key = `${selectedProfileId()}|${dateKey(day)}`;
  if (_dayPostsCache.has(key)) { renderDayPosts(_dayPostsCache.get(key), day); }
  else { box.innerHTML = `<div class="calendar-agenda-empty">Qed jgħabbi…</div>`; }

  const token = ++_dayPostsToken;
  try {
    const params = new URLSearchParams({
      limit: 100, status: 'all', profile_id: selectedProfileId(),
      from: day.toISOString(), to: next.toISOString(),
    });
    const res = await fetch(`${cfg.vercelUrl}/api/history?${params}`, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const { posts } = await res.json();
    // The server may predate the from/to filter, so keep only this day's posts here too.
    const mine = (posts || [])
      .filter(p => p.scheduled_time && sameLocalDay(new Date(p.scheduled_time), day))
      .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));
    _dayPostsCache.set(key, mine);
    if (token === _dayPostsToken) renderDayPosts(mine, day);
  } catch (err) {
    if (token === _dayPostsToken) box.innerHTML = renderState({ tone: 'error', title: 'Ma stajniex naqraw il-posts skedati.', body: EMPTY.error(err.message) });
  }
}

let _dayPostsKey = '';
function refreshDayPostsIfNeeded(force = false) {
  const day = _calendarState.selectedDate || new Date();
  const key = `${selectedProfileId()}|${dateKey(day)}`;
  if (!force && key === _dayPostsKey) return;
  _dayPostsKey = key;
  if (force) _dayPostsCache.delete(key);
  loadDayPosts();
}

document.getElementById('calendar-posts-open')?.addEventListener('click', () => {
  showView('arkivju');
  document.querySelector('.archive-source-tab[data-archive-source="queue"]')?.click();
});
document.getElementById('refresh-events-btn')?.addEventListener('click', () => refreshDayPostsIfNeeded(true));
document.addEventListener('change', e => {
  if (e.target.closest('[data-profile-select]') && activeView === 'calendar') refreshDayPostsIfNeeded();
});

function renderSelectedDayAgenda() {
  const title = document.getElementById('calendar-agenda-title');
  const list = document.getElementById('calendar-day-agenda-list');
  if (!title || !list) return;

  const selected = _calendarState.selectedDate || new Date();
  title.textContent = fmtCalendarDay(selected);
  refreshDayPostsIfNeeded();
''')
# after a post is scheduled/deleted the cache must not go stale
rep(m,"    _lastScheduled = { form: collectScheduleForm(), files: [...pickedMedia] };","    _dayPostsCache.clear(); _dayPostsKey = '';\n    _lastScheduled = { form: collectScheduleForm(), files: [...pickedMedia] };")
done(m)

# ---- styles
c=F('src/styles.css')
c[1]+='''

/* Calendar: read-only list of scheduled posts for the selected day */
.calendar-day-posts-list { display: flex; flex-direction: column; gap: 6px; }
.calendar-post-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px dashed var(--border-s); border-radius: 8px; background: var(--surface); cursor: default; }
.calendar-post-time { flex: 0 0 auto; min-width: 44px; font-size: 13px; font-weight: 700; color: var(--ink); }
.calendar-post-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.calendar-post-caption { font-size: 13px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
.calendar-post-meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
'''
done(c)

for x in miss: print('MISS',x)
print('misses',len(miss))
