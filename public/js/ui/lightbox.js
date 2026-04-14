// HYDRO shared lightbox (no framework). Reusable across pages.
// Usage:
// - Add `data-hydro-lightbox` on clickable elements (img/button/etc)
// - Provide `data-lightbox-src` (full-res URL) and optional `data-lightbox-group`.
// - Call `initHydroLightbox()` once per page.

let lightboxReady = false;
let currentGroup = '';
let currentItems = [];
let currentIndex = 0;

function ensureStyles() {
  if (document.getElementById('hydroLightboxStyles')) return;

  const style = document.createElement('style');
  style.id = 'hydroLightboxStyles';
  style.textContent = `
    .hydro-lightbox {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.86);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      z-index: 5000;
    }
    .hydro-lightbox.is-open {
      display: flex;
    }
    .hydro-lightbox-inner {
      position: relative;
      max-width: 980px;
      width: 100%;
      max-height: 85vh;
    }
    .hydro-lightbox-img {
      width: 100%;
      height: auto;
      max-height: 85vh;
      object-fit: contain;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.04);
    }
    .hydro-lightbox-btn {
      position: absolute;
      top: -14px;
      width: 42px;
      height: 42px;
      border-radius: 999px;
      border: 0;
      cursor: pointer;
      background: #fff;
      color: #0f172a;
      font-size: 1.05rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 12px 30px rgba(0,0,0,0.25);
    }
    .hydro-lightbox-close {
      right: -14px;
    }
    .hydro-lightbox-prev {
      left: -14px;
      top: calc(50% - 21px);
    }
    .hydro-lightbox-next {
      right: -14px;
      top: calc(50% - 21px);
    }
    .hydro-lightbox-counter {
      position: absolute;
      left: 0;
      right: 0;
      bottom: -40px;
      text-align: center;
      color: rgba(255, 255, 255, 0.9);
      font-size: 0.85rem;
      font-weight: 700;
    }
    @media (max-width: 640px) {
      .hydro-lightbox-prev { left: 6px; }
      .hydro-lightbox-next { right: 6px; }
      .hydro-lightbox-close { right: 6px; }
    }
  `;
  document.head.appendChild(style);
}

function ensureMarkup() {
  if (document.getElementById('hydroLightbox')) return;

  document.body.insertAdjacentHTML(
    'beforeend',
    `
      <div class="hydro-lightbox" id="hydroLightbox" aria-hidden="true">
        <div class="hydro-lightbox-inner">
          <button type="button" class="hydro-lightbox-btn hydro-lightbox-close" id="hydroLightboxClose" aria-label="Close">&times;</button>
          <button type="button" class="hydro-lightbox-btn hydro-lightbox-prev" id="hydroLightboxPrev" aria-label="Previous">&#8249;</button>
          <button type="button" class="hydro-lightbox-btn hydro-lightbox-next" id="hydroLightboxNext" aria-label="Next">&#8250;</button>
          <img class="hydro-lightbox-img" id="hydroLightboxImg" alt="Image" />
          <div class="hydro-lightbox-counter" id="hydroLightboxCounter"></div>
        </div>
      </div>
    `
  );
}

function getGroupItems(group) {
  if (!group) {
    return [];
  }
  const nodes = Array.from(document.querySelectorAll(`[data-lightbox-group="${CSS.escape(group)}"]`));
  return nodes
    .map((node) => String(node.getAttribute('data-lightbox-src') || ''))
    .filter(Boolean);
}

function setNavVisibility(prevBtn, nextBtn, counter, items) {
  const multiple = Array.isArray(items) && items.length > 1;
  if (prevBtn) prevBtn.style.display = multiple ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.style.display = multiple ? 'inline-flex' : 'none';
  if (counter) {
    counter.textContent = multiple ? `${currentIndex + 1} / ${items.length}` : '';
  }
}

