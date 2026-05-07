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

console.log('TrueTag Background: Imports loaded successfully');

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

      // Handle Supabase read requests from content script.
      if (request.type === 'SUPABASE_GET_PRICE_HISTORY') {
        this.handleSupabaseGetPriceHistory(request, sendResponse);
        return true;
      }

      // Handle Supabase write requests from content script.
      if (request.type === 'SUPABASE_INSERT_PRICE') {
        this.handleSupabaseInsertPrice(request, sendResponse);
        return true;
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

      // Extract price from current active tab (shop pages)
      if (request.type === 'EXTRACT_PRICE_FROM_TAB') {
        try {
          this.extractPriceFromCurrentTab().then((price) => {
            sendResponse({ price: price });
          });
        } catch (error) {
          console.error('Background: Price extraction error', error);
          sendResponse({ price: null });
        }
        return;
      }

      // Save competitor price from shop page
      if (request.type === 'SAVE_COMPETITOR_PRICE') {
        try {
          this.handleSaveCompetitorPrice(request, sendResponse);
        } catch (error) {
          console.error('Background: Error saving competitor price', error);
          sendResponse({ success: false, error: error.message });
        }
        return true; // Keep channel open for async
      }

      sendResponse({ error: 'Unknown request type' });
    });
  }

  async handleSaveCompetitorPrice(request, sendResponse) {
    try {
      const { productInfo, price } = request;

      if (!productInfo || !productInfo.modelNumber || !productInfo.store || !price) {
        sendResponse({ success: false, error: 'Missing required data' });
        return;
      }

      console.log(`Background: Saving competitor price for ${productInfo.store}: $${price}`);

      // Call Edge Function to insert price
      const response = await fetch(CONFIG.supabase.writeEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.supabase.anonKey}`,
        },
        body: JSON.stringify({
          model_number: productInfo.modelNumber,
          store: productInfo.store,
          price: price,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Edge Function error: ${response.status} - ${errorData}`);
      }

      const data = await response.json();
      console.log(`Background: Price saved successfully`, data);

      sendResponse({ success: true, data: data });
    } catch (error) {
      console.error('Background: Failed to save competitor price', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  getSupabaseHeaders() {
    return {
      'Content-Type': 'application/json',
      apikey: CONFIG.supabase.anonKey,
      Authorization: `Bearer ${CONFIG.supabase.anonKey}`,
    };
  }

  async handleSupabaseGetPriceHistory(request, sendResponse) {
    try {
      const modelNumber = request.modelNumber;
      const days = request.days || CONFIG.priceHistory.averageWindow;

      if (!modelNumber || !CONFIG.supabase.url || !CONFIG.supabase.anonKey) {
        sendResponse({ records: [] });
        return;
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = new URLSearchParams({
        model_number: `eq.${modelNumber}`,
        created_at: `gte.${startDate.toISOString()}`,
        order: 'created_at.desc',
        limit: '1000',
      });

      const response = await fetch(
        `${CONFIG.supabase.url}/rest/v1/${CONFIG.supabase.table}?${query.toString()}`,
        { headers: this.getSupabaseHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Supabase history fetch failed: ${response.status}`);
      }

      const records = await response.json();
      sendResponse({ records });
    } catch (error) {
      console.warn('Background: Supabase history fetch failed', error);
      sendResponse({ records: [], error: error.message });
    }
  }

  async handleSupabaseInsertPrice(request, sendResponse) {
    try {
      const record = request.record;
      if (!record || !CONFIG.supabase.writeEndpoint || !CONFIG.supabase.anonKey) {
        sendResponse({ ok: false });
        return;
      }

      const payload = {
        model_number: record.modelNumber,
        store: record.store,
        price: Number.parseFloat(record.price),
        created_at: new Date().toISOString(),
      };

      const response = await fetch(CONFIG.supabase.writeEndpoint, {
        method: 'POST',
        headers: {
          ...this.getSupabaseHeaders(),
          'x-truetag-client': 'extension',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Supabase write failed: ${response.status} ${response.statusText} ${errorBody}`
        );
      }

      const data = await response.json();
      sendResponse({ ok: true, data });
    } catch (error) {
      console.warn('Background: Supabase write failed', error);
      sendResponse({ ok: false, error: error.message });
    }
  }

  /**
   * Handle competitor price fetch request
   * Returns direct shop search links instead of scraping
   * @private
   */
  async handleCompetitorPriceFetch(request, sendResponse) {
    try {
      console.log(
        'Background: Generating competitor shop links for',
        request.productTitle,
        request.modelNumber
      );

      const competitorLinks = await CompetitorFetcher.getCompetitorLinks(
        request.productTitle,
        request.modelNumber
      );

      sendResponse({ competitorPrices: competitorLinks });
    } catch (error) {
      console.error('Background: Error generating competitor links', error);
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
   * Extract price from current active tab (shop pages)
   * Tries to find price from Best Buy, Newegg, Target, or Micro Center pages
   * @private
   */
  async extractPriceFromCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return null;

      const url = tab.url || '';
      console.log('Background: Trying to extract price from:', url);

      // Check if tab is on a shop site
      const isShopSite = 
        url.includes('bestbuy.com') ||
        url.includes('newegg.com') ||
        url.includes('target.com') ||
        url.includes('microcenter.com');

      if (!isShopSite) {
        console.log('Background: Tab is not on a shop site');
        return null;
      }

      // Send message to shop-scraper content script
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          { type: 'EXTRACT_PRICE' },
          (response) => {
            if (chrome.runtime.lastError) {
              console.warn('Background: Content script not responding', chrome.runtime.lastError.message);
              resolve(null);
              return;
            }

            if (response && response.price) {
              console.log('Background: Extracted price:', response.price);
              resolve(response.price);
            } else {
              resolve(null);
            }
          }
        );
      });
    } catch (error) {
      console.error('Background: Price extraction error', error);
      return null;
    }
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
