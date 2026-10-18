// ─────────────────────────────────────────────────────────────────────────────
// strings.js — all user-visible text in one place
// Edit this file to change any label, message, or template shown in the app.
// ─────────────────────────────────────────────────────────────────────────────

// ── Status pill labels (archive / history table) ──────────────────────────────
export const STATUS_LABELS = {
  pending:    'Pendenti',
  processing: 'Qed Jipproċessa',
  fb_native:  'Skedat fuq Meta',
  published:  'Ippubblikat',
  failed:     'Fallut',
};

// ── Validation errors ─────────────────────────────────────────────────────────
export const ERR = {
  no_input_dir:    'Il-kartella tas-sors hija meħtieġa.',
  no_photographer: 'L-isem tal-fotoġrafista huwa meħtieġ.',
  no_arw_dir:      'Il-kartella bl-ARW fajls hija meħtieġa.',
  video_format:    'Biss fajls .mp4, .mov, .mp3 u .wav huma supportati.',
  no_caption:      'Il-kaptjon hija meħtieġa.',
  caption_too_long: 'Il-kaption taqbeż il-limitu ta\' 2,200 karattru.',
  broken_media:    n => n === 1
    ? 'Waħda mill-midja mtella\' ma tidhirx aċċessibbli. Neħħiha u erġa\' żidha, jew ipprova għal darb\'oħra.'
    : `${n} mill-midja mtella' ma jidhrux aċċessibbli. Neħħihom u erġa' żidhom, jew ipprova għal darb'oħra.`,
  no_platform:     'Agħżel tal-inqas pjattaforma waħda.',
  no_time:         'Il-ħin tal-pubblikazzjoni huwa meħtieġ.',
  supabase_config: 'Supabase mhux ikkonfiggurat — issettja fis-Settings.',
  vercel_config:   'Issettja l-Vercel URL u l-API Key fis-Settings ⚙',
  settings_first:  'Issettja s-Settings l-ewwel.',
  pick_period:     'Agħżel il-perijodu.',
  bad_range:       'Id-data "Mill" trid tkun qabel jew ugwali għad-data "Sa".',
  no_report_yet:   'L-ewwel iġġenera rapport.',
  fatal:      e => `Żball fatali: ${e}`,
  generic:  msg => `Żball: ${msg}`,
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
  done_wm:   (processed, failed) =>
    `Lest — ${processed} ipproċessati${failed ? `, ${failed} imqabbla` : ''}`,
  done_arw:  (converted, skipped) =>
    `Lest — ${converted} ikkonvertiti${skipped ? `, ${skipped} preteriti` : ''}`,
};

// ── Transcription panel ───────────────────────────────────────────────────────
export const TX = {
  idle:          'Ready. Drop a video or audio file, or click to start.',
  starting:      'Starting…',
  transcribing:   pct => `Transcribing… ${Math.round(pct)}%`,
  error:         msg => `Error: ${msg}`,
  saved:         '✓ Saved!',
  save_btn:      'Save SRT',
  save_error:    'Error!',
  ts_hint:       'Click to listen',
};

// ── Schedule / post composer ──────────────────────────────────────────────────
export const SCHED = {
  uploading:      'Qed jittella\' l-midja…',
  checking_media: 'Qed nivverifikaw il-midja…',
  scheduling:     'Qed jiskeda…',
  scheduled:      'Post iskedat! ✓',
  draft_saved:    'Abbozz issejvjat.',
  downloading:    'Qed jniżżel minn Drive…',
};

// ── Toast notifications ───────────────────────────────────────────────────────
export const TOAST = {
  scheduled:     'Post iskedat!',
  retried:       'Post imressaq mill-ġdid.',
  offline:       'M\'intix konness. Il-post ġiet issejvjata bħala abbozz.',
  settings_saved: 'Settings issejvja.',
  error: msg => `Żball: ${msg}`,
  drive_err: msg => `Drive żball: ${msg}`,
};

// ── Empty states / loading placeholders ──────────────────────────────────────
export const EMPTY = {
  loading:      'Qed jgħabbi…',
  no_posts:     'L-ebda post skedat.',
  no_drafts:    'L-ebda abbozz.',
  no_events:    'L-ebda avveniment.',
  no_drive:     'Folder vojt.',
  settings_req: 'Issettja s-Settings l-ewwel.',
  error:   msg => `Żball: ${msg}`,
};

// ── Confirmation dialogs ──────────────────────────────────────────────────────
export const CONFIRM = {
  delete_post: 'Trid tħassar dan il-post?',
  reset_form:  'Trid tirrisettja l-formola? Il-bidliet mhux issejvjati jintilfu.',
};

