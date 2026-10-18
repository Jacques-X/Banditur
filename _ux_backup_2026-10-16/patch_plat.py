import re
miss=[]
p='src/main.js'
s=open(p,encoding='utf8').read()
def rep(a,b,count=1):
    global s
    n=s.count(a)
    if n!=count: miss.append((n,count,a[:80]))
    s=s.replace(a,b)
def rx(pat,b,count=1):
    global s
    s,n=re.subn(pat,lambda m:b,s,count=count,flags=re.S)
    if n!=count: miss.append((n,count,'RX '+pat[:70]))

rep("import { saveMedia,","import { PLATFORMS, platformById, visiblePlatforms, defaultPlatformIds, platformIdFields, captionLimitFor, platformProblem } from './platforms.js';\nimport { saveMedia,")

# ---- buttons rendered from the registry + toggle behaviour
rx(r"document\.querySelectorAll\('\.platform\[data-platform\]'\)\.forEach\(btn => \{\n  btn\.addEventListener\('click', \(\) => \{.*?\n  \}\);\n\}\);\n\nfunction getSelectedPlatforms\(\) \{\n  return \[\.\.\.document\.querySelectorAll\('\.platform\[data-on=\"true\"\]'\)\]\.map\(b => b\.dataset\.platform\);\n\}",
r'''(function renderPlatformButtons() {
  const box = document.getElementById('platform-badges');
  if (!box) return;
  box.innerHTML = visiblePlatforms().map(p => {
    const on = p.available && p.defaultOn;
    return `<button type="button" class="platform${p.available ? '' : ' platform-soon'}" data-platform="${p.id}" data-on="${on}" aria-pressed="${on}"${p.available ? '' : ' disabled aria-disabled="true"'}>
      <span class="platform-dot" aria-hidden="true"></span>
      ${p.icon}
      ${escHtml(p.label)}${p.available ? '' : '<span class="platform-soon-tag">Dalwaqt</span>'}
    </button>`;
  }).join('');
})();

document.querySelectorAll('.platform[data-platform]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!platformById(btn.dataset.platform)?.available) return;
    const isOn = btn.dataset.on === 'true';
    btn.dataset.on = isOn ? 'false' : 'true';
    btn.setAttribute('aria-pressed', isOn ? 'false' : 'true');
    onPlatformsChanged();
    scheduleAutosave();
  });
});

function getSelectedPlatforms() {
  return [...document.querySelectorAll('.platform[data-on="true"]')].map(b => b.dataset.platform);
}

// Turn exactly these platforms on (unavailable ones are ignored, so an old draft can't select them).
function setSelectedPlatforms(ids) {
  document.querySelectorAll('.platform[data-platform]').forEach(b => {
    const on = !!platformById(b.dataset.platform)?.available && ids.includes(b.dataset.platform);
    b.dataset.on = on ? 'true' : 'false';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  onPlatformsChanged();
}

function currentCaptionLimit() { return captionLimitFor(getSelectedPlatforms()); }

// Show the inputs the chosen platforms need, update the caption limit and the preview.
function onPlatformsChanged() {
  const ids = getSelectedPlatforms();
  const needsExpiry = ids.some(id => platformById(id)?.fields?.includes('expiry'));
  const eg = document.getElementById('expiry-group');
  if (eg) eg.style.display = needsExpiry ? '' : 'none';
  const lim = document.getElementById('caption-limit');
  if (lim) lim.textContent = currentCaptionLimit().toLocaleString('en-US');
  updateCaptionCount();
  updateInlinePreview();
}''')

# ---- caption counter uses the live limit
rep("  captionCountEl.classList.toggle('caption-count-danger', len > 2000);\n  captionCountEl.classList.toggle('caption-count-warn',   len > 1800 && len <= 2000);",
    "  const limit = currentCaptionLimit();\n  captionCountEl.classList.toggle('caption-count-danger', len > limit - 200);\n  captionCountEl.classList.toggle('caption-count-warn',   len > limit - 400 && len <= limit - 200);")

# ---- autosave restore
rx(r"    if \(saved\.platforms\?\.length\) \{\n      document\.querySelectorAll\('\.platform\[data-platform\]'\)\.forEach\(b => \{.*?\n      const eg = document\.getElementById\('expiry-group'\);\n      if \(eg\) eg\.style\.display = saved\.platforms\.includes\('wp'\) \? '' : 'none';\n    \}",
    "    if (saved.platforms?.length) setSelectedPlatforms(saved.platforms);")

# ---- applyFormState
rx(r"  document\.querySelectorAll\('\.platform\[data-platform\]'\)\.forEach\(badge => \{\n    const on = \(d\.platforms \|\| \[\]\)\.includes\(badge\.dataset\.platform\);.*?\n  const eg = document\.getElementById\('expiry-group'\);\n  if \(eg\) eg\.style\.display = \(d\.platforms \|\| \[\]\)\.includes\('wp'\) \? '' : 'none';\n",
    "  setSelectedPlatforms(d.platforms || []);\n")

