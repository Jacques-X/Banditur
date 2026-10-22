// ─────────────────────────────────────────────────────────────────────────────
// strings.js — all user-visible text in one place
// Edit this file to change any label, message, or template shown in the app.
// ─────────────────────────────────────────────────────────────────────────────

// ── Status pill labels (archive / history table) ──────────────────────────────
// Turns raw technical errors (HTTP codes, "Failed to fetch"...) into a plain
// Maltese sentence, keeping the original text in brackets for support.
export function friendlyError(raw) {
  const m = String(raw ?? '').trim();
  if (!m) return 'Xi ħaġa marret ħażin. Erġa\' pprova.';
  const low = m.toLowerCase();
  let nice = '';
  if (/failed to fetch|networkerror|load failed|network request failed/.test(low)) nice = 'Ma stajniex nikkonnettjaw mas-server. Iċċekkja l-internet u erġa\' pprova.';
  else if (/\b401\b|unauthori[sz]ed|invalid api key/.test(low)) nice = 'L-API Key mhix tajba jew skadiet. Iċċekkjaha fis-Settings.';
  else if (/\b403\b|forbidden/.test(low)) nice = 'M\'għandekx permess għal din l-azzjoni.';
  else if (/\b404\b/.test(low)) nice = 'Is-server ma sab dak li qed tfittex. Iċċekkja l-Backend URL fis-Settings.';
  else if (/\b413\b|too large|payload/.test(low)) nice = 'Il-file huwa kbir wisq.';
  else if (/\b429\b|rate limit/.test(low)) nice = 'Wisq talbiet f\'daqqa. Stenna ftit u erġa\' pprova.';
  else if (/\b5\d\d\b|internal server|bad gateway|timeout|timed out/.test(low)) nice = 'Is-server għandu problema jew dam wisq. Erġa\' pprova aktar tard.';
  return nice ? `${nice} (${m.split('\n')[0].slice(0, 140)})` : m;
}

export const STATUS_LABELS = {
  pending:    'Pending',
  processing: 'Qed Jipproċessa',
  fb_native:  'Scheduled on Meta',
  published:  'Published',
  failed:     'Failed',
};

// ── Validation errors ─────────────────────────────────────────────────────────
export const ERR = {
  no_input_dir:    'Agħżel il-folder tar-ritratti.',
  no_photographer: 'L-isem tal-fotoġrafista huwa meħtieġ.',
  no_arw_dir:      'Agħżel il-folder bir-RAW files.',
  video_format:    'Huma supportati biss files .mp4, .mov, .mp3 u .wav.',
  no_caption:      'Il-caption hija meħtieġa.',
  caption_too_long: n => `Il-caption taqbeż il-limitu ta' ${Number(n).toLocaleString('en-US')} karattru.`,
  broken_media:    n => n === 1
    ? 'Waħda mill-media mtella\' ma tidhirx aċċessibbli. Neħħiha u erġa\' żidha, jew ipprova għal darb\'oħra.'
    : `${n} mill-media mtella' ma jidhrux aċċessibbli. Neħħihom u erġa' żidhom, jew ipprova għal darb'oħra.`,
  no_platform:     'Agħżel tal-inqas platform wieħed.',
  no_time:         'Il-ħin tal-pubblikazzjoni huwa meħtieġ.',
  supabase_config: 'Supabase mhux ikkonfiggurat — issettja fis-Settings.',
  vercel_config:   'Issettja l-Vercel URL u l-API Key fis-Settings ⚙',
  settings_first:  'Issettja s-Settings l-ewwel.',
  pick_period:     'Agħżel il-perijodu.',
  bad_range:       'Id-data "Mill" trid tkun qabel jew ugwali għad-data "Sa".',
  no_report_yet:   'L-ewwel iġġenera rapport.',
  fatal:      e => `Żball fatali: ${friendlyError(e)}`,
  generic:  msg => `Żball: ${friendlyError(msg)}`,
};