// ── Buttons / action labels ───────────────────────────────────────────────────
export const BTN = {
  retry:         'Erġa\' Pprova',
  retrying:      '…',
  delete:        'Ħassar',
  report_gen:    'Iġġenera r-Rapport (PDF)',
  report_busy:   'Qed jgħabbi…',
  tmpl_manage:   '⚙ Ħares it-Templates…',
  tmpl_section:  'Mudelli',
  tmpl_yours:    'Tiegħek',
  tmpl_del:      'Ħassar',
  media_rm:      'Neħħi',
  tmpl_new: n => `Template ${n}`,
};

// ── Watermark packs (Marka & Ssortja) ────────────────────────────────────────
export const WM = {
  none_installed:  'L-ebda marka installata — importa pack mill-buttuna tal-marki.',
  status: (packs, marks) => packs ? `Packs: ${packs} · Marki: ${marks}` : 'L-ebda pack installat.',
  empty_list:      'L-ebda pack installat għadu. Importa fajl .bwpack jew żid marka ġdida.',
  meta:  (v, n) => `Verżjoni ${v} · Marki: ${n}`,
  show_list:       'Uri l-marki',
  portrait:        'portrett',
  landscape:       'pajsaġġ',
  export:          'Esporta',
  delete:          'Ħassar',
  remove:          'Neħħi',
  new_pack_opt:    '＋ Pack ġdid…',
  none_file:       'Xejn',
  file_filter:     'Pack tal-marki',
  confirm_install:   (name, v, n) => `Tinstalla l-pack "${name}" (verżjoni ${v}, marki: ${n})?`,
  confirm_update:    (name, from, to) => `Il-pack "${name}" diġà installat (verżjoni ${from}). Taġġornah għal verżjoni ${to}?`,
  confirm_downgrade: (name, v, installed) => `Il-pack "${name}" diġà installat b'verżjoni ${installed}, u dan il-fajl huwa verżjoni ${v}. Tissostitwih xorta waħda?`,
  confirm_delete:    (name, n) => `Tħassar il-pack "${name}" (marki: ${n}) minn dan il-kompjuter?`,
  confirm_remove:    (wm, pack) => `Tneħħi "${wm}" mill-pack "${pack}"?`,
  imported: name => `Il-pack "${name}" ġie installat.`,
  exported: name => `Il-pack "${name}" ġie esportat.`,
  deleted:  name => `Il-pack "${name}" tħassar.`,
  removed:  wm   => `"${wm}" tneħħiet.`,
  added:    wm   => `"${wm}" ġiet miżjuda.`,
  need_name:       'Daħħal l-isem tal-fotografu/a.',
  need_pack_name:  'Daħħal isem għall-pack il-ġdid.',
  need_file:       'Agħżel tal-inqas PNG waħda.',
  load_failed:     'Ma stajtx niġbed il-lista tal-marki.',
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
  sec_engage:   'Likes u Kummenti',
  sec_reach:    'Reach u Followers',
  sec_top:      n  => `L-aqwa Posts (${n})`,
  sec_list:      n  => `Lista ta' Posts (${n})`,

  total_pub:    'Total Ippubblikat',
  total_pend:   'Pendenti',
  total_fail:   'Falluti',
  total_likes:  'Total Likes',
  total_comm:   'Total Kummenti',
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
  open_file:     'Iftaħ il-Fajl ↗',
  error:  msg  => `Żball: ${msg}`,
  no_url:        'Daħħal URL ta\' YouTube.',
};

// BUG-17: MOCK_HISTORY (dead demo-mode data, unused anywhere in main.js) was
// removed here — leftover from an earlier no-backend demo mode.

