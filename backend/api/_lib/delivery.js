const GRAPH = 'https://graph.facebook.com/v25.0';

export async function graph(path, token, body, method = body ? 'POST' : 'GET') {
  const url = new URL(`${GRAPH}/${path}`);
  if (method === 'GET' || method === 'DELETE') url.searchParams.set('access_token', token);
  const r = await fetch(url, {
    method,
    signal: AbortSignal.timeout(12000),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify({ ...body, access_token: token }) : undefined,
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    const err = new Error(data.error?.message || `Meta HTTP ${r.status}`);
    err.retryable = [4, 17, 32, 613].includes(data.error?.code) || r.status === 429 || r.status === 503;
    err.definite = !!data.error; // A network failure after a POST has an unknown outcome.
    throw err;
  }
  return data;
}

export async function verifyDelivery(platform, record, creds) {
  if (!record.id)
    throw new Error('Ma hemmx identifikatur biex nivverifikaw. Iċċekkja Meta qabel terġa’ tipprova.');
  const video = platform === 'fb' && record.object === 'video';
  const fields = platform === 'fb' ? (video ? 'id,status' : 'id,is_published') : 'id,permalink';
  const data = await graph(`${record.id}?fields=${fields}`, creds.fbToken);
  let state = 'published';
  if (video) {
    const status = data.status || {};
    if (
      [
        status.uploading_phase?.status,
        status.processing_phase?.status,
        status.publishing_phase?.status,
      ].includes('error') ||
      ['error', 'upload_failed', 'expired'].includes(status.video_status)
    )
      return { ...record, state: 'failed', error: 'Meta ma setgħetx tipproċessa l-video.' };
    state =
      status.publishing_phase?.publish_status === 'published'
        ? 'published'
        : status.publishing_phase?.publish_status === 'scheduled'
          ? 'scheduled'
          : 'preparing';
  } else if (platform === 'fb') state = data.is_published === true ? 'published' : 'scheduled';
  return {
    ...record,
    state,
    stage: video ? 'verify' : record.stage,
    checked_at: new Date().toISOString(),
    error: null,
    ...(state === 'preparing' ? { retry_after: Date.now() + 30000 } : { retry_after: null }),
  };
}

// Persist the publication boundary BEFORE an external mutation. On an interrupted
// request the worker asks for review instead of blindly creating a second post.
async function publish(record, save, fn) {
  await save({ ...record, state: 'publishing', started_at: new Date().toISOString() });
  try {
    const result = await fn();
    const id = result.id || result.post_id;
    if (!id) throw new Error('Meta ma tatx identifikatur tal-pubblikazzjoni.');
    return {
      ...record,
      id,
      state: record.native ? 'scheduled' : record.object === 'video' ? 'preparing' : 'published',
      ...(record.object === 'video' ? { stage: 'verify' } : {}),
      error: null,
      checked_at: new Date().toISOString(),
    };
  } catch (e) {
    e.delivery = {
      ...record,
      state: e.definite ? (e.retryable ? 'preparing' : 'failed') : 'unknown',
      error: e.message,
      ...(e.retryable ? { retry_after: Date.now() + 60000 } : {}),
    };
    throw e;
  }
}

export async function advanceDelivery(platform, post, creds, record, save) {
  const tok = creds.fbToken,
    media = post.media || [],
    first = media[0];
  if (record.retry_after && record.retry_after > Date.now()) return record;
  if (record.state === 'published') return record;
  if (record.id && (record.stage === 'verify' || record.state === 'unknown'))
    return verifyDelivery(platform, record, creds);
  if (record.state === 'unknown' || record.state === 'publishing')
    return {
      ...record,
      state: 'unknown',
      error: record.error || 'Il-pubblikazzjoni jeħtieġ tiġi vverifikata.',
    };
  if (record.state === 'scheduled') {
    if (new Date(post.scheduled_time) > new Date()) return record;
    return verifyDelivery(platform, record, creds);
  }
  if (platform === 'wp') throw new Error('WordPress m’għadux disponibbli għal pubblikazzjonijiet ġodda.');

  if (platform === 'ig') {
    if (!first) throw new Error('Instagram jeħtieġ media.');
    if (!record.container) {
      const image = first.type.startsWith('image/');
      let params = image ? { image_url: first.url } : { video_url: first.url, media_type: 'REELS' };
      if (media.length > 1) {
        const children = [...(record.children || [])];
        if (children.length < media.length) {
          const m = media[children.length];
          const child = await graph(`${creds.igUserId}/media`, tok, {
            is_carousel_item: true,
            ...(m.type.startsWith('video/')
              ? { media_type: 'VIDEO', video_url: m.url }
              : { image_url: m.url }),
          });
          if (!child.id) throw new Error('Ma nħoloqx medjum tal-carousel.');
          return { ...record, state: 'preparing', children: [...children, child.id] };
        }
        const states = await Promise.all(children.map((id) => graph(`${id}?fields=status_code,status`, tok)));
        const failed = states.find((s) => ['ERROR', 'EXPIRED'].includes(s.status_code));
        if (failed) throw new Error(failed.status || 'Il-medjum tal-carousel falla.');
        if (states.some((s) => s.status_code !== 'FINISHED')) return record;
        params = { media_type: 'CAROUSEL', children: children.join(',') };
      } else if (post.content_type === 'story') params.media_type = 'STORIES';
      const result = await graph(`${creds.igUserId}/media`, tok, { ...params, caption: post.caption });
      if (!result.id) throw new Error('Ma nħoloqx il-container ta’ Instagram.');
      return { state: 'preparing', container: result.id, created_at: new Date().toISOString() };
    }
    const info = await graph(`${record.container}?fields=status_code,status`, tok);
    if (info.status_code === 'ERROR' || info.status_code === 'EXPIRED')
      throw new Error(info.status || 'Il-container skada.');
    if (info.status_code !== 'FINISHED') return record;
    return publish(record, save, () =>
      graph(`${creds.igUserId}/media_publish`, tok, { creation_id: record.container }),
    );
  }

  const page = creds.fbPageId;
  if (post.content_type === 'reel' || (post.content_type === 'story' && first?.type.startsWith('video/'))) {
    const edge = post.content_type === 'reel' ? 'video_reels' : 'video_stories';
    if (!record.video_id) {
      const result = await graph(`${page}/${edge}`, tok, { upload_phase: 'start' });
      if (!result.video_id || !result.upload_url?.startsWith('https://rupload.facebook.com/'))
        throw new Error('Sessjoni tal-upload mhux valida.');
      return {
        state: 'preparing',
        video_id: result.video_id,
        upload_url: result.upload_url,
        stage: 'upload',
      };
    }
    if (record.stage === 'upload') {
      const r = await fetch(record.upload_url, {
        method: 'POST',
        signal: AbortSignal.timeout(12000),
        headers: { Authorization: `OAuth ${tok}`, file_url: first.url },
      });
      const result = await r.json();
      if (!r.ok || result.error || !result.success)
        throw new Error(result.error?.message || 'L-upload tal-video ma rnexxiex.');
      return { ...record, stage: 'finish' };
    }
    return publish({ ...record, object: 'video' }, save, async () => {
      const result = await graph(`${page}/${edge}`, tok, {
        upload_phase: 'finish',
        video_id: record.video_id,
        video_state: 'PUBLISHED',
        description: post.caption,
      });
      if (!result.success) throw new Error('Il-pubblikazzjoni tal-video ma ġietx ikkonfermata.');
      return { id: record.video_id };
    });
  }
  if (post.content_type === 'story') {
    if (!record.photo_id) {
      const uploaded = await graph(`${page}/photos`, tok, { url: first.url, published: false });
      if (!uploaded.id) throw new Error('L-upload tar-ritratt ma rnexxiex.');
      return { state: 'preparing', photo_id: uploaded.id };
    }
    return publish(record, save, () => graph(`${page}/photo_stories`, tok, { photo_id: record.photo_id }));
  }

  const native = new Date(post.scheduled_time).getTime() > Date.now() + 10 * 60000;
  const extra = native
    ? { published: false, scheduled_publish_time: Math.floor(Date.parse(post.scheduled_time) / 1000) }
    : {};
  if (first?.type.startsWith('video/')) {
    // Ordinary feed videos are separate from Reels.
    return publish({ ...record, native, object: 'video' }, save, () =>
      graph(`${page}/videos`, tok, { file_url: first.url, description: post.caption, ...extra }),
    );
  }
  let attached = record.attached || [];
  if (attached.length < media.length) {
    const m = media[attached.length];
    {
      const uploaded = await graph(`${page}/photos`, tok, { url: m.url, published: false });
      if (!uploaded.id) throw new Error('L-upload tar-ritratt ma rnexxiex.');
      attached.push({ media_fbid: uploaded.id });
    }
    return { state: 'preparing', attached };
  }
  return publish({ ...record, native }, save, () =>
    graph(`${page}/feed`, tok, {
      message: post.caption,
      ...(attached.length ? { attached_media: attached } : {}),
      ...extra,
    }),
  );
}