# ---- reset form
rx(r"  document\.querySelectorAll\('\.platform\[data-platform\]'\)\.forEach\(b => \{\n    const on = \(b\.dataset\.platform === 'fb' \|\| b\.dataset\.platform === 'ig'\);.*?\n  \}\);\n",
    "  setSelectedPlatforms(defaultPlatformIds());\n")

# ---- after successful schedule
rx(r"    // Restore default platform selection \(FB \+ IG on\) rather than clearing everything\n    document\.querySelectorAll\('\.platform\[data-platform\]'\)\.forEach\(b => \{.*?\n    \}\);\n",
    "    // Restore the default platform selection rather than clearing everything\n    setSelectedPlatforms(defaultPlatformIds());\n")

# ---- init
rep("  // Hide WP expiry group on load (WP badge starts off)\n  const egEl = document.getElementById('expiry-group');\n  if (egEl) egEl.style.display = 'none';\n","  onPlatformsChanged();\n")

# ---- registry-driven labels / preview cut / id fields / pills
rep("const PLAT_LABELS = { fb: 'Facebook', ig: 'Instagram', wp: 'WordPress' };","const PLAT_LABELS = Object.fromEntries(PLATFORMS.map(p => [p.id, p.label]));")
rep("  const IG_CUT = 125;\n","")
rep("    const cut = plat === 'ig' && caption.length > IG_CUT;","    const IG_CUT = platformById(plat)?.previewCut;\n    const cut = !!IG_CUT && caption.length > IG_CUT;")
rep("`<p class=\"preview-note\">Fuq Instagram jidhru biss l-ewwel ${IG_CUT} karattru qabel \"aktar\".</p>`","`<p class=\"preview-note\">Fuq ${escHtml(PLAT_LABELS[plat] || plat)} jidhru biss l-ewwel ${IG_CUT} karattru qabel \"aktar\".</p>`")
rep("const PLATFORM_ID_FIELD = { fb: 'fb_post_id', ig: 'ig_post_id', wp: 'wp_post_id' };","const PLATFORM_ID_FIELD = platformIdFields();")
rep("const label = `${pl.toUpperCase()}${done && post.status === 'failed' ? ' done' : ''}`;","const label = `${platformById(pl)?.short || pl.toUpperCase()}${done && post.status === 'failed' ? ' ✓' : ''}`;")
rep("const platLabel = p.platform === 'ig' ? 'Instagram' : 'Facebook';","const platLabel = platformById(p.platform)?.label || 'Facebook';")

# ---- scheduling: expiry field + per-platform checks + live caption limit
rep("    if (platforms.includes('wp')) {\n      const exp","    if (platforms.some(id => platformById(id)?.fields?.includes('expiry'))) {\n      const exp")
rep("  if (caption.length > 2200) { showScheduleStatus(ERR.caption_too_long, 'error'); return; }",
    "  const capLimit = currentCaptionLimit();\n  if (caption.length > capLimit) { showScheduleStatus(ERR.caption_too_long(capLimit), 'error'); return; }")
rep("  if (!platforms.length) { showScheduleStatus(ERR.no_platform, 'error'); return; }\n",
    "  if (!platforms.length) { showScheduleStatus(ERR.no_platform, 'error'); return; }\n  const platIssue = platformProblem(platforms, contentType, pickedMedia);\n  if (platIssue) { showScheduleStatus(platIssue, 'error'); return; }\n")
# content-type switch / media change can break a platform rule: surface it early
rep("function checkMediaFitsType() {\n  const why = pickedMedia.length ? mediaFitProblem() : '';",
    "function checkMediaFitsType() {\n  const why = (pickedMedia.length ? mediaFitProblem() : '') || platformProblem(getSelectedPlatforms(), contentType, pickedMedia);")
rep("else if (/(Reel|Storja|Post) (jeħtieġ|tiħu|jiħu)/.test(","else if (/(Reel|Storja|Post|jippubblikax|jaċċetta) ?(jeħtieġ|tiħu|jiħu)?/.test(") if False else None

open(p,'w',encoding='utf8').write(s)

# ---- strings: limit message takes the limit
q='src/strings.js'
t=open(q,encoding='utf8').read()
a="caption_too_long: 'Il-kaption taqbeż il-limitu ta\\' 2,200 karattru.',"
if a in t: t=t.replace(a,"caption_too_long: n => `Il-kaption taqbeż il-limitu ta' ${Number(n).toLocaleString('en-US')} karattru.`,")
else: miss.append((0,1,'strings caption_too_long'))
open(q,'w',encoding='utf8').write(t)

# ---- styles
c='src/styles.css'
u=open(c,encoding='utf8').read()
u+='''

/* Platforms that are planned but not available yet */
.platform.platform-soon, .platform:disabled { opacity: 0.6; cursor: not-allowed; }
.platform-soon-tag { margin-left: 6px; padding: 1px 6px; border: 1px solid var(--border-s); border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.platform-hint { display: block; margin: 8px 0 0; }
'''
open(c,'w',encoding='utf8').write(u)

for x in miss: print('MISS',x)
print('misses',len(miss))
