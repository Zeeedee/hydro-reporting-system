/**
 * HYDRO - SPA Router Module
 * 
 * Enables SPA-like navigation without full page reloads.
 * Uses History API + AJAX to swap main content area.
 * 
 * Features:
 * - Intercepts ALL same-origin navigation clicks
 * - Loads page content via fetch() and swaps main content
 * - Updates browser history (back/forward support)
 * - Provides smooth fade transitions
 * - Re-executes inline scripts after content swap
 * - Falls back to normal navigation on error
 */

class HydroSpaRouter {
    constructor(options = {}) {
        // Support multiple main content selectors for different dashboard layouts
        this.mainSelectors = ['.main-content', '.main', 'main'];
        this.sidebarSelector = options.sidebarSelector || '.sidebar';
        this.loadingOverlaySelector = options.loadingOverlay || '#loadingOverlay';
        this.transitionDuration = options.transitionDuration || 100;
        this.cache = new Map();
        this.currentPath = window.location.pathname;
        this.isNavigating = false;

        // Detect which main selector works for this page
        this.mainSelector = this.detectMainSelector();

        this.init();
    }

    detectMainSelector() {
        for (const selector of this.mainSelectors) {
            if (document.querySelector(selector)) {
                return selector;
            }
        }
        return '.main-content'; // Default fallback
    }

