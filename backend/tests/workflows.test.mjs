import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postProblem, deliverySummary, matchesSubmission } from '../api/_lib/post-rules.js';
import { advanceDelivery } from '../api/_lib/delivery.js';
process.env.SUPABASE_URL = 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE = 'test-only';
process.env.API_KEY = 'unit';
process.env.CRON_SECRET = 'cron';
const { createScheduleHandler } = await import('../api/schedule.js');
const { createWorkerHandler } = await import('../api/cron/process.js');
const { createPostHandler } = await import('../api/posts/[id].js');

function database(seed = []) {
  const rows = structuredClone(seed),
    db = {
      rows,
      beforeWrite: null,
      async rpc(name, args) {
        const r = rows.find((r) => r.id === args.p_id && r.status === args.p_expected_status);
        if (!r) return { data: [] };
        r.status = 'processing';
        r.revision++;
        r.claimed_at = new Date().toISOString();
        return { data: [structuredClone(r)] };
      },
      from() {
        let filters = [],
          operation = 'read',
          patch = {},
          single = false;
        const q = {
          select() {
            return q;
          },
          insert(p) {
            operation = 'insert';
            patch = p;
            return q;
          },
          update(p) {
            operation = 'update';
            patch = p;
            return q;
          },
          delete() {
            operation = 'delete';
            return q;
          },
          order() {
            return q;
          },
          limit() {
            return q;
          },
          gte(k, v) {
            filters.push((r) => r[k] >= v);
            return q;
          },
          lte(k, v) {
            filters.push((r) => r[k] <= v);
            return q;
          },
          lt(k, v) {
            filters.push((r) => r[k] < v);
            return q;
          },
          eq(k, v) {
            filters.push((r) => r[k] === v);
            return q;
          },
          or() {
            filters.push(
              (r) =>
                r.status === 'pending' ||
                (r.status === 'fb_native' && Date.parse(r.scheduled_time) <= Date.now()),
            );
            return q;
          },
          in(k, v) {
            filters.push((r) => v.includes(r[k]));
            return q;
          },
          single() {
            single = true;
            return q;
          },
          maybeSingle() {
            single = true;
            return q;
          },
          then(resolve, reject) {
            try {
              if (operation !== 'read' && db.beforeWrite) {
                const f = db.beforeWrite;
                db.beforeWrite = null;
                f(rows);
              }
              let matches = rows.filter((r) => filters.every((f) => f(r)));
              if (operation === 'insert') {
                if (rows.some((r) => r.request_id === patch.request_id))
                  return resolve({ data: null, error: { code: '23505' } });
                const r = {
                  id: `p${rows.length + 1}`,
                  revision: 0,
                  status: 'pending',
                  deliveries: {},
                  ...structuredClone(patch),
                };
                rows.push(r);
                matches = [r];
              }
              if (operation === 'update')
                for (const r of matches)
                  Object.assign(r, structuredClone(patch), { revision: r.revision + 1 });
              if (operation === 'delete') for (const r of matches) rows.splice(rows.indexOf(r), 1);
              resolve({ data: structuredClone(single ? matches[0] || null : matches), error: null });
            } catch (e) {
              reject(e);
            }
          },
        };
        return q;
      },
    };
  return db;
}
async function request(handler, body = {}, method = 'POST', id = 'p1', token = 'unit') {
  const res = {
    code: 200,
    body: null,
    setHeader() {},
    status(n) {
      this.code = n;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler({ method, query: { id }, headers: { authorization: `Bearer ${token}` }, body }, res);
  return res;
}
const media = [
  {
    url: 'https://unit.supabase.co/storage/v1/object/public/media/uploads/a.jpg',
    path: 'uploads/a.jpg',
    type: 'image/jpeg',
  },
];
const job = {
  id: 'p1',
  revision: 3,
  status: 'pending',
  caption: 'Awguri',
  platforms: ['fb', 'ig'],
  content_type: 'post',
  media,
  scheduled_time: '2027-05-01T12:00:00Z',
  deliveries: { fb: { state: 'pending' }, ig: { state: 'pending' } },
};

test('text-only Instagram is rejected; Facebook text-only remains valid', () => {
  assert.match(postProblem({ platforms: ['ig'], caption: 'Hello', media: [] }), /jeħtieġu/);
  assert.equal(postProblem({ platforms: ['fb'], caption: 'Hello', media: [] }), '');
  assert.match(postProblem({ platforms: ['fb'], content_type: 'reel', media }), /video/);
});
test('partial and uncertain outcomes cannot become published', () => {
  assert.equal(
    deliverySummary(['fb', 'ig'], { fb: { state: 'published' }, ig: { state: 'failed' } }),
    'failed',
  );
  assert.equal(
    deliverySummary(['fb', 'ig'], { fb: { state: 'published' }, ig: { state: 'preparing' } }),
    'pending',
  );
  assert.equal(
    deliverySummary(['fb', 'ig'], { fb: { state: 'published' }, ig: { state: 'unknown' } }),
    'failed',
  );
});
test('retrying the same schedule request inserts one row', async () => {
  const db = database(),
    handler = createScheduleHandler(db),
    body = {
      request_id: 'request-1234567890123456',
      caption: 'Awguri',
      platforms: ['fb', 'ig'],
      media,
      scheduledTime: '2027-05-01T12:00:00Z',
    };
  assert.equal((await request(handler, body)).code, 201);
  assert.equal((await request(handler, body)).code, 200);
  assert.equal(db.rows.length, 1);
});
test('concurrent worker claim blocks a queued edit', async () => {
  const db = database([job]);
  db.beforeWrite = (rows) => {
    rows[0].status = 'processing';
    rows[0].revision++;
  };
  const result = await request(createPostHandler(db), { revision: 3, caption: 'Changed' }, 'PATCH');
  assert.equal(result.code, 409);
  assert.equal(db.rows[0].caption, 'Awguri');
});
test('an old revision cannot cancel a changed job', async () => {
  const db = database([job]);
  assert.equal((await request(createPostHandler(db), { revision: 2 }, 'DELETE')).code, 409);
  assert.equal(db.rows.length, 1);
});
test('partial retry preserves the successful destination ID', async () => {
  const db = database([
    {
      ...job,
      status: 'failed',
      deliveries: {
        fb: { state: 'published', id: 'fb-confirmed' },
        ig: { state: 'failed', error: 'Invalid image' },
      },
    },
  ]);
  assert.equal((await request(createPostHandler(db), { revision: 3 })).code, 200);
  assert.equal(db.rows[0].deliveries.fb.id, 'fb-confirmed');
  assert.equal(db.rows[0].deliveries.ig.state, 'pending');
});
test('uncertain outcomes require explicit operator acknowledgement', async () => {
  const db = database([
    { ...job, status: 'failed', deliveries: { fb: { state: 'unknown' }, ig: { state: 'pending' } } },
  ]);
  assert.equal((await request(createPostHandler(db), { revision: 3 })).code, 409);
  assert.equal(db.rows[0].deliveries.fb.state, 'unknown');
});
test('interrupted publication is never resubmitted automatically', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('must not call Meta');
  };
  try {
    const result = await advanceDelivery('fb', job, {}, { state: 'publishing' }, () => {});
    assert.equal(result.state, 'unknown');
  } finally {
    globalThis.fetch = previous;
  }
});
test('Instagram processing resumes its existing container', async () => {
  const previous = globalThis.fetch;
  let calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => (opts.method === 'GET' ? { status_code: 'IN_PROGRESS' } : { id: 'unexpected' }),
    };
  };
  try {
    const result = await advanceDelivery(
      'ig',
      job,
      { fbToken: 'fake', igUserId: 'ig-unit' },
      { state: 'preparing', container: 'existing-container' },
      () => {},
    );
    assert.equal(result.container, 'existing-container');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /existing-container/);
  } finally {
    globalThis.fetch = previous;
  }
});
test('publication without an ID becomes unknown, not successful', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, opts) => ({
    ok: true,
    json: async () => (opts.method === 'GET' ? { status_code: 'FINISHED' } : { success: true }),
  });
  let saved;
  try {
    await assert.rejects(
      () =>
        advanceDelivery(
          'ig',
          job,
          { fbToken: 'fake', igUserId: 'ig-unit' },
          { state: 'preparing', container: 'ready' },
          (r) => {
            saved = r;
          },
        ),
      (e) => e.delivery?.state === 'unknown',
    );
    assert.equal(saved.state, 'publishing');
  } finally {
    globalThis.fetch = previous;
  }
});

