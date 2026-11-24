> **Done 2026-11-22.** The server move below is built (api/events.js, migration 20261122_sharing.sql,
> Settings → Sharing; see README and DECISIONS). Kept only for the "Later ideas" at the end; delete this file
> when those are picked up or dropped.

# Calendar: server move (for later; delete when done)

Not being worked on now. Events live in `localStorage` (`banditur_calendar`, per profile) via
`src/views/kalendarju/local-store.js`. Everything below is the plan for when we want them on our own server.

## Data model (already used locally)
Event: id, profile_id, request_id, title, label, allDay, start, end (Malta wall-clock
`YYYY-MM-DD[THH:mm]`, all-day end exclusive), location, description,
repeat {freq daily|weekly|monthly|yearly, interval, until}|null, tz 'Europe/Malta',
revision, created_at, updated_at. Labels: {name, color #rrggbb, visible}, per profile.

## Server move
- `GET /api/events?profile_id&from&to` -> {events, labels}; `POST` (request_id idempotent);
  `PATCH /api/events/:id` with `revision` (409 + `current` when stale); `DELETE` idempotent;
  `PUT /api/events/labels`.
- The store's methods already match this (list / create / update with revision / remove), so the move is replacing
  the bodies in `local-store.js` with `api()` calls; the UI only uses `calendar.svelte.js`.
- Needs a table (Supabase) and one handler (10 of 12 used; combine with another if tight).
- Import: one-off copy of `banditur_calendar` from the Mac into the table.

## Later ideas
Single-occurrence edits for repeats, reminders, sharing between members.