// ── Tool panel: buttons and status messages ───────────────────────────────────
export const TOOLS = {
  run_watermark:  'Ipproċessa r-Ritratti',
  run_arw:        'Ikkonverti ARW → JPG',
  running_wm:     'Qed Jipproċessa…',
  running_arw:    'Qed Jikkonverti…',
  ready:          'Lest',
  starting:       'Qed jibda…',
  error_log:      'Żball — ara l-log.',
  progress:  pct => `Qed jipproċessa… ${pct}%`,
  done_wm:   (processed, failed, duplicates = 0) =>
    `Lest — ${processed} ipproċessati${failed ? `, ${failed} imqabbla` : ''}${duplicates ? `, ${duplicates} duplikati mqabbżin` : ''}`,
  done_arw:  (converted, skipped) =>
    `Lest — ${converted} ikkonvertiti${skipped ? `, ${skipped} preteriti` : ''}`,
};

// ── Transcription panel ───────────────────────────────────────────────────────
export const TX = {
  idle:          'Lest. Waqqa\' video jew audio, jew ikklikkja biex tibda.',
  starting:      'Qed jibda…',
  transcribing:   pct => `Qed jittraskrivi… ${Math.round(pct)}%`,
  error:         msg => `Żball: ${msg}`,
  saved:         '✓ Issejvjat!',
  save_btn:      'Save SRT',
  save_error:    'Żball!',
  ts_hint:       'Ikklikkja biex tisma\'',
};

// ── Schedule / post composer ──────────────────────────────────────────────────
export const SCHED = {
  uploading:      'Qed jittella\' l-media…',
  checking_media: 'Qed nivverifikaw il-media…',
  scheduling:     'Qed jiskeda…',
  scheduled:      'Post iskedat! ✓',
  draft_saved:    'Draft issejvjat.',
  downloading:    'Qed jniżżel minn Drive…',
};

// ── Toast notifications ───────────────────────────────────────────────────────
export const TOAST = {
  scheduled:     'Post iskedat!',
  retried:       'Post imressaq mill-ġdid.',
  offline:       'M\'intix konness. Il-post ġie ssejvjat bħala draft, bil-media wkoll. Skedah meta terġa\' tkun online.',
  settings_saved: 'Settings issejvja.',
  error: msg => `Żball: ${friendlyError(msg)}`,
  drive_err: msg => `Żball minn Drive: ${friendlyError(msg)}`,
};

// ── Empty states / loading placeholders ──────────────────────────────────────
export const EMPTY = {
  loading:      'Qed jgħabbi…',
  no_posts:     'L-ebda post skedat.',
  no_drafts:    'L-ebda draft.',
  no_events:    'L-ebda avveniment.',
  no_drive:     'Folder vojt.',
  settings_req: 'Issettja s-Settings l-ewwel.',
  error:   msg => `Żball: ${friendlyError(msg)}`,
};

// ── Confirmation dialogs ──────────────────────────────────────────────────────
export const CONFIRM = {
  delete_post: 'Trid tħassar dan il-post?',
  reset_form:  'Trid tibda mill-ġdid? Il-caption, il-media u d-dati jitnaddfu mill-formola (id-drafts ssejvjati ma jintmessux).',
  past_time:   'Il-ħin magħżul diġà għadda. Il-post jiġi ppubblikat mal-ewwel run li jmiss. Tkompli?',
  quit_busy:   'Għad hawn xogħol għaddej (proċessar, traskrizzjoni, export jew download). Jekk tagħlaq issa, jintilef.',
  delete_event:'Trid tħassar dan l-avveniment?',
};

// ── Buttons / action labels ───────────────────────────────────────────────────
export const BTN = {
  retry:         'Erġa\' Pprova',
  retrying:      '…',
  delete:        'Ħassar',
  report_gen:    'Iġġenera r-Rapport (PDF)',
  report_busy:   'Qed jgħabbi…',
  tmpl_manage:   '⚙ Ħares it-Templates…',
  tmpl_section:  'Templates',
  tmpl_yours:    'Tiegħek',
  tmpl_del:      'Ħassar',
  media_rm:      'Neħħi',
  tmpl_new: n => `Template ${n}`,
};