test('worker resumes only the unfinished destination and saves its ID', async () => {
  process.env.COMMITTEE_PROFILES = JSON.stringify([
    { id: 'main', fb_page_id: 'page', ig_user_id: 'ig', fb_access_token: 'token' },
  ]);
  const db = database([
    {
      ...job,
      profile_id: 'main',
      scheduled_time: '2020-01-01T00:00:00Z',
      deliveries: {
        fb: { state: 'published', id: 'fb-done' },
        ig: { state: 'preparing', container: 'ready' },
      },
    },
  ]);
  const previous = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => (opts.method === 'GET' ? { status_code: 'FINISHED' } : { id: 'ig-confirmed' }),
    };
  };
  try {
    assert.equal((await request(createWorkerHandler(db), {}, 'POST', 'p1', 'cron')).code, 200);
    assert.equal(db.rows[0].status, 'published');
    assert.equal(db.rows[0].ig_post_id, 'ig-confirmed');
    assert.ok(calls.every((url) => !url.includes('/page/')));
  } finally {
    globalThis.fetch = previous;
  }
});
test('stale publication boundary becomes reviewable without another POST', async () => {
  const db = database([
    {
      ...job,
      profile_id: 'main',
      platforms: ['fb'],
      scheduled_time: '2020-01-01T00:00:00Z',
      status: 'processing',
      claimed_at: '2020-01-01T00:00:00Z',
      deliveries: { fb: { state: 'publishing' } },
    },
  ]);
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('must not publish');
  };
  try {
    await request(createWorkerHandler(db), {}, 'POST', 'p1', 'cron');
    assert.equal(db.rows[0].status, 'failed');
    assert.equal(db.rows[0].deliveries.fb.state, 'unknown');
  } finally {
    globalThis.fetch = previous;
  }
});
test('near-future Facebook job is not published early outside native scheduling window', async () => {
  const db = database([
    {
      ...job,
      profile_id: 'main',
      platforms: ['fb'],
      scheduled_time: new Date(Date.now() + 5 * 60000).toISOString(),
    },
  ]);
  const previous = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('must wait until due');
  };
  try {
    await request(createWorkerHandler(db), {}, 'POST', 'p1', 'cron');
    assert.equal(db.rows[0].status, 'pending');
  } finally {
    globalThis.fetch = previous;
  }
});
test('Facebook video acceptance remains preparing until publishing phase confirms live', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: { video_status: 'processing', publishing_phase: { status: 'not_started' } },
    }),
  });
  try {
    const record = await advanceDelivery(
      'fb',
      job,
      { fbToken: 'fake' },
      { state: 'preparing', id: 'video', object: 'video', stage: 'verify' },
      () => {},
    );
    assert.equal(record.state, 'preparing');
  } finally {
    globalThis.fetch = previous;
  }
});

