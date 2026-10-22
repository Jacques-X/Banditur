<script>
  import { post, problems } from './composer.svelte.js';
  import { platformById } from '../../platforms.js';
  import { app, profileName } from '../../lib/app.svelte.js';
  import { shortDateTime } from '../../lib/format.js';

  let which = $state('ig');
  const shown = $derived(post.platforms.includes(which) ? which : (post.platforms[0] || 'ig'));
  const tall = $derived(post.contentType !== 'post');
  const handle = $derived(profileName().toLowerCase().replace(/[^a-z0-9ħġċż]+/g, '.').replace(/^\.|\.$/g, '') || 'kumitat');
  const cut = $derived(platformById(shown)?.previewCut);
  const text = $derived(post.caption.trim());
  const truncated = $derived(cut && text.length > cut);

  let url = $state('');
  $effect(() => {
    const f = post.media[0];
    if (!f) { url = ''; return; }
    const u = URL.createObjectURL(f);
    url = u;
    return () => URL.revokeObjectURL(u);
  });
  const isVideo = $derived(post.media[0]?.type.startsWith('video/'));
  const issue = $derived(problems());
  const needMedia = $derived(!post.media.length && post.contentType !== 'post');
</script>

<div class="pv">
  <div class="card" class:tall>
    <div class="who">
      <span class="avatar" aria-hidden="true">{profileName().slice(0, 1)}</span>
      <span class="name">{shown === 'ig' ? handle : profileName()}</span>
      <span class="spacer"></span>
      <span class="muted small">{tall ? '9:16' : post.media.length > 1 ? `1 / ${post.media.length}` : post.media.length ? '4:5' : ''}</span>
    </div>
    <div class="media">
      {#if url}
        {#if isVideo}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={url} muted preload="metadata"></video>
        {:else}
          <img src={url} alt="" />
        {/if}
      {:else}
        <span class="ph">L-ewwel ritratt jidher hawn</span>
      {/if}
    </div>
    {#if text || !tall}
      <p class="caption">
        {#if shown === 'ig'}<b>{handle}</b>{' '}{/if}{#if text}{truncated ? text.slice(0, cut).trimEnd() + '… ' : text}{#if truncated}<span class="muted">aktar</span>{/if}{:else}<span class="muted">Il-kaption tidher hawn.</span>{/if}
      </p>
    {/if}
    <div class="when muted small">{post.scheduledTime ? `${shortDateTime(post.scheduledTime)} · ħin ta' Malta` : 'L-ebda ħin magħżul'}</div>
  </div>

  <div class="seg switch" role="group" aria-label="Preview għal">
    <button type="button" aria-pressed={shown === 'ig'} disabled={!post.platforms.includes('ig')} onclick={() => (which = 'ig')}>Instagram</button>
    <button type="button" aria-pressed={shown === 'fb'} disabled={!post.platforms.includes('fb')} onclick={() => (which = 'fb')}>Facebook</button>
  </div>

  <ul class="checks" aria-label="Verifika qabel ma tiskeda">
    <li class:bad={!post.platforms.length}>{post.platforms.length ? '✓' : '!'} {post.platforms.length ? `Jitla' fuq ${post.platforms.map(id => platformById(id)?.label).join(' u ')}` : 'Agħżel pjattaforma'}</li>
    <li class:bad={!!issue || needMedia}>{issue || needMedia ? '!' : '✓'} {issue || (post.media.length ? 'Il-midja taqbel mat-tip tal-post' : needMedia ? `${post.contentType === 'reel' ? 'Reel jeħtieġ video' : 'Storja teħtieġ ritratt jew video'}` : 'Post bil-kaption biss')}</li>
    {#if post.platforms.includes('fb')}<li>✓ Facebook jiskedah Meta stess (sa 30 jum qabel)</li>{/if}
    {#if tall}<li>✓ {post.contentType === 'reel' ? 'Reel' : 'Storja'} tidher bil-wieqfa (9:16) — żomm l-importanti f'nofs il-frame</li>{/if}
  </ul>
</div>

<style>
  .pv { display: flex; flex-direction: column; gap: 12px; }
  .card { background: var(--card); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  :global(:root[data-theme="dark"]) .card { background: #FFFFFF; color: #1C1D20; }
  .who { display: flex; align-items: center; gap: 8px; padding: 9px 12px; }
  .avatar { width: 24px; height: 24px; border-radius: 12px; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
  .name { font-weight: 600; }
  .media { aspect-ratio: 4 / 5; max-height: 330px; width: 100%; background: var(--track); display: grid; place-items: center; overflow: hidden; }
  .tall .media { aspect-ratio: 9 / 16; max-height: 340px; }
  .media img, .media video { width: 100%; height: 100%; object-fit: cover; }
  .ph { color: var(--muted); font-size: 12px; }
  .caption { padding: 10px 12px 4px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
  .when { padding: 4px 12px 10px; }
  .switch { align-self: center; }
  .switch button:disabled { opacity: .45; }
  .checks { list-style: none; margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--bg-sunken); display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--fg-2); }
  .checks li::first-letter { color: var(--ok); font-weight: 700; }
  .checks li.bad { color: var(--warn-fg); }
  .checks li.bad::first-letter { color: var(--warn); }
</style>
