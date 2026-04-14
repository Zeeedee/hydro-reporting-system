const INIT_KEY = '__hydroActiveNavInit__';

function parseOnclickPath(value) {
  if (!value) {
    return null;
  }
  const match = value.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  return match ? match[1] : null;
}

function normalizePath(rawPath) {
  if (!rawPath) {
    return null;
  }

  const trimmed = String(rawPath).trim();
  if (!trimmed || trimmed === '#' || trimmed.toLowerCase().startsWith('javascript:')) {
    return null;
  }

  let url;
  try {
    url = new URL(trimmed, window.location.href);
  } catch (error) {
    return null;
  }

  let pathname = url.pathname || '/';
  pathname = pathname.replace(/\/+/g, '/');

  if (pathname === '/') {
    pathname = '/index.html';
  } else if (pathname.endsWith('/')) {
    pathname = `${pathname}index.html`;
  } else {
    const lastSegment = pathname.split('/').pop() || '';
    if (!/\.[a-z0-9]+$/i.test(lastSegment)) {
      pathname = `${pathname}/index.html`;
      pathname = pathname.replace(/\/+/g, '/');
    }
  }

  return decodeURIComponent(pathname).toLowerCase();
}

function getNavCandidatePaths(item) {
  const candidates = [];

  const dataPath = item.getAttribute('data-nav-path');
  if (dataPath) {
    dataPath
      .split(',')
      .map((part) => normalizePath(part))
      .filter(Boolean)
      .forEach((path) => candidates.push(path));
  }

  const href = item.getAttribute('href');
  if (href) {
    const path = normalizePath(href);
    if (path) candidates.push(path);
  }

  const onclick = parseOnclickPath(item.getAttribute('onclick'));
  if (onclick) {
    const path = normalizePath(onclick);
    if (path) candidates.push(path);
  }

  const nestedLink = item.querySelector('a[href]');
  if (nestedLink) {
    const nestedPath = normalizePath(nestedLink.getAttribute('href'));
    if (nestedPath) candidates.push(nestedPath);
  }

  return Array.from(new Set(candidates));
}

function setActiveNav() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    return;
  }

  const navItems = Array.from(sidebar.querySelectorAll('.nav-item'));
  if (!navItems.length) {
    return;
  }

  const currentPath = normalizePath(window.location.pathname);
  if (!currentPath) {
    return;
  }

  const matched = navItems.find((item) => {
    const paths = getNavCandidatePaths(item);
    return paths.includes(currentPath);
  });

  if (!matched) {
    return;
  }

  navItems.forEach((item) => {
    item.classList.remove('active', 'is-active');
    const parentLi = item.closest('li');
    if (parentLi && parentLi !== item) {
      parentLi.classList.remove('active', 'is-active');
    }
  });

  matched.classList.add('active', 'is-active');
  const matchedParent = matched.closest('li');
  if (matchedParent && matchedParent !== matched) {
    matchedParent.classList.add('is-active');
  }
}

function initActiveNav() {
  if (window[INIT_KEY]) {
    return;
  }
  window[INIT_KEY] = true;
  setActiveNav();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initActiveNav, { once: true });
} else {
  initActiveNav();
}