// ── Watermark packs (Marka & Ssortja) ────────────────────────────────────────
export const WM = {
  none_installed:  'L-ebda watermark installat — importa pack minn "Manage watermarks".',
  status: (packs, marks) => packs ? `Packs: ${packs} · Watermarks: ${marks}` : 'L-ebda pack installat.',
  empty_list:      'L-ebda pack installat għadu. Importa file .bwpack jew żid watermark ġdid.',
  meta:  (v, n) => `Version ${v} · Watermarks: ${n}`,
  show_list:       'Uri l-watermarks',
  portrait:        'portrett',
  landscape:       'pajsaġġ',
  export:          'Export',
  delete:          'Ħassar',
  remove:          'Neħħi',
  new_pack_opt:    '＋ Pack ġdid…',
  none_file:       'Xejn',
  file_filter:     'Watermark pack',
  confirm_install:   (name, v, n) => `Tinstalla l-pack "${name}" (version ${v}, watermarks: ${n})?`,
  confirm_update:    (name, from, to) => `Il-pack "${name}" diġà installat (version ${from}). Taġġornah għal version ${to}?`,
  confirm_downgrade: (name, v, installed) => `Il-pack "${name}" diġà installat b'version ${installed}, u dan il-file huwa version ${v}. Tissostitwih xorta waħda?`,
  confirm_delete:    (name, n) => `Tħassar il-pack "${name}" (watermarks: ${n}) minn dan il-kompjuter?`,
  confirm_remove:    (wm, pack) => `Tneħħi "${wm}" mill-pack "${pack}"?`,
  imported: name => `Il-pack "${name}" ġie installat.`,
  exported: name => `Il-pack "${name}" ġie esportat.`,
  deleted:  name => `Il-pack "${name}" tħassar.`,
  removed:  wm   => `"${wm}" tneħħiet.`,
  added:    wm   => `"${wm}" ġiet miżjuda.`,
  need_name:       'Daħħal l-isem tal-fotografu/a.',
  need_pack_name:  'Daħħal isem għall-pack il-ġdid.',
  need_file:       'Agħżel tal-inqas PNG waħda.',
  load_failed:     'Ma stajtx niġbed il-lista tal-watermarks.',
  error: e => `Żball: ${e}`,
};

// ── Settings / About modal ────────────────────────────────────────────────────
export const ABOUT = {
  backend:         url => `→ ${url}`,
  backend_missing: 'Backend mhux ikkonfiggurat',
};

// ── Print report ──────────────────────────────────────────────────────────────
export const REPORT = {
  org:          'Soċjeta Mużikali Santa Katarina',
  dept:         'Kumitat tal-Pubbliċità u r-Relazzjonijiet Pubbliċi',
  title:        'Rapport tal-Attività tal-PR',
  period:       (from, to) => `Perijodu: ${from} – ${to}`,
  footer:            dt  => `Rapport iġġenerat ${dt} minn Banditur`,

  sec_posts:    'Numru ta\' Posts',
  sec_engage:   'Likes u Comments',
  sec_reach:    'Reach u Followers',
  sec_top:      n  => `L-aqwa Posts (${n})`,
  sec_list:      n  => `Lista ta' Posts (${n})`,

  total_pub:    'Total Published',
  total_pend:   'Pending',
  total_fail:   'Failed',
  total_likes:  'Total Likes',
  total_comm:   'Total Comments',
  fb_followers: 'Facebook Followers',
  ig_followers: 'Instagram Followers',
  fb_impr:      'FB Page Impressions',
  fb_foll_chg:  'Bidla fin-Numru ta\' Followers (FB)',

  sec_trends:    'Xejriet vs Perijodu Preċedenti',
  trend_period:  (from, to) => `Meta mqabbla ma': ${from} – ${to}`,
  trend_new:     'ġdid',
  trend_avg:     'Medja ta\' Engagement kull Post',
  trend_perweek: 'Posts fil-Ġimgħa',
  trend_plat:    p => `→ Posts – ${p}`,
};

// Report panel presets, custom-compare toggle, and CSV export button are
// static labels in index.html's markup (like the other rpt-* check-item
// labels there) rather than templated from here — REPORT above covers only
// the dynamically-generated print report / CSV content in main.js.