const { summarizeRange, fetchPageInsights } = await import('../api/reports/monthly.js');
test('reports retain unknown metrics and count only confirmed destinations', async () => {
  const db = database([
    {
      ...job,
      scheduled_time: '2026-10-29T00:00:00Z',
      status: 'failed',
      likes_count: null,
      comments_count: null,
      deliveries: { fb: { state: 'published' }, ig: { state: 'failed' } },
    },
    {
      ...job,
      id: 'p2',
      scheduled_time: '2026-10-28T23:30:00Z',
      status: 'published',
      likes_count: 0,
      comments_count: 0,
      engagement_checked_at: '2026-10-29T02:00:00Z',
      deliveries: { fb: { state: 'published' }, ig: { state: 'published' } },
    },
  ]);
  const report = await summarizeRange('2026-10-29', '2026-10-29', null, null, null, db);
  assert.equal(report.summary.total_published, 2);
  assert.deepEqual(report.summary.by_platform, { fb: 2, ig: 1 });
  assert.equal(report.engagement.measured_posts, 1);
  assert.equal(report.engagement.total_likes, 0);
  const unknown = await summarizeRange('2026-10-29', '2026-10-29', null, null, null, database([db.rows[0]]));
  assert.equal(unknown.engagement.total_likes, null);
});
test('page insights can be unavailable independently of post filters', async () => {
  delete process.env.FB_ACCESS_TOKEN;
  delete process.env.FB_PAGE_ID;
  assert.equal(await fetchPageInsights(null, '2026-10-01', '2026-10-31'), null);
});
test('an interrupted edit recognises the committed fields and changed media', () => {
  const body = {
    caption: job.caption,
    content_type: job.content_type,
    scheduledTime: job.scheduled_time,
    platforms: job.platforms,
    media,
    event_id: 'event',
    category: 'Festa',
    media_retention_days: 30,
    media_pinned: false,
  };
  const saved = {
    ...job,
    event_id: 'event',
    category: 'Festa',
    media_retention_days: 30,
    media_pinned: false,
  };
  assert.equal(matchesSubmission(saved, body), true);
  assert.equal(matchesSubmission(saved, { ...body, media: [] }), false);
});