    init() {
        // Inject transition styles
        this.injectStyles();

        // Apply page enter animation on initial load
        this.fadeIn();

        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            if (e.state?.path) {
                this.navigate(e.state.path, false);
            }
        });

        // Intercept ALL navigation clicks on the document
        document.addEventListener('click', (e) => {
            // Check for any clickable navigation element
            const link = e.target.closest('a[href], [onclick*="location.href"]');

            if (!link) return;

            const href = this.extractHref(link);

            // Only intercept same-origin, same-directory navigation (dashboard links)
            if (href && this.shouldIntercept(href)) {
                e.preventDefault();
                e.stopPropagation();
                this.navigate(href);
            }
        }, true);

        // Save initial state
        history.replaceState({ path: this.currentPath }, '', this.currentPath);

        // Intentionally quiet in production.

        // Prefetch pages on hover for faster navigation
        document.addEventListener('mouseover', (e) => {
            const link = e.target.closest('a[href], .nav-item');
            if (link) {
                const href = this.extractHref(link);
                if (href && this.shouldIntercept(href)) {
                    this.prefetch(href);
                }
            }
        });
    }

    extractHref(element) {
        // Check for href attribute first
        let href = element.getAttribute('href');
        if (href) return href;

        // Extract from onclick="location.href='...'"
        const onclick = element.getAttribute('onclick');
        if (onclick) {
            const match = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (match) return match[1];
        }
        return null;
    }

    shouldIntercept(href) {
        // Don't intercept hash links
        if (href.startsWith('#')) return false;
        if (href.startsWith('javascript:')) return false;

        // Don't intercept external links
        if (href.startsWith('http')) {
            try {
                const url = new URL(href);
                if (url.origin !== window.location.origin) return false;
            } catch {
                return false;
            }
        }

        // Don't intercept auth/bootstrap pages (requires full reload)
        if (
            href.includes('login.html') ||
            href.includes('signup.html') ||
            href.includes('auth-action.html') ||
            href.includes('bootstrap.html')
        ) {
            return false;
        }

        // Only intercept .html pages
        if (!href.endsWith('.html') && !href.endsWith('/')) {
            return false;
        }

        // If href is a simple filename without path (e.g., "reports.html"),
        // it's a same-directory relative link - ALWAYS intercept these
        if (!href.includes('/') || href.startsWith('./')) {
            // Intentionally quiet in production.
            return true;
        }

        // For absolute paths, check if we're navigating within the same dashboard area
        const currentDir = this.getDirectory(this.currentPath);
        const targetDir = this.getDirectory(href);

        const shouldIntercept = currentDir === targetDir;
        // Intentionally quiet in production.

        return shouldIntercept;
    }

    getDirectory(path) {
        // Normalize the path
        if (path.startsWith('./')) path = path.slice(2);
        if (path.startsWith('/')) path = path.slice(1);

        const parts = path.split('/');
        if (parts.length > 1) {
            return parts[0]; // Return first directory (admin, maintenance, etc)
        }
        return ''; // Root directory (student dashboard)
    }

    async navigate(path, pushState = true) {
        if (this.isNavigating) return;

        // Normalize path
        const normalizedPath = this.normalizePath(path);
        const normalizedCurrent = this.normalizePath(this.currentPath);

        if (normalizedPath === normalizedCurrent) return;

        this.isNavigating = true;
        const loadingOverlay = null;

        try {
            // Fade out current content quickly
            await this.fadeOut();

            // Fetch new page
            const html = await this.fetchPage(path);

            // Parse and extract content
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Find main content in new page (try multiple selectors)
            let newMain = null;
            for (const selector of this.mainSelectors) {
                newMain = doc.querySelector(selector);
                if (newMain) break;
            }

            const newTitle = doc.querySelector('title')?.textContent;

            if (!newMain) {
                throw new Error('Main content not found in target page');
            }

            // Update main content
            const currentMain = document.querySelector(this.mainSelector);
            if (currentMain) {
                currentMain.innerHTML = newMain.innerHTML;
            }

            // Update page title
            if (newTitle) {
                document.title = newTitle;
            }

            // Update active nav item
            this.updateActiveNav(path);

            // Update history
            if (pushState) {
                history.pushState({ path: normalizedPath }, '', path);
            }

            this.currentPath = normalizedPath;

            // Execute inline scripts from new page
            await this.executeScripts(currentMain);

            // Fade in new content
            await this.fadeIn();

            // Scroll to top
            window.scrollTo(0, 0);

            // Intentionally quiet in production.

        } catch (error) {
            // Navigation failed; fall back to full reload.
            // Fallback to regular navigation
            window.location.href = path;
        } finally {
            this.isNavigating = false;
        }
    }

    normalizePath(path) {
        // Remove ./ prefix and normalize
        if (path.startsWith('./')) path = path.slice(2);
        if (!path.startsWith('/')) {
            // Make relative path absolute based on current location
            const base = window.location.pathname.split('/').slice(0, -1).join('/');
            path = base + '/' + path;
        }
        // Normalize double slashes
        path = path.replace(/\/+/g, '/');
        return path;
    }

    async fetchPage(path) {
        // Check cache first
        const cacheKey = this.normalizePath(path);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const response = await fetch(path, {
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch ${path}: ${response.status}`);
        }

        const html = await response.text();

        // Cache the response (limit cache size)
        if (this.cache.size > 10) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(cacheKey, html);

        return html;
    }

    async executeScripts(container) {
        // Find all script tags in the new content
        const scripts = container.querySelectorAll('script');

        for (const oldScript of scripts) {
            // Create new script element
            const newScript = document.createElement('script');

            // Copy attributes
            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });

            // For inline scripts, copy content
            if (!oldScript.src && oldScript.textContent) {
                newScript.textContent = oldScript.textContent;
            }

            // Replace old script with new one to trigger execution
            if (oldScript.parentNode) {
                oldScript.parentNode.replaceChild(newScript, oldScript);
            }
        }
    }

    updateActiveNav(path) {
        const filename = path.split('/').pop() || 'index.html';
        const navItems = document.querySelectorAll('.nav-item, .sidebar a');

        navItems.forEach(item => {
            const href = this.extractHref(item);
            if (href) {
                const itemFilename = href.split('/').pop();
                if (itemFilename === filename ||
                    (filename === 'index.html' && (href === './' || href === 'index.html'))) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            }
        });
    }

    fadeOut() {
        return new Promise(resolve => {
            const main = document.querySelector(this.mainSelector);
            if (main) {
                main.style.opacity = '0';
                main.style.transform = 'translateY(-5px)';
            }
            setTimeout(resolve, this.transitionDuration);
        });
    }

    fadeIn() {
        return new Promise(resolve => {
            const main = document.querySelector(this.mainSelector);
            if (main) {
                main.style.opacity = '1';
                main.style.transform = 'translateY(0)';
            }
            setTimeout(resolve, this.transitionDuration);
        });
    }

    injectStyles() {
        if (document.getElementById('hydro-spa-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'hydro-spa-styles';
        styles.textContent = `
            .main, .main-content, main {
                transition: opacity ${this.transitionDuration}ms ease-out, 
                            transform ${this.transitionDuration}ms ease-out;
            }
            
            .loading-overlay {
                transition: opacity 0.15s ease-out;
            }
            
            .loading-overlay.hidden {
                opacity: 0;
                pointer-events: none;
            }
        `;
        document.head.appendChild(styles);
    }

    // Prefetch a page for faster navigation
    prefetch(path) {
        if (!this.cache.has(this.normalizePath(path))) {
            this.fetchPage(path).catch(() => { });
        }
    }

    // Clear cache (useful after data updates)
    clearCache() {
        this.cache.clear();
    }
}

// Auto-initialize if in browser and on a dashboard page
if (typeof window !== 'undefined') {
    // Wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.hydroRouter = new HydroSpaRouter();
        });
    } else {
        window.hydroRouter = new HydroSpaRouter();
    }
}

export { HydroSpaRouter };
export default HydroSpaRouter;
