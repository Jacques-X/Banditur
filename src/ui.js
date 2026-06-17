export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function openModal(modal) {
  if (!modal) return;
  modal.style.display = 'flex';
  requestAnimationFrame(() => {
    modal.querySelector('input, select, textarea, button:not([disabled])')?.focus();
  });
}

export function closeModal(modal) {
  if (modal) modal.style.display = 'none';
}

export function renderState({ tone = 'muted', title, body = '', action = '' }) {
  return `
    <div class="ui-state ui-state-${escapeHtml(tone)}">
      <div class="ui-state-mark" aria-hidden="true"></div>
      <div class="ui-state-copy">
        <div class="ui-state-title">${escapeHtml(title)}</div>
        ${body ? `<div class="ui-state-body">${escapeHtml(body)}</div>` : ''}
      </div>
      ${action}
    </div>`;
}

export function renderTableState({ tone = 'muted', title, body = '', colspan = 6 }) {
  return `<tr class="table-state-row"><td colspan="${colspan}">${renderState({ tone, title, body })}</td></tr>`;
}

export function renderStatus(msg, type = 'info') {
  return `
    <div class="status-banner status-banner-${escapeHtml(type)}">
      <span class="status-banner-dot" aria-hidden="true"></span>
      <span>${escapeHtml(msg)}</span>
    </div>`;
}

export function setButtonLoading(button, loading, label) {
  if (!button) return;
  if (loading) {
    button.dataset.previousLabel = button.textContent;
    button.disabled = true;
    button.classList.add('is-loading');
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.previousLabel) button.textContent = button.dataset.previousLabel;
    delete button.dataset.previousLabel;
  }
}

export function renderToast(msg, type = 'info') {
  const titles = {
    ok: 'Lest',
    error: 'Problema',
    warn: 'Attenzjoni',
    info: 'Informazzjoni',
  };
  return `
    <div class="toast-accent-circle" aria-hidden="true"></div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(titles[type] || titles.info)}</div>
      <div class="toast-desc">${escapeHtml(msg)}</div>
    </div>`;
}

export function renderPreviewCard({ platform, profileName, initials, scheduledLabel, caption, mediaHtml = '' }) {
  return `
    <article class="preview-card preview-card-${escapeHtml(platform)}">
      <div class="preview-card-hdr">
        <div class="preview-avatar">${escapeHtml(initials)}</div>
        <div>
          <div class="preview-page-name">${escapeHtml(profileName || 'Profil')}</div>
          <div class="preview-plat-lbl">${escapeHtml(platform)}${scheduledLabel ? ` · ${escapeHtml(scheduledLabel)}` : ''}</div>
        </div>
      </div>
      ${caption ? `<div class="preview-caption">${escapeHtml(caption)}</div>` : '<div class="preview-caption preview-caption-empty">Ebda kaption s\'issa.</div>'}
      ${mediaHtml}
    </article>`;
}

export function renderArchiveThumb(url) {
  return url
    ? `<img src="${escapeHtml(url)}" class="thumb-img" alt="" loading="lazy" />`
    : '<div class="thumb-placeholder" aria-hidden="true"></div>';
}