// ── Built-in post templates ───────────────────────────────────────────────────
// Shown in the template dropdown and injected into the caption textarea.
export const BUILTIN_TEMPLATES = [
  {
    name: 'Kondoljanzi',
    body:
      'Il-President u l-Kumitat tas-Soċjeta Mużikali Santa Katarina jixtiequ jwasslu ' +
      'l-kondoljanzi tagħhom lill-familja tal-mejjet/a [ISEM]. Nixtiequ li l-Mulej jagħti ' +
      's-saħħa lill-qraba waqt din it-telfa kbira.\n\nStrieħ fis-sliem.',
  },
  {
    name: 'Festa',
    body:
      '🎉 Festa ta\' [SANT]\n\n' +
      'Is-Soċjeta Mużikali Santa Katarina għandha l-pjaċir tħabbar il-programm tal-Festa ta\' [SANT].\n\n' +
      '📅 [DATA]\n📍 [POST]\n\nEjjew flimkien niċċelebraw din l-okkażjoni speċjali!',
  },
  {
    name: 'Kunċert',
    body:
      '🎶 Kunċert Mużikali\n\n' +
      'Is-Soċjeta Mużikali Santa Katarina tistieden lill-pubbliku għal Kunċert Mużikali.\n\n' +
      '📅 [DATA]\n🕗 [ĦIN]\n📍 [POST]\n\nDħul: [PREZZ / Bla Ħlas]',
  },
  {
    name: 'Tombla',
    body:
      '🎰 Tombla!\n\n' +
      'Is-Soċjeta Mużikali Santa Katarina qed torganizza Tombla b\'premjijiet attraenti!\n\n' +
      '📅 [DATA]\n🕗 [ĦIN]\n📍 [POST]',
  },
  {
    name: 'Laqgħa Ġenerali',
    body:
      'Is-Soċjeta Mużikali Santa Katarina tavża lill-Membri tagħha li ser tinżamm ' +
      'Laqgħa Ġenerali [ORDINARJA / STRAORDINARJA].\n\n' +
      '📅 Data: [DATA]\n🕗 Ħin: [ĦIN]\n📍 Post: [POST]\n\n' +
      'Il-preżenza tal-Membri hija meħtieġa.',
  },
  {
    name: 'Avviż Ġenerali',
    body:
      'Is-Soċjeta Mużikali Santa Katarina tħabbar lill-Membri u s-simpatizzanti tagħha li [DETTALJI].\n\n' +
      'Għal aktar informazzjoni, kuntattjana fuq [KUNTATT].',
  },
];

// ── YouTube downloader ───────────────────────────────────────────────────────
export const YT = {
  choose_output: 'Agħżel fejn issejvja',
  download_format: format => `Niżżel ${format}`,
  downloading:   format => `Qed iniżżel ${format}…`,
  converting:    format => format === 'MP3' ? 'Qed jikkonverti għal MP3…' : 'Qed jipprepara l-MP4…',
  done:  title => `Lest — ${title}`,
  open_file:     'Iftaħ il-file ↗',
  error:  msg  => `Żball: ${friendlyError(msg)}`,
  no_url:        'Daħħal URL ta\' YouTube.',
};

// BUG-17: MOCK_HISTORY (dead demo-mode data, unused anywhere in main.js) was
// removed here — leftover from an earlier no-backend demo mode.

