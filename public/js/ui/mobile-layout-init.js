import { initOffcanvasSidebar } from './offcanvasSidebar.js';

const HEADER_SELECTOR = '.main > header, .main-content > .header, .main-content > header, .main header, .main-content .header, header.header';
const MAIN_SELECTOR = '.main-content, .main';
const CARD_GRID_SELECTOR = '.stats, .stats-grid';

function wrapTablesForMobile() {
  document.querySelectorAll('table').forEach((table) => {
    if (table.closest('.table-scroll')) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';

    table.parentNode.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
}

function markResponsiveCardGrids() {
  document.querySelectorAll(CARD_GRID_SELECTOR).forEach((container) => {
    container.classList.add('responsive-cards-grid');
  });
}

function markStudentDashboardTableSection() {
  const dailyReportsTable = document.getElementById('dailyReportsTbody') || document.getElementById('todayReportsTable');
  if (!dailyReportsTable) {
    return;
  }

  const tableWrapper = dailyReportsTable.closest('.table-wrapper');
  if (!tableWrapper) {
    return;
  }

  tableWrapper.classList.add('daily-reports-wrapper');

  const sectionTitle = tableWrapper.previousElementSibling;
  if (sectionTitle && /^H[1-6]$/.test(sectionTitle.tagName)) {
    sectionTitle.classList.add('daily-reports-heading');
  }
}

function ensureHamburgerInHeader(header) {
  let hamburger = header.querySelector('[data-sidebar-toggle]');
  if (hamburger) {
    return hamburger;
  }

  const existingGlobalToggle = document.querySelector('.mobile-menu-toggle');
  if (existingGlobalToggle && !header.contains(existingGlobalToggle)) {
    existingGlobalToggle.removeAttribute('onclick');
    existingGlobalToggle.setAttribute('type', 'button');
    existingGlobalToggle.setAttribute('data-sidebar-toggle', '1');
    existingGlobalToggle.classList.add('mobile-menu-toggle');
    header.insertBefore(existingGlobalToggle, header.firstElementChild);
    return existingGlobalToggle;
  }

  hamburger = document.createElement('button');
  hamburger.type = 'button';
  hamburger.className = 'mobile-menu-toggle';
  hamburger.setAttribute('data-sidebar-toggle', '1');
  hamburger.setAttribute('aria-label', 'Open sidebar menu');
  hamburger.innerHTML = '<i class="fa-solid fa-bars"></i>';

  header.insertBefore(hamburger, header.firstElementChild);
  return hamburger;
}

function normalizeHeader(header) {
  header.classList.add('mobile-ready-header');

  const headerActions = header.querySelector('.user-info, .header-actions');
  if (headerActions) {
    headerActions.classList.add('mobile-header-actions');
  }
}

function initSidebarUx() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  const main = document.querySelector(MAIN_SELECTOR);
  const header = (main && main.querySelector('header, .header')) || document.querySelector(HEADER_SELECTOR);
  if (!header) {
    return;
  }

  normalizeHeader(header);
  const hamburger = ensureHamburgerInHeader(header);

  initOffcanvasSidebar({
    hamburgerSelector: '[data-sidebar-toggle]',
    sidebarSelector: '.sidebar',
    overlayId: 'sidebarOverlay',
    closeOnNavSelector: 'a, button, .nav-item, li',
    mobileBreakpoint: 1023,
  });

  if (hamburger && !header.contains(hamburger)) {
    header.insertBefore(hamburger, header.firstElementChild);
  }
}

function initGlobalMobileUx() {
  if (document.body.dataset.mobileUxInit === '1') {
    return;
  }
  document.body.dataset.mobileUxInit = '1';

  wrapTablesForMobile();
  markResponsiveCardGrids();
  markStudentDashboardTableSection();
  initSidebarUx();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGlobalMobileUx);
} else {
  initGlobalMobileUx();
}
