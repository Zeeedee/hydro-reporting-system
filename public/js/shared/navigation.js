/**
 * Navigation Utility
 * Provides SPA-like instant navigation using fetch
 */

import { logError } from './logger.js';

/**
 * Navigate to a new page without full reload (if same origin)
 * Falls back to normal navigation for external links
 * @param {string} url - URL to navigate to
 * @param {Object} options - Navigation options
 */
export async function navigateTo(url, options = {}) {
    const {
        pushState = true,
        scrollTop = true,
        fadeTransition = true
    } = options;

    try {
        // Check if same origin
        const targetUrl = new URL(url, window.location.origin);
        if (targetUrl.origin !== window.location.origin) {
            window.location.href = url;
            return;
        }

        // Show loading state
        document.body.classList.add('navigating');

        // Fetch new page content
        const response = await fetch(url);
        if (!response.ok) throw new Error('Navigation failed');

        const html = await response.text();
        const parser = new DOMParser();
        const newDoc = parser.parseFromString(html, 'text/html');

        // Fade out transition
        if (fadeTransition) {
            document.body.style.opacity = '0';
            await new Promise(r => setTimeout(r, 150));
        }

        // Replace content
        const mainContent = document.querySelector('main, .main-content, #app');
        const newContent = newDoc.querySelector('main, .main-content, #app');

        if (mainContent && newContent) {
            mainContent.innerHTML = newContent.innerHTML;
        } else {
            // Fallback - replace entire body
            document.body.innerHTML = newDoc.body.innerHTML;
        }

        // Update title
        document.title = newDoc.title;

        // Update active nav state
        updateActiveNav(url);

        // Push to history
        if (pushState) {
            history.pushState({ url }, '', url);
        }

        // Scroll to top
        if (scrollTop) {
            window.scrollTo(0, 0);
        }

        // Fade in
        if (fadeTransition) {
            document.body.style.opacity = '1';
        }

        // Re-run any inline scripts
        executeScripts(document.body);

    } catch (error) {
        logError('Navigation error:', error);
        // Fallback to normal navigation
        window.location.href = url;
    } finally {
        document.body.classList.remove('navigating');
    }
}

/**
 * Initialize navigation event listeners
 * Intercepts clicks on internal links for instant navigation
 * @param {Object} options - Configuration options
 */
export function initNavigation(options = {}) {
    const {
        linkSelector = 'a[href^="/"], a[href^="./"], a[href^="../"]',
        excludeSelector = '[data-no-instant], [target="_blank"]'
    } = options;

    // Handle link clicks
    document.addEventListener('click', (e) => {
        const link = e.target.closest(linkSelector);

        if (!link) return;
        if (link.matches(excludeSelector)) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;

        e.preventDefault();
        navigateTo(link.href);
    });

    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
        if (e.state?.url) {
            navigateTo(e.state.url, { pushState: false });
        }
    });

    // Set initial state
    history.replaceState({ url: window.location.href }, '', window.location.href);
}

/**
 * Update active navigation link styling
 * @param {string} currentUrl - Current page URL
 */
function updateActiveNav(currentUrl) {
    const path = new URL(currentUrl, window.location.origin).pathname;

    // Remove all active classes
    document.querySelectorAll('.nav-item.active, .sidebar-link.active').forEach(el => {
        el.classList.remove('active');
    });

    // Add active class to matching links
    document.querySelectorAll(`a[href="${path}"], a[href=".${path}"]`).forEach(el => {
        el.classList.add('active');
        el.closest('.nav-item, .sidebar-link')?.classList.add('active');
    });
}

/**
 * Execute scripts in the given element
 * @param {HTMLElement} container - Container with scripts to execute
 */
function executeScripts(container) {
    const scripts = container.querySelectorAll('script');

    scripts.forEach(oldScript => {
        // Skip module scripts (they auto-execute)
        if (oldScript.type === 'module') return;

        const newScript = document.createElement('script');

        // Copy attributes
        Array.from(oldScript.attributes).forEach(attr => {
            newScript.setAttribute(attr.name, attr.value);
        });

        // Copy content
        newScript.textContent = oldScript.textContent;

        // Replace script to make it execute
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

/**
 * Preload a page for faster navigation
 * @param {string} url - URL to preload
 */
export function preloadPage(url) {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
}
