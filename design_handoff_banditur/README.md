# Handoff: Banditur — PR Portal (Desktop, Tauri)

## Overview
Banditur is a desktop PR portal for a Maltese band club (Soċjeta Mużikali Santa Katarina). It gives the club's PR Secretary a single place to (1) run local media-processing tools, (2) compose and schedule posts across Facebook, Instagram and the club's WordPress site, and (3) review history and generate committee reports.

Target stack (fixed): **Tauri + Vanilla HTML + Tailwind CSS + Vanilla JS**. No React, no Vue, no bundler-heavy frontend framework.

## About the Design Files
The file in this bundle (`Banditur.html`) is a **design reference created in HTML** — a prototype showing intended look and behavior. It is not production code to drop into the app as-is. The task is to **recreate this design inside the Tauri project**, split across appropriately scoped HTML/CSS/JS modules, following the existing project conventions (Vanilla JS, Tailwind, Rust-side Tauri commands for local work).

Mock data in the prototype (history rows, upcoming events, metrics) stands in for real state — replace with live data from Tauri commands and the relevant APIs.

## Fidelity
**High-fidelity.** Colors, spacing, typography, radii, iconography and interaction affordances are intentional and should be preserved. When migrating to the real app, match the prototype pixel-wise; use the design tokens listed below rather than re-deriving values.

## App Shell

### Window chrome (top 36px)
- macOS-style traffic lights on the left (decorative — Tauri will render real controls; hide if target OS provides them).
- Centered window title: `Banditur · Soċjeta Mużikali Santa Katarina`, 11.5px, muted `#6b6770`.
- Right-aligned status: green dot + "Online" + version string in tabular-nums.
- Background: `#F3F0EA`, 1px bottom border `#E5E2DC`.

### Two-column layout
- **Sidebar**: fixed width 256px (`w-64`), warm off-white `#F3F0EA`, 1px right border `#E5E2DC`. Full height, flex column, `overflow: hidden`.
- **Main**: flex-1, white background. Contains all three views (only one visible at a time).
- Root container is `h-screen w-screen flex overflow-hidden`, with `select-none` on all chrome to feel like a native app (caption and input fields remain selectable).

### Sidebar contents (top → bottom)
1. **Logo block**: 32×32 rounded-md brand-700 square holding a small headphones/music SVG, next to stacked text "Banditur" (16px, bold, brand-700) + "PR PORTAL" (10.5px uppercase, muted).
2. **Club switcher**: full-width white button, 1px border `#E5E2DC`, rounded-md, containing 24×24 `SK` initials tile + "Santa Katarina" (12px semibold) + "Żurrieq" (10.5px muted) + up/down chevron.
3. **Nav section "Xogħol"** (uppercase 10.5px label). Three items:
   - `Għodda` (wrench icon) — label "Tools" right-aligned muted
   - `Skeda` (calendar icon) — red pill "3" right-aligned
   - `L-Arkivju` (archive icon) — label "Archive" right-aligned muted
   Active item: white background, brand-700 text, 2px brand-700 left rail, subtle shadow.
4. **Nav section "Kurrenti"**: three status rows (amber/rose/emerald dot + label + muted suffix).
5. **Spacer** (flex-1).
6. **User footer**: 28px gradient avatar (`JM`), name + role, settings gear.

## View 1 — Għodda (Tools workspace)

### Purpose
Run local (Tauri/Rust-backed) media tools before posting.

### Layout
- View header: 32px horizontal padding, 28px top padding. Eyebrow label "WORKSPACE", H1 "Għodda" (22px bold, -0.01em tracking), subtitle (12.5px muted). Right side: green-tinted pill `Rust engine: attiv` with dot.
- Tab bar: 32px padding, 1px bottom border. Three tabs, 24px gap: `Marka & Ssortja`, `ARW → JPG`, `Traskrittura`. Each tab: small icon + label, 13px medium. Active tab: ink color + 2px brand-700 underline at `bottom: -1px`.
- Body: scrollable area, max-width 5xl (1024px).
  - Three metric cards in a `grid-cols-3 gap-3`: each card `rounded-lg border border-[#E5E2DC] p-4` with an uppercase 10.5px eyebrow, 22px bold tnum number, small delta or label.
  - Placeholder card: `rounded-lg border-dashed border-[#d4cfc5] bg-[#FBFAF8] p-10`, centered. 48px white rounded tile with wrench icon, 14px semibold headline "Local Rust Tools Render Here", 12px muted paragraph, `⌘ + O` keyboard hint using `.kbd` style.
  - Helper note below: small info icon + 11px muted text.

