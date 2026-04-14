const initializedSidebars = new WeakMap();

function ensureOverlay(overlayId) {
  let overlay = document.getElementById(overlayId);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.className = 'sidebar-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
  }
  return overlay;
}

export function initOffcanvasSidebar(options = {}) {
  const hamburgerSelector = options.hamburgerSelector || '[data-sidebar-toggle], .mobile-menu-toggle';
  const sidebarSelector = options.sidebarSelector || '.sidebar';
  const overlayId = options.overlayId || 'sidebarOverlay';
  const closeOnNavSelector = options.closeOnNavSelector || 'a, button';
  const openClass = options.openClass || 'sidebar-open';
  const mobileBreakpoint = Number(options.mobileBreakpoint || 1023);

  const sidebar = document.querySelector(sidebarSelector);
  const hamburger = document.querySelector(hamburgerSelector);
  if (!sidebar || !hamburger) {
    return null;
  }

  const existing = initializedSidebars.get(sidebar);
  if (existing) {
    return existing.api;
  }

  if (!sidebar.id) {
    sidebar.id = `offcanvasSidebar-${Math.random().toString(36).slice(2, 9)}`;
  }

  const overlay = ensureOverlay(overlayId);

  const isMobile = () => window.innerWidth <= mobileBreakpoint;

  const closeSidebar = () => {
    document.body.classList.remove(openClass);
    overlay.setAttribute('aria-hidden', 'true');
    hamburger.setAttribute('aria-expanded', 'false');
  };

  const openSidebar = () => {
    if (!isMobile()) {
      return;
    }
    document.body.classList.add(openClass);
    overlay.setAttribute('aria-hidden', 'false');
    hamburger.setAttribute('aria-expanded', 'true');
  };

  const toggleSidebar = () => {
    if (document.body.classList.contains(openClass)) {
      closeSidebar();
    } else {
      openSidebar();
    }
  };

  const onHamburgerClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSidebar();
  };

  const onOverlayClick = (event) => {
    event.preventDefault();
    closeSidebar();
  };

  const onSidebarClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest(closeOnNavSelector)) {
      return;
    }
    closeSidebar();
  };

  const onDocumentKeydown = (event) => {
    if (event.key === 'Escape') {
      closeSidebar();
    }
  };

  const onWindowResize = () => {
    if (!isMobile()) {
      closeSidebar();
    }
  };

  hamburger.removeAttribute('onclick');
  hamburger.setAttribute('aria-controls', sidebar.id);
  hamburger.setAttribute('aria-expanded', 'false');
  if (!hamburger.getAttribute('aria-label')) {
    hamburger.setAttribute('aria-label', 'Toggle navigation menu');
  }

  hamburger.addEventListener('click', onHamburgerClick);
  overlay.addEventListener('click', onOverlayClick);
  sidebar.addEventListener('click', onSidebarClick);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('resize', onWindowResize);

  const cleanup = () => {
    hamburger.removeEventListener('click', onHamburgerClick);
    overlay.removeEventListener('click', onOverlayClick);
    sidebar.removeEventListener('click', onSidebarClick);
    document.removeEventListener('keydown', onDocumentKeydown);
    window.removeEventListener('resize', onWindowResize);
    closeSidebar();
    initializedSidebars.delete(sidebar);
  };

  const api = {
    open: openSidebar,
    close: closeSidebar,
    toggle: toggleSidebar,
    destroy: cleanup,
  };

  initializedSidebars.set(sidebar, { api });

  return api;
}