const { cleanupOrphanMedia } = await import('../api/cron/process.js');
test('retention cleanup stops before listing files when references cannot be read', async () => {
  let storageTouched = false;
  const q = {
    select() {
      return q;
    },
    not() {
      return q;
    },
    order() {
      return q;
    },
    range() {
      return Promise.resolve({ data: null, error: { message: 'offline' } });
    },
  };
  await assert.rejects(
    cleanupOrphanMedia({
      from: () => q,
      storage: {
        from() {
          storageTouched = true;
        },
      },
    }),
    /cleanup skipped/,
  );
  assert.equal(storageTouched, false);
});
test('retention cleanup reads all reference pages and preserves failed or pinned media', async () => {
  const recent = new Date().toISOString(),
    old = '2020-01-01T00:00:00Z';
  const posts = Array.from({ length: 1001 }, (_, i) => ({
    status: 'failed',
    media: [{ path: `uploads/${i}.jpg` }],
  }));
  posts.push({
    status: 'published',
    published_at: old,
    media_retention_days: 1,
    media_pinned: true,
    media: [{ path: 'uploads/pinned.jpg' }],
  });
  posts.push({
    status: 'published',
    published_at: recent,
    media_retention_days: 30,
    media: [{ path: 'uploads/recent.jpg' }],
  });
  let pages = 0;
  const removed = [];
  const q = {
    select() {
      return q;
    },
    not() {
      return q;
    },
    order() {
      return q;
    },
    range(a, b) {
      pages++;
      return Promise.resolve({ data: posts.slice(a, b + 1), error: null });
    },
  };
  const bucket = {
    list: async () => ({
      data: [
        { name: '1000.jpg', created_at: old },
        { name: 'pinned.jpg', created_at: old },
        { name: 'recent.jpg', created_at: old },
        { name: 'orphan.jpg', created_at: old },
      ],
    }),
    remove: async (paths) => {
      removed.push(...paths);
    },
  };
  await cleanupOrphanMedia({ from: () => q, storage: { from: () => bucket } });
  assert.equal(pages, 2);
  assert.deepEqual(removed, ['uploads/orphan.jpg']);
});