### Behavior
- Clicking a tab swaps `data-active="true"` among `.tool-tab` elements (currently visual only; wire each tab to its Rust-backed view once implemented).
- Each tab's real body should be a distinct panel that calls a Tauri command: `invoke('mark_and_sort', {...})`, `invoke('arw_to_jpg', {...})`, `invoke('transcribe', {...})`.

## View 2 — Skeda (Scheduling composer)

### Purpose
Compose a post and schedule it across multiple platforms, with Google Calendar context visible.

### Layout
- View header: same pattern as other views + two header buttons ("Reset", "Anteprima").
- Body: `grid grid-cols-3` filling the remaining height.
  - **Composer pane** (`col-span-2`), scrollable, 32px padding, inner max-width 3xl (768px).
  - **Calendar pane** (`col-span-1`), 1px left border `#E5E2DC`, bg `#FBFAF8`, scrollable.

### Composer pane (top to bottom)
1. **Profil + Mudell row** (`flex gap-3`). Two selects:
   - Profil (Sub-Kumitat): options `Il-Kumitat Ċentrali` (red), `Kummissjoni Żgħażagħ` (blue), `Għaqda tan-Nar` (orange). Has a 16×16 color swatch left icon that updates with the selected profile.
   - Mudell (Template): `Festa`, `Kondoljanzi`, `Kunċert`, `— Ebda mudell —`. Selecting one replaces the caption text.
   - Labels: 11px semibold, with a muted 10.5px English hint on the right side.
   - Inputs: `appearance-none`, white, 1px border, rounded-md, shadow-soft, 9px left padding for icon, focus ring `ring-brand-100`.
2. **Caption block**:
   - Header: "Kaption" + char counter `N / 2,200` in tabular-nums.
   - Card: white, 1px border, rounded-md, focus-within ring. Inner toolbar row (1px bottom border `#F0ECE4`) with Bold / Italic / Link / Hashtag / Emoji 14px icon buttons, then `MT` locale marker on the right.
   - `<textarea>` 6 rows, 13px/relaxed leading, resize-y. Pre-populated with a Festa template.
3. **Media dropzone**: `border-2 border-dashed border-[#d4cfc5] bg-[#FBFAF8] rounded-lg p-8`. Inside: three slanted 40×40 striped placeholder tiles, 13px semibold instruction, helper row, two buttons: "Agħżel mill-Kompjuter" (folder icon) and "Agħżel minn Google Drive" (Drive tri-color SVG). Muted connection line: "Konness bħala pr@santakatarina.mt".
4. **Platforms row**: toggleable badges for Facebook, Instagram, WordPress. Each badge: small dot + glyph + name. Off state = white bg, `#E5E2DC` border, muted dot. On state = `bg-brand-50`, `border-brand-700`, `text-brand-700`, red dot. Trailing muted hint text.
5. **Dates**: `grid-cols-2 gap-3`. Two `datetime-local` inputs with left-icon decoration:
   - `Data tal-Pubblikazzjoni` (Publish) — calendar icon.
   - `Data ta' Skadenza` (WP expiry) — clock icon.
6. **Footer bar**: 1px top border, pt-4. Left: green dot + "Salvat awtomatikament 14s ilu". Right: `Issejvja bħala Abbozz` (outline) + `Skeda l-Post` (solid brand-700 with paper-plane icon and `⌘↵` kbd badge).

### Calendar pane
- Header: small Google Calendar glyph + "Avvenimenti li Jmiss" (14px bold) + right-aligned "Agħżel kalendarju" button. Subtitle with sync status.
- **Mini month**: "April 2026" + chevron pager. Day-of-week header row: `T T E Ħ Ġ S Ħ` (Mon–Sun in Maltese). Day grid: 7 cols, each cell 24px square, 11px tnum. Today = solid brand-700 circle with white text. Event days = 4px brand-700 dot at the bottom.
- **Event cards** grouped under uppercase labels ("Din il-ġimgħa", "Mejju"). Each card:
  - White bg, 1px border `#E5E2DC`, rounded-md, `shadow-soft`, hover `shadow-pop`.
  - **3px brand-700 left rail**, absolute, inset 8px top/bottom.
  - Title (12.5px semibold), meta row (11px muted: weekday + date + time, then `·`, then location).
  - Right-side big date stack (16px bold tnum number + uppercase 3-letter month).
  - Tag row below: colored profile chip + contextual status tags (e.g. "Abbozz", "Privat").

