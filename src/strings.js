// ─────────────────────────────────────────────────────────────────────────────
// strings.js — all user-visible text in one place
// Edit this file to change any label, message, or template shown in the app.
// ─────────────────────────────────────────────────────────────────────────────

// ── Status pill labels (archive / history table) ──────────────────────────────
export const STATUS_LABELS = {
  pending:    'Pendenti',
  processing: 'Qed Jipproċessa',
  fb_native:  'Skedat (FB)',
  published:  'Ippubblikat',
  failed:     'Fallut',
};

// ── Validation errors ─────────────────────────────────────────────────────────
export const ERR = {
  no_input_dir:    'Il-kartella tas-sors hija meħtieġa.',
  no_photographer: 'L-isem tal-fotoġrafista huwa meħtieġ.',
  no_arw_dir:      'Il-kartella bl-ARW fajls hija meħtieġa.',
  video_format:    'Biss fajls .mp4 u .mov huma supportati.',
  no_caption:      'Il-kaptjon hija meħtieġa.',
  no_platform:     'Agħżel tal-inqas pjattaforma waħda.',
  no_time:         'Il-ħin tal-pubblikazzjoni huwa meħtieġ.',
  supabase_config: 'Supabase mhux ikkonfiggurat — issettja fis-Settings.',
  vercel_config:   'Issettja l-Vercel URL u l-API Key fis-Settings ⚙',
  settings_first:  'Issettja s-Settings l-ewwel.',
  pick_period:     'Agħżel il-perijodu.',
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
  done_wm:   (portrett, pajsagg, imqabbla) =>
    `Lest — ${portrett} portrett, ${pajsagg} pajsaġġ${imqabbla ? `, ${imqabbla} imqabbla` : ''}`,
  done_arw:  (converted, skipped) =>
    `Lest — ${converted} ikkonvertiti${skipped ? `, ${skipped} preteriti` : ''}`,
};

// ── Transcription panel ───────────────────────────────────────────────────────
export const TX = {
  idle:          'Lest — agħti video jew ikklikkja biex tibda.',
  starting:      'Qed nibda…',
  transcribing:   pct => `Qed jittraskrivi… ${Math.round(pct)}%`,
  error:         msg => `Żball: ${msg}`,
  saved:         '✓ Miktub!',
  save_btn:      'Salva SRT',
  save_error:    'Żball!',
  ts_hint:       'Ikklikkja biex tisma\'',
};

// ── Schedule / post composer ──────────────────────────────────────────────────
export const SCHED = {
  uploading:   'Qed jittella\' l-midja…',
  scheduling:  'Qed jiskeda…',
  scheduled:   'Post iskedat! ✓',
  draft_saved: 'Abbozz issejvjat.',
  downloading: 'Qed jniżżel minn Drive…',
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
  sec_list:      n  => `Lista ta' Posts (${n})`,

  total_pub:    'Total Ippubblikat',
  total_pend:   'Pendenti',
  total_fail:   'Falluti',
  total_likes:  'Total Likes',
  total_comm:   'Total Kummenti',
  fb_followers: 'Facebook Followers',
  ig_followers: 'Instagram Followers',
  fb_impr:      'FB Page Impressions (28 jum)',
};

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

// ── Profile swatch colours (keys must match <option> text in index.html) ──────
export const PROFILE_COLORS = {
  'Il-Kumitat Ċentrali':  { bg: '#A81D1D', border: '#8A1717' },
  'Kummissjoni Żgħażagħ': { bg: '#2563EB', border: '#1D4ED8' },
  'Għaqda tan-Nar':       { bg: '#D97706', border: '#B45309' },
};

// ── Mock history rows (shown when no live API config is set) ──────────────────
// Replace these with real captions once the backend is connected.
export const MOCK_HISTORY = [
  { id:'1', caption:'Bħala parti mill-festi titulari, il-Banda tagħna għandha l-pjaċir tħabbar il-Kunċert Annwali…',   platforms:['fb','ig'],     date:'2026-04-20T19:30', profile:'Kumitat Ċentrali',   status:'published' },
  { id:'2', caption:'Avviż importanti dwar il-laqgħa ġenerali tal-kumitat li se ssir nhar is-Sibt li ġej…',             platforms:['fb'],          date:'2026-04-18T10:00', profile:'Kumitat Ċentrali',   status:'published' },
  { id:'3', caption:'Il-Kummissjoni Żgħażagħ tistieden lil kull min jixtieq jieħu sehem f\'attività speċjali…',         platforms:['fb','ig','wp'], date:'2026-04-25T18:30', profile:'Kumm. Żgħażagħ',    status:'pending'   },
  { id:'4', caption:'Tombla b\'premjijiet attraenti organizzata mid-Direttorat tal-Każin. Ejjew isimgħu!',               platforms:['fb','ig'],     date:'2026-04-22T20:00', profile:'Kumitat Ċentrali',   status:'pending'   },
  { id:'5', caption:'Nar tal-Ajru — Prova Ġenerali din il-ġimgħa. Dettalji aktar tard fuq il-paġna.',                   platforms:['wp'],          date:'2026-04-15T08:00', profile:'Għaqda tan-Nar',     status:'failed'    },
  { id:'6', caption:'Il-President u l-Kumitat jirringrazzjaw lil kull min ħa sehem fil-festi ta\' din is-sena.',         platforms:['fb','ig'],     date:'2026-04-10T12:00', profile:'Kumitat Ċentrali',   status:'published' },
];
