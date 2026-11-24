<script>
  // JPEG quality and maximum size (Ritratti).
  let { id, quality = $bindable(), maxDim = $bindable(), sizes } = $props();
</script>

<div class="field">
  <label class="label lrow" for={id}>Quality <span class="spacer"></span><span class="mono muted">{quality}%</span></label>
  <input {id} type="range" min="60" max="95" bind:value={quality} />
</div>
<div class="field">
  <span class="label">Max size (px)</span>
  <div class="seg" role="group" aria-label="Max size">
    {#each sizes as [v, l]}<button type="button" aria-pressed={Number(maxDim) === v} onclick={() => (maxDim = v)}>{l}</button>{/each}
  </div>
</div>

<style>
  .lrow { display: flex; align-items: center; gap: 8px; }
</style>