### Behavior
- Changing "Profil" updates the left swatch color.
- Changing "Mudell" overwrites the caption with the chosen template (preserve user edits? Prototype overwrites; confirm with PM).
- Platform badges toggle their `data-on` state on click.
- Caption input updates char counter on every keystroke.
- "Skeda l-Post" triggers a toast (see Interactions).
- `⌘/Ctrl + Enter` triggers the schedule action from anywhere.

## View 3 — L-Arkivju (Archive & Reports)

### Purpose
Review post history, filter by status, and generate PDF reports for committee meetings.

### Layout
- View header: eyebrow "STORJA U ANALITIKA", H1 "L-Arkivju", subtitle. Right side: 256px search input with magnifier icon and `⌘K` kbd.
- Body: scrollable, 32px padding.

### Report generator panel
- `bg-[#FBFAF8] border border-[#E5E2DC] rounded-lg p-5`.
- Left block: small white tile with report icon + heading + 11.5px muted description.
- Below: five check items on one wrapping flex row, each is a 16×16 rounded square (filled brand-700 + white check when on) + 12.5px semibold label + 10.5px muted metric.
  - `[x] Numru ta' Posts` — "47 din ix-xahar"
  - `[x] Likes u Kummenti` — "3,412 / 284"
  - `[x] Followers Ġodda` — "+128" (emerald)
  - `[ ] Reach fuq Facebook`
  - Period selector divided by a left border: "Perjodu:" + button "April 2026".
- Right side: primary dark action `Iġġenera r-Rapport (PDF)` — `bg-[#2B2830] hover:bg-[#17151A] text-white`, rounded-md, download-arrow icon.

### History table
- `bg-white border border-[#E5E2DC] rounded-lg shadow-soft overflow-hidden`.
- Header row: "Storja tal-Posts" + count pill `247`. Filter chips: `Kollha | Ippubblikati | Jistennew | Falluti`. Active chip: `#17151A` bg, white text; inactive: muted.
- Table columns (12.5px body text):
  1. **Media** (56px): 36×36 colored striped thumb with a subtle gradient overlay.
  2. **Titlu & Kaption**: bold title + truncated caption; failed rows add a 10.5px rose error line with warning icon.
  3. **Data** (160px): tnum date + muted time on second line.
  4. **Profil** (176px): colored 8px dot + profile name, second row shows small platform SVGs (FB/IG/WP tinted).
  5. **Status** (144px): pill — emerald `Ippubblikat`, amber `Jistenna`, rose `Falla`. Rounded-full with 1px tinted border.
  6. **Azzjonijiet** (112px, right): contextual link buttons — `Ikkanċella` for pending, `Erġa' pprova` for failed (brand-700), `Ara` for published.
- Row hover: `bg-[#FBFAF8]`.
- Footer row: "Qed turi 6 minn **247** posts" + Previous/Next.

### Behavior
- Filter chips swap active state and filter the table (current prototype is visual-only).
- `⌘K` focuses the search input (wire this up).
- Actions wire to Tauri commands: `invoke('cancel_post', {id})`, `invoke('retry_post', {id})`, `invoke('open_post_url', {id})`.

## Interactions & Behavior

### Navigation
- Clicking a sidebar nav item sets its `data-active="true"` and shows the matching `<section data-view="...">`. All other views get `hidden`.
- Keyboard: `1`/`2`/`3` jump to Għodda/Skeda/L-Arkivju when focus is not inside a form field.

### Toast (bottom-right)
- Triggered on "Skeda l-Post" click (and `⌘↵`).
- Container: `fixed bottom-5 right-5`, flex-col gap-2, items-end, z-50.
- Card: 320px, white, 1px border, `rounded-lg`, `shadow-pop`, 12px padding; 24×24 solid accent circle (emerald for success) with check icon + title + muted desc + two small actions ("Ara fl-Arkivju", "Agħlaq").
- Enter animation: 180ms ease-out, translateY(8px) + opacity.
- Exit animation: 160ms, same properties reversed.
- Auto-dismiss after 4.8s; manual "Agħlaq" dismisses early.
- Message: title "Il-post qed tiġi skedata…", desc "Se tiġi pubblikata fil-25 Apr, 18:30 fuq Facebook u Instagram." (dynamic based on form values in the real app).