// ── Subtitle editor (Traskrittura) ────────────────────────────────────────────
export const SUB = {
  // resume / recent
  resume_title:    name => `Għandek bidliet issejvjati għal ${name}`,
  resume_meta:     (when, n) => `Editjat ${when} · ${n} ${n === 1 ? 'subtitle' : 'subtitles'}`,
  resume_yes:      'Kompli',
  resume_no:       'Traskrivi mill-ġdid',
  recent:          'Riċenti',
  recent_delete:   name => `Ħassar il-bidliet issejvjati ta' ${name}`,
  recent_confirm:  'Ħassar?',
  recent_confirm_t:'Jitneħħew biss il-bidliet issejvjati. Il-video ma tintmessx.',
  recent_clear:    'Ħassar kollox',
  recent_cleared:  'Il-lista tar-riċenti tnaddfet.',
  ago:             ms => {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'issa stess';
    if (m < 60) return `${m} min ilu`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} ${h === 1 ? 'siegħa' : 'sigħat'} ilu`;
    const d = Math.round(h / 24);
    return `${d} ${d === 1 ? 'jum' : 'ijiem'} ilu`;
  },
  missing_file:    'Il-file ma nstabx. Jista\' jkun li ġie mċaqlaq jew imħassar.',

  // list and bar
  cue_count:       n => `${n} ${n === 1 ? 'subtitle' : 'subtitles'}`,
  unsure_btn:      n => (n ? `${n} ${n === 1 ? 'kelma dubjuża' : 'kelmiet dubjużi'} · U` : 'L-ebda kelma dubjuża'),
  issue_btn:       n => (n ? `${n} diffiċli biex jinqraw · E` : 'Kollha faċli biex jinqraw'),
  issue_fast:      'mgħaġġel',
  issue_fast_t:    'Aktar minn 20 karattru kull sekonda: diffiċli biex jinqara.',
  issue_short:     'qasir',
  issue_short_t:   'Fuq l-iskrin għal inqas minn 0.7 sekonda.',
  issue_lines:     'twil wisq',
  issue_lines_t:   'Ma jitwaqqax fl-għadd ta\' linji li jippermetti dan l-istil. Aqsmu (B) jew qassar it-test.',
  seek_hint:       'Mur hawn',
  style_override:  'Style speċjali għal dan is-subtitle',
  big_line:        'Linja kbira',
  t_big:           'Linja kbira: kbira, inklinata, b\'ittri kbar, f\'nofs il-frame (P)',
  l_big:           'Linja kbira',
  edit_hint:       'Enter biex taċċetta · Esc biex tikkanċella',
  t_edit:          'Editja t-test (Enter)',
  t_wordPrev:      'Ċaqlaq l-ewwel kelma lejn is-subtitle ta\' qabel (1)',
  t_wordNext:      'Ċaqlaq l-aħħar kelma lejn is-subtitle li jmiss (2)',
  t_delete:        'Ħassar is-subtitle (Delete)',
  play:            'Play',
  pause:           'Pause',

  // reasons an action can't run
  cant:            'Dan ma jistax isir hawn.',
  no_cue:          'Agħżel subtitle l-ewwel.',
  no_word:         'Agħżel kelma l-ewwel (ikklikkjaha).',
  r_one_word:      'Dan is-subtitle fih kelma waħda biss.',
  r_no_next:       'M\'hemm l-ebda subtitle wara dan.',
  r_no_prev:       'M\'hemm l-ebda subtitle qabel dan.',
  r_split_pos:     'Qiegħed il-video fuq kelma f\'nofs is-subtitle biex taqsmu.',
  r_playhead:      'Qiegħed il-video fejn trid li ssir il-qasma l-ġdida.',
  undo_empty:      'M\'hemm xejn x\'tirtira.',
  redo_empty:      'M\'hemm xejn x\'terġa\' tagħmel.',
  no_unsure:       'L-ebda kelma dubjuża.',
  no_issues:       'Is-subtitles kollha faċli biex jinqraw.',

  // undo labels
  l_split:         'Split',
  l_gap:           'Gap',
  l_gaps:          'Tidy gaps',
  r_gap_pos:       'Qiegħed il-video f\'pawża bejn kelmtejn biex tħalli gap.',
  gap_off:         'Off',
  gaps_done:       'Il-captions tneħħew minn fuq il-pawżi twal.',
  gaps_none:       'M\'hemm xejn x\'tnaddaf.',
  gap_off_hint:    'Agħżel gap ikbar minn 0 qabel.',
  l_join:          'Għaqda',
  l_trimIn:        'Bidu',
  l_trimOut:       'Tmiem',
  l_roll:          'Punt tal-qtugħ',
  l_move:          'Ċaqlaq',
  l_wordtime:      'Ħin tal-kelma',
  word_first:      'L-ewwel kelma tibda meta jibda s-subtitle. Ċaqlaq is-subtitle, jew żid kelma qablu.',
  word_limit:      'Il-kelma ma tistax tgħaddi l-kliem ta\' ġenbha.',
  l_word:          'Ċaqlaq kelma',
  l_delete:        'Ħassar',
  l_edit:          'Test',
  l_keyword:       'Keyword',
  l_keywords:      'Keywords',
  l_style:         'Style tas-subtitle',
  l_resplit:       'Split mill-ġdid',
  l_names:         'Ismijiet',
  l_replace:       'Ibdel',
  l_articles:      'Artikli',
  undone:          label => `Irtirat: ${label}`,
  redone:          label => `Erġa\' sar: ${label}`,

  // style drawer
  yours:           'Tiegħek',
  delete_look:     'Ħassar dan l-istil',
  reset_cue_style: '✕ Bħall-bqija tal-video',
  look_saved:      name => `Issejvjat: ${name}`,
  look_imported:   name => `Importat: ${name}`,
  bad_style:       'Dan mhuwiex file tal-istil tal-Banditur.',
  fonts_bundled:   'Inkluż',
  fonts_system:    'Fuq dan il-Mac',
  no_logo:         'L-ebda logo',
  keywords_marked: n => `Ġew immarkati ${n} ${n === 1 ? 'keyword' : 'keywords'}. ⌘Z biex tirtira.`,
  keywords_none:   'Ma nstab l-ebda keyword ġdid.',
  guides_on:       'Is-safe area murija.',
  guides_off:      'Is-safe area moħbija.',

  // split / names / articles
  resplit_done:    'Is-subtitles nqasmu mill-ġdid. ⌘Z biex tirtira.',
  resplit_offer:   (name, n, long) => `${name} jaħdem l-aħjar b'${n} ${n === 1 ? 'kelma' : 'kelmiet'} għal kull subtitle${long ? `. ${long} ma jidħlux f'żewġ linji` : ''}.`,
  articles_merged: 'L-artikli ngħaqdu. ⌘Z biex tirtira.',
  names_none:      'L-ebda isem miktub b\'aktar minn mod.',
  name_correct:    'Ortografija korretta',
  replace_all:     'Ibdel kollox',
  names_applied:   (n, to) => `Inbidlu ${n} ${n === 1 ? 'kelma' : 'kelmiet'} għal "${to}".`,
  replaced:        n => (!n ? 'Ma nstab xejn.' : `Inbidlu ${n} ${n === 1 ? 'kelma' : 'kelmiet'}.`),
  art_dangling:    'artikolu waħdu',
  art_assim:       'ma jaqbilx',
  art_contraction: "f' + il → fil",
  articles_none:   'L-artikli jidhru tajbin.',
  caps_none:       'Ma nstab l-ebda isem b\'ittri żgħar.',
  caps_apply:      n => `Agħmel ${n} ${n === 1 ? 'isem' : 'ismijiet'} b'ittra kapitali`,
  caps_done:       n => `Inbidlu ${n} ${n === 1 ? 'kelma' : 'kelmiet'}. ⌘Z biex tirtira.`,
  caps_badge:      n => `${n} ${n === 1 ? 'isem' : 'ismijiet'} b'ittri żgħar`,
  myname_remove:   name => `Neħħi "${name}" mil-lista`,
  l_caps:          'Ittri kapitali',

  // export
  no_video:        'Dan il-file m\'għandux stampa. Tista\' tesporta SRT jew ASS biss.',
  exporting:       'Qed tesporta…',
  export_pct:      p => `Qed tesporta… ${Math.round(p)}%`,
  export_done:     name => `Lest: ${name}`,
  export_cancel:   'L-export ġiet ikkanċellata.',
  export_err:      msg => `L-export falliet: ${msg}`,
  export_busy:     'Diġà qed tesporta.',
  saved_file:      name => `Issejvjat: ${name}`,
  save_err:        msg => `Ma stajtx insejvja l-file: ${msg}`,
};