// ── Subtitle editor (Traskrittura) ────────────────────────────────────────────
export const SUB = {
  // resume / recent
  resume_title:    name => `You have saved edits for ${name}`,
  resume_meta:     (when, n) => `Edited ${when} · ${n} ${n === 1 ? 'caption' : 'captions'}`,
  resume_yes:      'Continue',
  resume_no:       'Transcribe again',
  recent:          'Recent',
  recent_delete:   name => `Delete saved edits for ${name}`,
  recent_confirm:  'Delete?',
  recent_confirm_t:'Only the saved edits are removed. The video is not touched.',
  recent_clear:    'Clear all',
  recent_cleared:  'Recent list cleared.',
  ago:             ms => {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
    const d = Math.round(h / 24);
    return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  },
  missing_file:    'File not found. It may have been moved or deleted.',

  // list and bar
  cue_count:       n => `${n} ${n === 1 ? 'caption' : 'captions'}`,
  unsure_btn:      n => (n ? `${n} uncertain ${n === 1 ? 'word' : 'words'} · U` : 'No uncertain words'),
  issue_btn:       n => (n ? `${n} hard to read · E` : 'All easy to read'),
  issue_fast:      'fast',
  issue_fast_t:    'More than 20 characters per second: hard to read.',
  issue_short:     'short',
  issue_short_t:   'On screen for less than 0.7 seconds.',
  issue_lines:     'too long',
  issue_lines_t:   'Does not fit the number of lines this style allows. Split it (B) or shorten the text.',
  seek_hint:       'Go here',
  style_override:  'Custom style for this caption',
  big_line:        'Big line',
  t_big:           'Big line: large, slanted, upper-case, mid-frame (P)',
  l_big:           'Big line',
  edit_hint:       'Enter to accept · Esc to cancel',
  t_edit:          'Edit text (Enter)',
  t_wordPrev:      'Move the first word to the previous caption (1)',
  t_wordNext:      'Move the last word to the next caption (2)',
  t_delete:        'Delete caption (Delete)',
  play:            'Play',
  pause:           'Pause',

  // reasons an action can't run
  cant:            'This can\'t be done here.',
  no_cue:          'Select a caption first.',
  no_word:         'Select a word first (click it).',
  r_one_word:      'This caption has only one word.',
  r_no_next:       'There is no caption after this one.',
  r_no_prev:       'There is no caption before this one.',
  r_split_pos:     'Move the video onto a word in the middle of the caption to split it.',
  r_playhead:      'Move the video to where the new split should be.',
  undo_empty:      'Nothing to undo.',
  redo_empty:      'Nothing to redo.',
  no_unsure:       'No uncertain words.',
  no_issues:       'All captions are easy to read.',

  // undo labels
  l_split:         'Split',
  l_join:          'Join',
  l_trimIn:        'Start',
  l_trimOut:       'End',
  l_roll:          'Cut point',
  l_move:          'Move',
  l_wordtime:      'Word timing',
  word_first:      'The first word starts when the caption starts. Move the caption, or add a word before it.',
  word_limit:      'The word can\'t go past its neighbours.',
  l_word:          'Move word',
  l_delete:        'Delete',
  l_edit:          'Text',
  l_keyword:       'Keyword',
  l_keywords:      'Keywords',
  l_style:         'Caption style',
  l_resplit:       'Re-split',
  l_names:         'Names',
  l_replace:       'Replace',
  l_articles:      'Articles',
  undone:          label => `Undid: ${label}`,
  redone:          label => `Redid: ${label}`,

  // style drawer
  yours:           'Yours',
  delete_look:     'Delete this style',
  reset_cue_style: '✕ Same as the rest of the video',
  look_saved:      name => `Saved: ${name}`,
  look_imported:   name => `Imported: ${name}`,
  bad_style:       'This is not a Banditur style file.',
  fonts_bundled:   'Built in',
  fonts_system:    'On this Mac',
  no_logo:         'No logo',
  keywords_marked: n => `Marked ${n} keywords. ⌘Z to undo.`,
  keywords_none:   'No new keywords found.',
  guides_on:       'Safe area shown.',
  guides_off:      'Safe area hidden.',

  // split / names / articles
  resplit_done:    'Captions re-split. ⌘Z to undo.',
  resplit_offer:   (name, n, long) => `${name} works best with ${n} ${n === 1 ? 'word' : 'words'} per caption${long ? `. ${long} won't fit on two lines` : ''}.`,
  articles_merged: 'Articles joined. ⌘Z to undo.',
  names_none:      'No names written in more than one way.',
  name_correct:    'Correct spelling',
  replace_all:     'Replace all',
  names_applied:   (n, to) => `Changed ${n} ${n === 1 ? 'word' : 'words'} to "${to}".`,
  replaced:        n => (!n ? 'Nothing found.' : `Replaced ${n} ${n === 1 ? 'word' : 'words'}.`),
  art_dangling:    'article on its own',
  art_assim:       'doesn\'t match',
  art_contraction: "f' + il → fil",
  articles_none:   'All articles look right.',
  caps_none:       'No lowercase names found.',
  caps_apply:      n => `Capitalise ${n} ${n === 1 ? 'name' : 'names'}`,
  caps_done:       n => `Changed ${n} ${n === 1 ? 'word' : 'words'}. ⌘Z to undo.`,
  caps_badge:      n => `${n} ${n === 1 ? 'name' : 'names'} in lowercase`,
  myname_remove:   name => `Remove "${name}" from the list`,
  l_caps:          'Capital letters',

  // export
  no_video:        'This file has no picture. You can only export SRT or ASS.',
  exporting:       'Exporting…',
  export_pct:      p => `Exporting… ${Math.round(p)}%`,
  export_done:     name => `Done: ${name}`,
  export_cancel:   'Export cancelled.',
  export_err:      msg => `Export failed: ${msg}`,
  export_busy:     'Already exporting.',
  saved_file:      name => `Saved: ${name}`,
  save_err:        msg => `Couldn't save the file: ${msg}`,
};
