#!/usr/bin/env node
// Meta smoke test: checks that a profile's Facebook Page and Instagram account
// still accept what Banditur sends — WITHOUT publishing anything.
//
//   npm run smoke:meta -- --profile test
//
// Reads the profile from COMMITTEE_PROFILES (same JSON as the backend), or from
// FB_PAGE_ID / FB_ACCESS_TOKEN / IG_USER_ID. Needs a public JPEG in
// SMOKE_IMAGE_URL; SMOKE_VIDEO_URL (public MP4, 9:16, 3–90 s) adds a Reel check.
//
// What it does:
//   Facebook  reads the Page; uploads the image as an UNPUBLISHED photo and
//             creates an UNPUBLISHED text post, then deletes both.
//   Instagram reads the account; creates an image container (and a Reel
//             container) and waits until Meta has processed it. Containers are
//             never published and expire by themselves after 24 hours.
// Use a test profile anyway: a bug here should never reach a committee page.
import { GRAPH } from '../backend/api/_lib/delivery.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function credentials() {
  const id = flag('profile') || process.env.PROFILE;
  if (id) {
    let list = [];
    try { list = JSON.parse(process.env.COMMITTEE_PROFILES || '[]'); } catch { /* reported below */ }
    const p = list.find((x) => x.id === id);
    if (!p) throw new Error(`Profile “${id}” is not in COMMITTEE_PROFILES.`);
    return { name: p.name || id, pageId: p.fb_page_id, token: p.fb_access_token, igId: p.ig_user_id };
  }
  return { name: 'env', pageId: process.env.FB_PAGE_ID, token: process.env.FB_ACCESS_TOKEN, igId: process.env.IG_USER_ID };
}

async function graph(path, token, { method = 'GET', body } = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  if (method !== 'POST') url.searchParams.set('access_token', token);
  const res = await fetch(url, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify({ ...body, access_token: token }) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`${e.message || `HTTP ${res.status}`}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : ''}`);
  }
  return json;
}

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push(true);
    console.log(`✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push(false);
    console.log(`✗ ${name} — ${e.message}`);
  }
}

async function waitForContainer(id, token, label, limitMs) {
  const until = Date.now() + limitMs;
  for (;;) {
    const { status_code, status } = await graph(`${id}?fields=status_code,status`, token);
    if (status_code === 'FINISHED') return `${label} processed`;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`${label}: ${status || status_code}`);
    if (Date.now() > until) throw new Error(`${label} still ${status_code} after ${limitMs / 1000} s`);
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function main() {
  const c = credentials();
  const image = process.env.SMOKE_IMAGE_URL;
  const video = process.env.SMOKE_VIDEO_URL;
  if (!c.token || !c.pageId) throw new Error('Missing Page id or token (see the top of this file).');
  if (!image) throw new Error('Set SMOKE_IMAGE_URL to a public JPEG.');
  console.log(`Meta smoke test · ${c.name} · ${GRAPH}\nNothing is published.\n`);

  await step('Facebook Page readable', async () => {
    const p = await graph(`${c.pageId}?fields=name,instagram_business_account`, c.token);
    if (c.igId && p.instagram_business_account?.id && p.instagram_business_account.id !== c.igId)
      throw new Error(`Page is linked to Instagram ${p.instagram_business_account.id}, profile says ${c.igId}`);
    return p.name;
  });
  await step('Facebook photo upload (unpublished, then deleted)', async () => {
    const { id } = await graph(`${c.pageId}/photos`, c.token, { method: 'POST', body: { url: image, published: false } });
    await graph(id, c.token, { method: 'DELETE' });
    return `photo ${id}`;
  });
  await step('Facebook text post (unpublished, then deleted)', async () => {
    const { id } = await graph(`${c.pageId}/feed`, c.token, {
      method: 'POST', body: { message: 'Banditur smoke test — not published', published: false },
    });
    await graph(id, c.token, { method: 'DELETE' });
    return `post ${id}`;
  });

  if (!c.igId) {
    console.log('– Instagram skipped (no ig_user_id)');
  } else {
    await step('Instagram account readable', async () => {
      const a = await graph(`${c.igId}?fields=username`, c.token);
      return `@${a.username}`;
    });
    await step('Instagram image container (not published)', async () => {
      const { id } = await graph(`${c.igId}/media`, c.token, {
        method: 'POST', body: { image_url: image, caption: 'Banditur smoke test' },
      });
      return waitForContainer(id, c.token, 'image', 60000);
    });
    if (video)
      await step('Instagram Reel container (not published)', async () => {
        const { id } = await graph(`${c.igId}/media`, c.token, {
          method: 'POST', body: { media_type: 'REELS', video_url: video, caption: 'Banditur smoke test' },
        });
        return waitForContainer(id, c.token, 'reel', 180000);
      });
    else console.log('– Instagram Reel skipped (no SMOKE_VIDEO_URL)');
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${failed ? `${failed} check(s) failed` : 'All checks passed'}.`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
});
