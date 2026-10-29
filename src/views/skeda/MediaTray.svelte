<script>
  import Icon from '../../components/Icon.svelte';
  import { post, addMedia, removeMedia, moveMedia, MAX_POST_MEDIA, changed } from './composer.svelte.js';
  import { openTool } from '../../lib/app.svelte.js';

  let { ondrive } = $props();
  let input;
  let over = $state(false);
  let dragFrom = -1;

  // One object URL per file, released when the list changes.
  let urls = $state([]);
  $effect(() => {
    const list = post.media.map(f => URL.createObjectURL(f));
    urls = list;
    return () => list.forEach(u => URL.revokeObjectURL(u));
  });

  const note = $derived(
    post.contentType === 'reel' ? 'Reel: video wieħed biss (9:16)'
      : post.contentType === 'story' ? 'Story: ritratt jew video wieħed (9:16)'
      : `${post.media.length+post.remoteMedia.length} minn ${MAX_POST_MEDIA} ritratti${post.media.length > 1 ? ' · iġbed biex tbiddel l-ordni' : ''}`,
  );

  function drop(e) {
    e.preventDefault();
    over = false;
    if (dragFrom >= 0) return;
    if (e.dataTransfer?.files?.length) addMedia([...e.dataTransfer.files]);
  }
</script>

<div class="media">
  <div class="head">
    <span class="label">Media</span>
    <span class="muted small">{note}</span>
    <span class="spacer"></span>
    <button class="link" type="button" onclick={ondrive}>Minn Google Drive</button>
    <button class="link" type="button" onclick={() => openTool('posts')}>Minn Posts</button>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="tray" class:over ondragover={e => { e.preventDefault(); if (dragFrom < 0) over = true; }} ondragleave={() => (over = false)} ondrop={drop}>
    {#each post.remoteMedia as f,i (f.path)}
      <div class="tile" role="listitem">
        {#if f.type.startsWith('video/')}<video src={f.url} muted preload="metadata"></video>{:else}<img src={f.url} alt="Medjum issejvjat" />{/if}
        <button class="rm" type="button" aria-label="Neħħi" onclick={() => {post.remoteMedia.splice(i,1);changed();}}><Icon name="x" size={12}/></button>
      </div>
    {/each}
    {#each post.media as f, i (f)}
      <div class="tile" draggable="true" role="listitem"
           ondragstart={() => (dragFrom = i)} ondragend={() => (dragFrom = -1)}
           ondragover={e => e.preventDefault()}
           ondrop={e => { e.preventDefault(); e.stopPropagation(); if (dragFrom >= 0 && dragFrom !== i) moveMedia(dragFrom, i); dragFrom = -1; }}>
        {#if f.type.startsWith('video/')}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video src={urls[i]} muted preload="metadata"></video>
          <span class="kind">VIDEO</span>
        {:else}
          <img src={urls[i]} alt={f.name} />
        {/if}
        <span class="n mono">{String(i + 1).padStart(2, '0')}</span>
        <button class="rm" type="button" aria-label="Neħħi {f.name}" title="Neħħi" onclick={() => removeMedia(i)}><Icon name="x" size={12} stroke={2.5} /></button>
      </div>
    {/each}
    {#if post.contentType === 'post' ? post.media.length + post.remoteMedia.length < MAX_POST_MEDIA : post.media.length + post.remoteMedia.length < 1}
      <button class="add" type="button" onclick={() => input.click()}>
        <Icon name="plus" size={20} />
        <span>Żid jew waqqa'</span>
      </button>
    {/if}
  </div>
  <input bind:this={input} type="file" multiple accept="image/*,video/*" hidden
         onchange={e => { addMedia([...e.currentTarget.files]); e.currentTarget.value = ''; }} />
</div>

<style>
  .media { display: flex; flex-direction: column; gap: 8px; }
  .head { display: flex; align-items: baseline; gap: 10px; }
  .head .link { font-size: 12px; }
  .tray { display: flex; flex-wrap: wrap; gap: 10px; border-radius: 10px; padding: 2px; }
  .tray.over { outline: 2px dashed var(--accent); outline-offset: 4px; }
  .tile, .add { width: 100px; height: 100px; border-radius: 8px; flex-shrink: 0; }
  .tile { position: relative; overflow: hidden; background: var(--track); cursor: grab; }
  .tile img, .tile video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .n { position: absolute; left: 6px; bottom: 5px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
  .kind { position: absolute; left: 6px; top: 6px; font-size: 10px; font-weight: 700; color: #fff; background: rgba(0,0,0,.55); padding: 1px 5px; border-radius: 4px; }
  .rm { position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border-radius: 11px; border: 0; background: rgba(0,0,0,.6); color: #fff; display: grid; place-items: center; opacity: 0; transition: opacity .12s; }
  .tile:hover .rm, .rm:focus-visible { opacity: 1; }
  .add { border: 1.5px dashed var(--line-strong); background: var(--bg-sunken); color: var(--fg-2); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 12px; }
  .add:hover { border-color: var(--accent); color: var(--accent-fg); }
</style>
