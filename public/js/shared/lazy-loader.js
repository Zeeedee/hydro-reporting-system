/**
 * Lazy Loading Utility
 * Provides intersection observer-based lazy loading for images and list items
 */

import { logError } from './logger.js';

/**
 * Create a lazy loader for images
 * Images should have data-src attribute with the actual source
 * @param {string} selector - CSS selector for lazy images
 * @param {Object} options - IntersectionObserver options
 */
export function initLazyImages(selector = 'img[data-src]', options = {}) {
    const defaultOptions = {
        root: null,
        rootMargin: '50px',
        threshold: 0.1
    };

    const config = { ...defaultOptions, ...options };

    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                const src = img.dataset.src;

                if (src) {
                    img.src = src;
                    img.removeAttribute('data-src');
                    img.classList.add('lazy-loaded');
                }

                observer.unobserve(img);
            }
        });
    }, config);

    const lazyImages = document.querySelectorAll(selector);
    lazyImages.forEach(img => imageObserver.observe(img));

    return imageObserver;
}

/**
 * Create a lazy loader for list items (infinite scroll)
 * @param {HTMLElement} container - Container element to observe
 * @param {function(): Promise<boolean>} loadMore - Function to load more items, returns false if no more items
 * @param {Object} options - Configuration options
 */
export function initInfiniteScroll(container, loadMore, options = {}) {
    const defaultOptions = {
        rootMargin: '100px',
        threshold: 0.1,
        loadingClass: 'loading'
    };

    const config = { ...defaultOptions, ...options };
    let isLoading = false;
    let hasMore = true;

    // Create sentinel element
    const sentinel = document.createElement('div');
    sentinel.className = 'infinite-scroll-sentinel';
    sentinel.style.height = '1px';
    container.appendChild(sentinel);

    const scrollObserver = new IntersectionObserver(async (entries) => {
        const entry = entries[0];

        if (entry.isIntersecting && !isLoading && hasMore) {
            isLoading = true;
            container.classList.add(config.loadingClass);

            try {
                hasMore = await loadMore();
            } catch (error) {
                logError('Error loading more items:', error);
            } finally {
                isLoading = false;
                container.classList.remove(config.loadingClass);
            }
        }
    }, {
        root: null,
        rootMargin: config.rootMargin,
        threshold: config.threshold
    });

    scrollObserver.observe(sentinel);

    // Return control object
    return {
        observer: scrollObserver,
        reset: () => {
            hasMore = true;
            isLoading = false;
        },
        stop: () => {
            hasMore = false;
            scrollObserver.disconnect();
        }
    };
}

/**
 * Lazy load a single element when it enters viewport
 * @param {HTMLElement} element - Element to observe
 * @param {function(HTMLElement): void} onVisible - Callback when element is visible
 * @param {Object} options - IntersectionObserver options
 */
export function lazyLoad(element, onVisible, options = {}) {
    const defaultOptions = {
        root: null,
        rootMargin: '50px',
        threshold: 0.1
    };

    const config = { ...defaultOptions, ...options };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                onVisible(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, config);

    observer.observe(element);

    return observer;
}
