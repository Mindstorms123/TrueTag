/**
 * Background Service Worker (Manifest V3)
 * 
 * Responsibilities:
 * 1. Handle messages from content scripts
 * 2. Fetch competitor prices in the background
 * 3. Manage cache and rate limiting
 * 4. Coordinate with Supabase for data persistence
 */

import CompetitorFetcher from './competitor-fetcher.js';
import CONFIG from './config.js';

class BackgroundWorker {
  constructor() {
    this.priceCache = new Map();
    this.cacheDuration = 30 * 60 * 1000; // 30 minutes
    this.initMessageListeners();
  }

  /**
   * Initialize message listeners
   * @private
   */
  initMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (CONFIG.debug) {
        console.log('Background: Message received', request);
      }

      // Handle competitor price fetch request
      if (request.type === 'FETCH_COMPETITOR_PRICES') {
        this.handleCompetitorPriceFetch(request, sendResponse);
        return true; // Keep channel open for async response
      }

      // Provide public runtime config to content script.
      if (request.type === 'GET_PUBLIC_CONFIG') {
        sendResponse({
          config: {
            supabase: {
              url: CONFIG.supabase.url,
              anonKey: CONFIG.supabase.anonKey,
              table: CONFIG.supabase.table,
              writeEndpoint: CONFIG.supabase.writeEndpoint,
            },
            priceHistory: CONFIG.priceHistory,
            ui: CONFIG.ui,
            debug: CONFIG.debug,
          },
        });
        return;
      }

      // Handle cache clear request
      if (request.type === 'CLEAR_PRICE_CACHE') {
        this.clearCache();
        sendResponse({ success: true });
        return;
      }

      sendResponse({ error: 'Unknown request type' });
    });
  }

  /**
   * Handle competitor price fetch request
   * @private
   */
  async handleCompetitorPriceFetch(request, sendResponse) {
    try {
      const cacheKey = this.generateCacheKey(request.productTitle, request.modelNumber);
      const cachedPrices = this.getCachedPrices(cacheKey);

      // Return cached prices if available
      if (cachedPrices) {
        if (CONFIG.debug) {
          console.log('Background: Returning cached prices', cachedPrices);
        }
        sendResponse({ competitorPrices: cachedPrices });
        return;
      }

      // Fetch fresh prices from competitors
      console.log(
        'Background: Fetching prices for',
        request.productTitle,
        request.modelNumber
      );

      const competitorPrices = await CompetitorFetcher.fetchAllCompetitors(
        request.productTitle,
        request.modelNumber
      );

      // Cache the results
      this.setCachedPrices(cacheKey, competitorPrices);

      sendResponse({ competitorPrices: competitorPrices });
    } catch (error) {
      console.error('Background: Error fetching competitor prices', error);
      sendResponse({ error: error.message });
    }
  }

  /**
   * Generate cache key from product info
   * @private
   */
  generateCacheKey(productTitle, modelNumber) {
    const key = modelNumber || productTitle.toLowerCase().replace(/\s+/g, '_');
    return `price_${key}`;
  }

  /**
   * Get cached prices
   * @private
   */
  getCachedPrices(cacheKey) {
    const cached = this.priceCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - cached.timestamp > this.cacheDuration) {
      this.priceCache.delete(cacheKey);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cached prices
   * @private
   */
  setCachedPrices(cacheKey, prices) {
    this.priceCache.set(cacheKey, {
      data: prices,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached prices
   * @public
   */
  clearCache() {
    this.priceCache.clear();
    console.log('Background: Price cache cleared');
  }

  /**
   * Periodic cache cleanup (runs every 1 hour)
   * @private
   */
  schedulePeriodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      for (const [key, cached] of this.priceCache.entries()) {
        if (now - cached.timestamp > this.cacheDuration) {
          this.priceCache.delete(key);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        console.log(`Background: Cleaned up ${expiredCount} expired cache entries`);
      }
    }, 60 * 60 * 1000); // 1 hour
  }
}

// Initialize background worker
const backgroundWorker = new BackgroundWorker();
backgroundWorker.schedulePeriodicCleanup();

// Log that service worker is active
console.log('TrueTag Background Service Worker initialized');