function renderCurrent() {
  const root = document.getElementById('hydroLightbox');
  const img = document.getElementById('hydroLightboxImg');
  const counter = document.getElementById('hydroLightboxCounter');
  const prevBtn = document.getElementById('hydroLightboxPrev');
  const nextBtn = document.getElementById('hydroLightboxNext');

  if (!root || !img) return;
  const src = currentItems[currentIndex] || '';
  img.src = src;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  setNavVisibility(prevBtn, nextBtn, counter, currentItems);
}

function closeLightbox() {
  const root = document.getElementById('hydroLightbox');
  const img = document.getElementById('hydroLightboxImg');
  if (!root || !img) return;
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  img.src = '';
  currentGroup = '';
  currentItems = [];
  currentIndex = 0;
}

function clampIndex(idx, length) {
  if (length <= 0) return 0;
  const n = Number(idx);
  if (!Number.isFinite(n)) return 0;
  return ((Math.floor(n) % length) + length) % length;
}

function goNext() {
  if (!currentItems.length) return;
  currentIndex = clampIndex(currentIndex + 1, currentItems.length);
  renderCurrent();
}

function goPrev() {
  if (!currentItems.length) return;
  currentIndex = clampIndex(currentIndex - 1, currentItems.length);
  renderCurrent();
}

function openLightbox({ src, group, index } = {}) {
  const source = String(src || '').trim();
  if (!source) return;

  currentGroup = String(group || '').trim();
  currentItems = currentGroup ? getGroupItems(currentGroup) : [source];
  if (!currentItems.length) {
    currentItems = [source];
  }

  const idx = typeof index === 'number' ? index : currentItems.indexOf(source);
  currentIndex = clampIndex(idx >= 0 ? idx : 0, currentItems.length);
  renderCurrent();
}

function bindHandlersOnce() {
  if (lightboxReady) return;
  lightboxReady = true;

  document.addEventListener('click', (event) => {
    const target = event.target;
    const trigger = target && target.closest ? target.closest('[data-hydro-lightbox]') : null;
    if (!trigger) {
      const overlay = target && target.id === 'hydroLightbox' ? target : null;
      if (overlay) {
        closeLightbox();
      }
      return;
    }

    const src = trigger.getAttribute('data-lightbox-src') || (trigger.tagName === 'IMG' ? trigger.getAttribute('src') : '');
    const group = trigger.getAttribute('data-lightbox-group') || '';
    openLightbox({ src, group });
  });

  document.addEventListener('keydown', (event) => {
    const root = document.getElementById('hydroLightbox');
    const isOpen = root && root.classList.contains('is-open');
    if (!isOpen) return;

    if (event.key === 'Escape') {
      closeLightbox();
      return;
    }
    if (event.key === 'ArrowRight') {
      goNext();
      return;
    }
    if (event.key === 'ArrowLeft') {
      goPrev();
    }
  });

  const closeBtn = document.getElementById('hydroLightboxClose');
  if (closeBtn) closeBtn.addEventListener('click', closeLightbox);

  const prevBtn = document.getElementById('hydroLightboxPrev');
  if (prevBtn) prevBtn.addEventListener('click', goPrev);

  const nextBtn = document.getElementById('hydroLightboxNext');
  if (nextBtn) nextBtn.addEventListener('click', goNext);
}

export function initHydroLightbox() {
  ensureStyles();
  ensureMarkup();
  bindHandlersOnce();
}

export function registerLightboxImages(selector = 'img[data-hydro-lightbox]') {
  // Optional helper to set cursor pointer.
  document.querySelectorAll(selector).forEach((img) => {
    try {
      img.style.cursor = 'pointer';
    } catch (_) {
    }
  });
}

export function openHydroLightbox(items, index = 0) {
  if (!Array.isArray(items) || !items.length) return;
  currentGroup = '';
  currentItems = items.map((v) => String(v || '').trim()).filter(Boolean);
  currentIndex = clampIndex(index, currentItems.length);
  renderCurrent();
}
