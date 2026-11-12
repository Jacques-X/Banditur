# Calendar plan (temporary: delete once the server move is done)

Status: local calendar built (`src/views/kalendarju/`). Remaining: move storage to the server.

## Data model
Event: id, profile_id, request_id, title, label, allDay, start, end (Malta wall-clock
`YYYY-MM-DD[THH:mm]`, all-day end exclusive), location, description,
repeat {freq daily|weekly|monthly|yearly, interval, until}|null, tz 'Europe/Malta',
revision, created_at, updated_at. Labels: {name, color #rrggbb, visible}, per profile.

## Server move (later)
- `GET /api/events?profile_id&from&to` -> {events, labels}; `POST` (request_id idempotent);
  `PATCH /api/events/:id` with `revision` (409 + `current` when stale); `DELETE` idempotent;
  `PUT /api/events/labels`.
- Replace the body of the `createCalendarStore` functions in `local-store.js` with `api()` calls;
  the UI only uses `calendar.svelte.js`. Needs a table (Supabase) and one handler (10 of 12 used; combine if tight).
- Import: one-off script copying `banditur_calendar` from the Mac to the table.

## Later ideas
Single-occurrence edits for repeats, reminders, sharing between members.