// ── Posts (Għodda → Posts: post maker) ────────────────────────────────────────
export const PM = {
  tab:            'Posts',
  templates:      'Templates',
  newTemplate:    '+ Template ġdida',
  edit:           'Editja t-template',
  remove:         'Ħassar',
  keep:           'Żomm',
  stageLabel:     'Il-post: iġbed ir-ritratt biex tpoġġih. Vleġeġ jċaqalqu r-ritratt, + u − ikabbru, 0 jirrisettja, żomm H biex taħbi l-overlay.',
  dropHint:       'Ħalli r-ritratt hawn',
  emptyTitle:     'Għad m\'hemm l-ebda template',
  emptyBody:      'Agħmel l-ewwel waħda: ikkarga overlay PNG ta\' 1080×1350 minn Photoshop u agħżel fejn jidher l-isem.',
  photo:          'Ritratt',
  pickPhoto:      'Agħżel ritratt…',
  changePhoto:    'Biddel ir-ritratt',
  photoHint:      'Iġbed ir-ritratt biex tpoġġih bħal ma jixraq fl-overlay. Skrollja jew uża s-slider biex tkabbar.',
  zoom:           'Zoom',
  reset:          'Erġa\' poġġi',
  hideOverlay:    'Aħbi l-overlay',
  text:           'Test',
  optional:       'fakultattiv',
  exportBtn:      'Export…',
  useInPost:      'Uża f\'post',
  needPhoto:      'Agħżel ritratt l-ewwel.',
  needText:       label => `Imla "${label}" l-ewwel.`,
  lowResSoft:     'Ir-ritratt huwa ftit żgħir għal dan iz-zoom — jista\' jidher ftit artab.',
  lowResBad:      'Ir-ritratt huwa żgħir wisq għal dan iz-zoom u se jidher imċajpar. Agħżel ritratt akbar jew naqqas iz-zoom.',
  tooLong:        label => `"${label}" twil wisq biex jidħol fil-kaxxa. Qassru, jew kabbar il-kaxxa fit-template.`,
  exported:       name => `Issejvjat: ${name}`,
  exportFail:     'Ma stajtx noħloq ir-ritratt.',
  sentToPost:     'Ir-ritratt żdied mal-post fi Skeda.',
  badImage:       'Ma stajtx niftaħ dan ir-ritratt. Prova JPG jew PNG.',
  loadFail:       'Ma stajtx ingħabbi t-templates.',
  overlayLoadFail:'Ma stajtx ingħabbi l-overlay.',
  deleteConfirm:  name => `Tħassar it-template "${name}"? Ma terġax tinkiseb.`,
  deleted:        'Template mħassra.',
  // Editor
  newTemplateTitle:  'Template ġdida',
  editTemplateTitle: 'Editja t-template',
  templateName:   'Isem it-template',
  overlayFile:    'Overlay (PNG 1080×1350, trasparenti)',
  pickOverlay:    'Agħżel PNG…',
  overlayOk:      'Overlay mgħabbi ✓',
  overlayNone:    'Għad m\'hemm l-ebda overlay',
  overlayBad:     'Ma stajtx niftaħ dan il-PNG.',
  overlayBadSize: (w, h) => `L-overlay irid ikun eżattament 1080×1350 (4:5). Dan huwa ${w}×${h}.`,
  zones:          'Kaxxi tat-test',
  zoneHint:       'Iġbed il-kaxxa fuq l-overlay biex tpoġġiha; iġbed l-irkejjen biex tbiddel id-daqs.',
  zoneDefault2:   'Kaxxa oħra',
  addZone:        '+ Kaxxa oħra',
  removeZone:     'Neħħi din il-kaxxa',
  zoneLabel:      'Isem tal-kaxxa',
  sample:         'Test ta\' prova',
  font:           'Font',
  color:          'Kulur',
  align:          'Allinjament',
  valign:         'Pożizzjoni vertikali',
  letters:        'Ittri',
  minSize:        'Min size (px)',
  maxSize:        'Max size (px)',
  maxLines:       'Linji massimi',
  lineHeight:     'Spazju bejn il-linji',
  shadow:         'Dell ħafif wara t-test',
  box:            'Kaxxa fuq il-frame (x, y, wisa\', għoli) f\'pixels',
  aligns:         { left: 'Xellug', center: 'Nofs', right: 'Lemin' },
  valigns:        { top: 'Fuq', middle: 'Nofs', bottom: 'Isfel' },
  cases:          { none: 'Kif inkiteb', upper: 'KOLLHA KBIRA', lower: 'kollha żgħar' },
  saveTemplate:   'Save template',
  cancel:         'Ikkanċella',
  saved:          'Template issejvjata.',
  saveFail:       'Ma stajtx insejvja t-template.',
  needTemplateName: 'Agħti isem lit-template.',
  needOverlay:    'Agħżel overlay PNG.',
};
