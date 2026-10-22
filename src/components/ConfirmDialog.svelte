<script>
  import Modal from './Modal.svelte';
  import { confirmState, answerConfirm } from '../lib/app.svelte.js';
</script>

{#if confirmState.open}
  <Modal width={440} onclose={() => answerConfirm(false)}>
    <p class="msg">{confirmState.message}</p>
    {#snippet footer()}
      <button class="btn" type="button" onclick={() => answerConfirm(false)}>{confirmState.no}</button>
      <!-- svelte-ignore a11y_autofocus -->
      <button class="btn {confirmState.danger ? 'danger' : 'primary'}" type="button" autofocus={!confirmState.danger} onclick={() => answerConfirm(true)}>{confirmState.yes}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .msg { font-size: 14px; line-height: 1.5; white-space: pre-line; padding-top: 4px; }
</style>