### Form state
- Keep form state in a simple module-scoped object; `autosave` indicator should reflect last-saved timestamp, driven by a debounced write to local Tauri storage.
- Caption character count = `value.length`; warn at 2,000, error at 2,200 (Facebook's limit).

### Focus styles
- Inputs: 1px `#E5E2DC` border default, `#d4cfc5` on hover, `brand-700` border + 2px `brand-100` ring on focus.

## State Management
- **Active view** (`ghodda | skeda | arkivju`) — persist in `localStorage`.
- **Active tool tab** (`marka | arw | trask`) — persist.
- **Composer draft**:
  - `profile: string` (one of three)
  - `template: 'festa' | 'kondoljanzi' | 'kuncert' | null`
  - `caption: string`
  - `media: Array<{path, type, thumb}>`
  - `platforms: { fb: bool, ig: bool, wp: bool }`
  - `publishAt: ISOString`
  - `expiresAt: ISOString | null` (WP only)
  - `autosavedAt: ISOString`
- **History**: list of `{ id, title, caption, mediaThumb, date, time, profile, platforms, status, error? }`, fetched from SQLite via `invoke('list_posts', { filter, page })`.
- **Upcoming events**: fetched from Google Calendar API (via Tauri HTTP or an OAuth-scoped fetch).
- **Report selection**: set of booleans for each metric + selected period.

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| `brand-50` | `#FEF5F5` | Active platform bg, chip bg |
| `brand-100` | `#FDE7E7` | Focus ring |
| `brand-600` | `#C62828` | — |
| `brand-700` | `#A81D1D` | **Primary.** Logo, primary buttons, active nav, event rails, dots |
| `brand-800` | `#8A1717` | Primary hover, swatch border |
| `brand-900` | `#6B0F0F` | Avatar gradient end |
| `paper` | `#FBFAF8` | Soft surface, subtle panels, table hover |
| `ink` | `#17151A` | Primary text, dark button |
| Sidebar bg | `#F3F0EA` | Sidebar, title bar |
| Border | `#E5E2DC` | 1px borders |
| Border strong | `#d4cfc5` | Hover borders |
| Text muted | `#6b6770` | Secondary text |
| Text dim | `#8a857d` | Eyebrow labels |
| Text faint | `#a8a398` | Tertiary meta |
| Hover bg | `#F0ECE4` | Icon button hover |
| Dark action | `#2B2830` | PDF button idle |
| Dark action hover | `#17151A` | PDF button hover |

Semantic:
- Emerald (success): `emerald-500` dot, `emerald-50` bg, `emerald-700` text, `emerald-100` border.
- Amber (pending): `amber-500` / `amber-50` / `amber-700` / `amber-100`.
- Rose (failed): `rose-500` / `rose-50` / `rose-700` / `rose-100`.
- Profile accents: `#A81D1D` (Kumitat), `#1f6feb` (Żgħażagħ), `#c2410c` (Nar).

### Typography
- Family: **Inter** (400 / 500 / 600 / 700), with `cv11, ss01, ss03` feature settings. Monospace: **JetBrains Mono** (400 / 500).
- Base size: 13.5px.
- Scale:
  - H1: 22px / 700 / -0.01em tracking
  - Section title: 14px / 600
  - Card title: 13px / 600
  - Body: 13px / 400
  - Small: 12.5px / 400
  - Meta / caption: 11.5px / 400 muted
  - Eyebrow: 10.5–11px / 600 uppercase, `0.04em` letter-spacing
  - Number display: tabular-nums, 22px bold for metric values, 16px bold for date stamps.

### Spacing, radius, shadow
- Sidebar width: 256px.
- Title bar height: 36px.
- View padding: 32px horizontal, 28px top.
- Card radius: `rounded-md` (6px) for inputs/buttons, `rounded-lg` (8px) for panels.
- Borders: 1px default, 2px dashed for dropzones / empty states.
- Shadows:
  - `soft`: `0 1px 0 rgba(23,21,26,0.04), 0 1px 2px rgba(23,21,26,0.05)`
  - `pop`: `0 8px 24px -6px rgba(23,21,26,0.12), 0 2px 6px rgba(23,21,26,0.06)`

### Decorative patterns
- **Stripes placeholder** (media thumbs, dropzone tiles):
  ```css
  background-image: repeating-linear-gradient(135deg,
    rgba(23,21,26,0.05) 0 6px,
    rgba(23,21,26,0.02) 6px 12px);
  ```
- **kbd style**: JetBrains Mono 10px, 1px border `#E5E2DC` with 2px bottom, rounded 4px, white bg.

## Maltese copy (verbatim)
Keep these strings intact; they are correct Maltese with proper diacritics:
- Navigation: `Għodda`, `Skeda`, `L-Arkivju`, `Xogħol`, `Kurrenti`
- Composer labels: `Profil`, `Mudell`, `Kaption`, `Media`, `Pjattaformi`, `Data tal-Pubblikazzjoni`, `Data ta' Skadenza`
- Profiles: `Il-Kumitat Ċentrali`, `Kummissjoni Żgħażagħ`, `Għaqda tan-Nar`
- Templates: `Festa`, `Kondoljanzi`, `Kunċert`
- Buttons: `Agħżel mill-Kompjuter`, `Agħżel minn Google Drive`, `Issejvja bħala Abbozz`, `Skeda l-Post`, `Iġġenera r-Rapport (PDF)`, `Ikkanċella`, `Erġa' pprova`, `Ara`, `Reset`, `Anteprima`
- Table / reports: `Storja tal-Posts`, `Ġeneratur ta' Rapporti`, `Numru ta' Posts`, `Likes u Kummenti`, `Followers Ġodda`, `Reach fuq Facebook`, `Perjodu`
- Status: `Ippubblikat`, `Jistenna`, `Falla`, `Abbozz`, `Privat`
- Calendar: `Avvenimenti li Jmiss`, `Agħżel kalendarju`, `Din il-ġimgħa`, `Mejju`
- Toast: `Il-post qed tiġi skedata…`
- Day-of-week short: `T T E Ħ Ġ S Ħ` (Mon–Sun)
- Month abbreviations: `Jan Fra Mar Apr Mej Ġun Lul Aww Set Ott Nov Diċ`

## Assets
- **Fonts**: Inter and JetBrains Mono from Google Fonts (the app can bundle these locally via Tauri `assets` dir so it works offline).
- **Icons**: Lucide-style, drawn inline as SVG (stroke-width 1.8–2). Do not replace with emoji — the design intentionally avoids emoji for a more professional tone.
- **Logos**: Facebook glyph (blue #1877F2), Instagram outline (rose #E4405F), WordPress globe (blue #21759B), Google Drive tri-color triangle. These are decorative SVGs inline in the prototype.
- **No band-club brand assets** are in the prototype yet. When the user provides the Santa Katarina crest, drop it into the 32×32 logo tile in the sidebar and into report PDFs.

## Integration notes (Tauri-side)

These Tauri commands will need Rust implementations; the frontend expects them:

- `invoke('list_posts', { filter, page })` → history rows
- `invoke('create_draft', { draft })` → `{ id }`
- `invoke('schedule_post', { id, publishAt, expiresAt, platforms })`
- `invoke('cancel_post', { id })` / `invoke('retry_post', { id })`
- `invoke('pick_media')` → opens native file dialog, returns list of paths
- `invoke('drive_pick')` → opens Drive picker flow, returns list of downloaded local paths
- `invoke('arw_to_jpg', { paths })` / `invoke('mark_and_sort', { folder })` / `invoke('transcribe', { path })`
- `invoke('generate_report', { metrics, period })` → writes a PDF, returns path
- `invoke('calendar_upcoming')` → events, or call Google Calendar REST directly from the frontend with an OAuth token stored via `keyring`.

A lightweight scheduler should live on the Rust side and fire `schedule_post` jobs via Facebook Graph API, Instagram Content Publishing API, and WordPress REST (`/wp/v2/posts`), refreshing tokens as needed.

## Files in this bundle
- `Banditur.html` — single-file design reference. Uses Tailwind CDN, Google Fonts, inline SVGs, inline JS for interactions (view switching, tab switching, platform toggles, caption counter, template injection, toast, keyboard shortcuts, mini-calendar render).
- `README.md` — this document.

When recreating: split `Banditur.html` into three view partials (`views/ghodda.html`, `views/skeda.html`, `views/arkivju.html`), a shared `shell.html` for the sidebar/title bar, and JS modules per view (`js/ghodda.js`, `js/skeda.js`, `js/arkivju.js`) plus a shared `js/app.js` for navigation and toast.
