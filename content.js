/**
 * TrueTag content script (classic script, no dynamic module imports)
 * Runs on Amazon product pages and shows a non-intrusive overlay.
 */

const DEFAULT_CONFIG = {
  supabase: {
    url: '',
    anonKey: '',
      table: 'v_current_store_offers',
    writeEndpoint: '',
  },
  priceHistory: {
    averageWindow: 30,
    minDataPoints: 3,
  },
  ui: {
    overlay: {
      showDelay: 500,
    },
  },
  debug: false,
};

console.info('TrueTag content.js active (build 2026-05-07.1)');

class AmazonScraper {
  static isAmazonProductPage() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    const isAmazonHost = host === 'www.amazon.com' || host === 'www.amazon.de';
    const hasProductPath = /\/(?:.*\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/.test(path);
    return isAmazonHost && hasProductPath;
  }

  static getASIN() {
    const urlMatch = window.location.pathname.match(/\/(?:.*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (urlMatch) {
      return urlMatch[1];
    }

    const element = document.querySelector('[data-asin]');
    return element ? element.getAttribute('data-asin') : null;
  }

  static getProductTitle() {
    const selectors = ['#productTitle', 'h1 span#productTitle', '[data-feature-name="title"]'];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element?.textContent?.trim()) {
        return element.textContent.trim();
      }
    }
    return null;
  }

  static parsePriceString(priceString) {
    if (!priceString) return null;

    let value = String(priceString)
      .replace(/[^\d,.-]/g, '')
      .trim();

    // de-DE style (765,01)
    if (value.includes(',') && !value.includes('.')) {
      value = value.replace(',', '.');
    } else {
      // en-US style (1,299.99)
      value = value.replace(/,/g, '');
    }

    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000000) {
      return null;
    }

    return Math.round(parsed * 100) / 100;
  }

  static getProductPrice() {
    const offscreen = document.querySelector('.a-price .a-offscreen');
    if (offscreen?.textContent) {
      const price = this.parsePriceString(offscreen.textContent);
      if (price !== null) return price;
    }

    const whole = document.querySelector('.a-price-whole')?.textContent?.trim();
    const fraction = document.querySelector('.a-price-fraction')?.textContent?.trim();
    if (whole) {
      const combined = fraction ? `${whole}.${fraction}` : whole;
      const price = this.parsePriceString(combined);
      if (price !== null) return price;
    }

    return null;
  }

  static getModelNumber() {
    const detailSelectors = [
      '#detailBullets_feature_div li',
      '#productDetails_detailBullets_sections1 tr',
      '#technicalSpecifications_section_1 tr',
    ];

    for (const selector of detailSelectors) {
      const rows = document.querySelectorAll(selector);
      for (const row of rows) {
        const text = row.textContent || '';
        if (/model|modell|model number|modellnummer/i.test(text)) {
          const match = text.match(/[:\-]\s*([A-Za-z0-9._-]{3,})/);
          if (match?.[1]) {
            return match[1];
          }
        }
      }
    }

    return this.getASIN();
  }

  static scrapeProductInfo() {
    const product = {
      title: this.getProductTitle(),
      price: this.getProductPrice(),
      modelNumber: this.getModelNumber(),
      asin: this.getASIN(),
      currentUrl: window.location.href,
    };

    if (!product.title || !product.price || !product.modelNumber) {
      return null;
    }

    return product;
  }
}

class SupabaseClient {
  constructor(config) {
    this.config = config;
  }

  async getPriceHistory(modelNumber) {
    if (!this.config.supabase.url || !this.config.supabase.anonKey || !modelNumber) {
      return [];
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'SUPABASE_GET_PRICE_HISTORY',
          modelNumber,
          days: this.config.priceHistory.averageWindow,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (response?.error) {
            reject(new Error(response.error));
            return;
          }

          resolve(response?.records || []);
        }
      );
    });
  }

  async insertPrice(priceRecord) {
    if (!this.config.supabase.writeEndpoint || !this.config.supabase.anonKey) {
      return null;
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'SUPABASE_INSERT_PRICE',
          record: priceRecord,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response?.ok) {
            reject(new Error(response?.error || 'Supabase write failed'));
            return;
          }

          resolve(response.data || null);
        }
      );
    });
  }

  static calculateAveragePrice(records) {
    if (!records?.length) return null;
    const sum = records.reduce((acc, record) => acc + Number.parseFloat(record.price || 0), 0);
    return sum / records.length;
  }

  static getPriceRange(records) {
    if (!records?.length) return { min: null, max: null };
    const prices = records.map((r) => Number.parseFloat(r.price || 0)).filter(Number.isFinite);
    if (!prices.length) return { min: null, max: null };
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
    };
  }
}

class OverlayUI {
  static remove() {
    const existing = document.getElementById('truetag-overlay');
    if (existing) existing.remove();
  }

  static inject(uiData) {
    this.remove();

    const overlay = document.createElement('div');
    overlay.id = 'truetag-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'right:20px',
      'bottom:20px',
      'z-index:2147483647',
      'width:390px',
      'max-width:calc(100vw - 24px)',
      'font-family:Inter, Segoe UI, system-ui, sans-serif',
      'background:rgba(15,23,42,0.97)',
      'color:#f1f5f9',
      'border:1px solid #334155',
      'border-radius:14px',
      'box-shadow:0 20px 35px rgba(0,0,0,0.45)',
      'padding:16px',
      'line-height:1.35',
    ].join(';');

    // Add styles for buttons
    const style = document.createElement('style');
    style.textContent = `
      #truetag-overlay a {
        transition: all 200ms ease !important;
      }
      #truetag-overlay a:hover {
        background: #334155 !important;
        border-color: #64748b !important;
      }
      .truetag-section {
        margin-top: 12px;
        padding: 12px;
        border: 1px solid #334155;
        border-radius: 10px;
        background: #1a1f3a;
      }
      .truetag-section-title {
        font-size: 12px;
        font-weight: 700;
        color: #cbd5e1;
        margin-bottom: 10px;
        letter-spacing: .2px;
      }
      .truetag-saved-card {
        padding: 10px;
        border-radius: 10px;
        border: 1px solid #065f46;
        background: linear-gradient(135deg, rgba(16,185,129,.15), rgba(16,185,129,.05));
        margin-bottom: 10px;
      }
      .truetag-saved-card:last-child {
        margin-bottom: 0;
      }
      .truetag-saved-store {
        font-size: 13px;
        font-weight: 700;
        color: #86efac;
      }
      .truetag-saved-price {
        font-size: 17px;
        font-weight: 800;
        color: #f8fafc;
        margin-top: 2px;
      }
      .truetag-saved-meta {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 4px;
      }
      .truetag-saved-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        background: #0f766e;
        color: #ecfeff;
        text-decoration: none;
        font-size: 12px;
        font-weight: 700;
      }
      .truetag-empty-state {
        font-size: 12px;
        color: #94a3b8;
      }
      .truetag-shop-link {
        display: block;
        margin-top: 10px;
        padding: 12px;
        border-radius: 8px;
        background: #1e293b;
        border: 1px solid #475569;
        color: #e2e8f0;
        text-decoration: none;
        font-size: 13px;
        font-weight: 600;
        text-align: center;
      }
    `;

    const savedOffersHTML = (uiData.savedOffers || [])
      .map((offer) => {
        const linkUrl = offer.offerUrl || uiData.shopLinks?.[offer.storeKey]?.url || '';
        const timestamp = offer.savedAtText || 'Unknown time';
        const sourceLabel = offer.sourceType === 'product' ? 'product page' : 'search page';
        return `
          <div class="truetag-saved-card">
            <div class="truetag-saved-store">${offer.storeName}</div>
            <div class="truetag-saved-price">Another user found this for $${Number(offer.price || offer.currentPrice || 0).toFixed(2)}</div>
            <div class="truetag-saved-meta">Saved ${timestamp}${offer.sourceType ? ` • ${sourceLabel}` : ''}</div>
            ${linkUrl ? `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer" class="truetag-saved-link truetag-shop-link" data-store="${offer.storeName}" data-url="${linkUrl}">${offer.sourceType === 'product' ? 'Open product page' : 'Open search results'}</a>` : ''}
          </div>
        `;
      })
      .join('');

    const remainingLinksHTML = (uiData.remainingLinks || [])
      .map((linkData) => {
        if (!linkData || !linkData.url) return '';
        return `
          <a href="${linkData.url}" target="_blank" rel="noopener noreferrer" class="truetag-shop-link" data-store="${linkData.store}" data-url="${linkData.url}">🔍 Compare at ${linkData.store}</a>
        `;
      })
      .join('');

    overlay.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.2px;font-size:14px;">
          <span style="display:inline-flex;width:20px;height:20px;border-radius:6px;background:#10b981;color:#082f1d;align-items:center;justify-content:center;font-size:12px;font-weight:800;">T</span>
          <span>TrueTag</span>
        </div>
        <button id="truetag-close" style="background:transparent;border:0;color:#cbd5e1;font-size:20px;cursor:pointer;padding:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">×</button>
      </div>
      
      <div style="padding:12px;border:1px solid #065f46;border-radius:10px;background:linear-gradient(135deg, rgba(16,185,129,.18), rgba(16,185,129,.05));">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#86efac;margin-bottom:4px;">Amazon Price</div>
        <div style="font-size:24px;font-weight:700;color:#10b981;">$${(uiData.amazonPrice || 0).toFixed(2)}</div>
      </div>

      <div class="truetag-section">
        <div class="truetag-section-title">📌 Saved offers from other users</div>
        ${savedOffersHTML || '<div class="truetag-empty-state">No saved offers yet.</div>'}
      </div>

      <div class="truetag-section">
        <div class="truetag-section-title">📊 More retailers to check</div>
        ${remainingLinksHTML || '<div class="truetag-empty-state">All available retailers already have a saved offer.</div>'}
      </div>

      <div style="margin-top:10px;text-align:center;font-size:11px;color:#64748b;">
        Open a saved offer or compare a store without saved data
      </div>
    `;

    overlay.appendChild(style);

    // Close button
    overlay.querySelector('#truetag-close')?.addEventListener('click', () => overlay.remove());

    // Shop links - save product info when clicked so the shop page can show the panel
    overlay.querySelectorAll('.truetag-shop-link').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();

        const target = e.currentTarget;
        const store = target.dataset.store;
        const url = target.dataset.url || target.getAttribute('href');
        console.log(`TrueTag: User clicked link for ${store}`, url);

        const productInfo = {
          title: uiData.title,
          productTitle: uiData.title,
          modelNumber: uiData.modelNumber,
          asin: uiData.asin || null,
          amazonPrice: uiData.amazonPrice,
          amazonUrl: uiData.amazonUrl || null,
          store: store,
          offerUrl: url,
          sourceUrl: url,
          sourceType: url && /\/p\//i.test(url) ? 'product' : 'search',
          offerType: url && /\/p\//i.test(url) ? 'product' : 'search',
          timestamp: Date.now(),
        };

        try {
          // Save to storage so shop-scraper.js can access it
          await chrome.storage.local.set({ 'truetag_product_info': productInfo });
          console.log(`TrueTag: Saved product info for ${store}:`, productInfo);
          chrome.runtime.sendMessage({ type: 'OPEN_URL', url });
        } catch (error) {
          console.error(`TrueTag: Failed to save product info`, error);
        }
      });
    });

    document.body.appendChild(overlay);
  }
}

class TrueTagContentScript {
  constructor() {
    this.config = structuredClone(DEFAULT_CONFIG);
    this.supabaseClient = null;
    this.productData = null;
    this.priceHistory = null;
    this.competitorPrices = null;
  }

  log(...args) {
    if (this.config.debug) {
      console.log(...args);
    }
  }

  async getConfigFromBackground() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_PUBLIC_CONFIG' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response?.config || null);
      });
    });
  }

  async init() {
    if (!AmazonScraper.isAmazonProductPage()) {
      return;
    }

    const backgroundConfig = await this.getConfigFromBackground();
    if (backgroundConfig) {
      this.config = {
        ...this.config,
        ...backgroundConfig,
        supabase: {
          ...this.config.supabase,
          ...(backgroundConfig.supabase || {}),
        },
        priceHistory: {
          ...this.config.priceHistory,
          ...(backgroundConfig.priceHistory || {}),
        },
        ui: {
          ...this.config.ui,
          ...(backgroundConfig.ui || {}),
        },
      };
    }

    this.supabaseClient = new SupabaseClient(this.config);

    this.log('TrueTag: init config', this.config);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start());
    } else {
      this.start();
    }
  }

  async start() {
    try {
      this.productData = AmazonScraper.scrapeProductInfo();
      if (!this.productData) {
        console.warn('TrueTag: Could not scrape required product fields.');
        return;
      }

      this.log('TrueTag: Product data', this.productData);

      await this.fetchPriceHistory();
      await this.requestCompetitorPrices();

      const uiData = this.processDataForUI();
      if (!uiData) {
        this.log('TrueTag: No overlay conditions met.');
        return;
      }

      const delay = this.config.ui?.overlay?.showDelay ?? 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      OverlayUI.inject(uiData);

      await this.logCurrentPrice();
    } catch (error) {
      console.error('TrueTag: start() failed', error);
    }
  }

  async fetchPriceHistory() {
    try {
      const records = await this.supabaseClient.getPriceHistory(this.productData.modelNumber);
      this.priceHistory = {
        records,
        average: SupabaseClient.calculateAveragePrice(records),
        range: SupabaseClient.getPriceRange(records),
        count: records?.length || 0,
      };
    } catch (error) {
      console.warn('TrueTag: Price history fetch failed', error);
      this.priceHistory = { records: [], average: null, range: { min: null, max: null }, count: 0 };
    }
  }

  normalizeStoreKey(storeName) {
    return String(storeName || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  formatSavedTimestamp(value) {
    if (!value) return 'unknown time';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'unknown time';

    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  buildSavedOffers(records) {
    const latestByStore = new Map();

    for (const record of records || []) {
      const storeName = record.store || '';
      if (!storeName || storeName.toLowerCase() === 'amazon') {
        continue;
      }

      const storeKey = this.normalizeStoreKey(storeName);
      const savedAt = record.saved_at || record.created_at || record.savedAt || record.createdAt || null;
      const existing = latestByStore.get(storeKey);
      const existingDate = existing ? new Date(existing.savedAtRaw || 0).getTime() : 0;
      const currentDate = new Date(savedAt || 0).getTime();

      if (!existing || currentDate >= existingDate) {
        latestByStore.set(storeKey, {
          storeKey,
          storeName,
          price: Number.parseFloat(record.current_price || record.price),
          currentPrice: Number.parseFloat(record.current_price || record.price),
          savedAtRaw: savedAt,
          savedAtText: this.formatSavedTimestamp(savedAt),
          offerUrl: record.offer_url || record.source_url || record.url || null,
          sourceUrl: record.source_url || record.offer_url || record.url || null,
          sourceType: record.offer_type || record.source_type || null,
          pageTitle: record.page_title || null,
          amazonUrl: record.amazon_url || null,
          modelNumber: record.model_number || null,
          asin: record.asin || null,
          productTitle: record.offer_product_title || record.product_title || null,
        });
      }
    }

    const order = ['bestbuy', 'newegg', 'target', 'microcenter'];
    return Array.from(latestByStore.values()).sort((a, b) => {
      const aIndex = order.indexOf(a.storeKey);
      const bIndex = order.indexOf(b.storeKey);
      if (aIndex === -1 && bIndex === -1) return a.storeName.localeCompare(b.storeName);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }

  async requestCompetitorPrices() {
    this.competitorPrices = {};

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_COMPETITOR_PRICES',
          productTitle: this.productData.title,
          modelNumber: this.productData.modelNumber,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn('TrueTag: Background message failed', chrome.runtime.lastError.message);
            resolve();
            return;
          }

          this.competitorPrices = response?.competitorPrices || {};
          resolve();
        }
      );
    });
  }

  processDataForUI() {
    const shopLinks = this.competitorPrices || {};
    const amazonPrice = Number.parseFloat(this.productData.price || 0);
    const savedOffers = this.buildSavedOffers(this.priceHistory?.records || []);
    const savedStoreKeys = new Set(savedOffers.map((offer) => offer.storeKey));
    const remainingLinks = Object.entries(shopLinks)
      .filter(([storeKey]) => !savedStoreKeys.has(storeKey))
      .map(([, linkData]) => linkData)
      .filter(Boolean);
    
    console.log('TrueTag: Competitor Links:', shopLinks);
    console.log('TrueTag: Saved offers:', savedOffers);
    
    return {
      title: this.productData.title,
      modelNumber: this.productData.modelNumber,
      asin: this.productData.asin,
      amazonUrl: this.productData.currentUrl,
      amazonPrice: amazonPrice,
      shopLinks: shopLinks,
      savedOffers,
      remainingLinks,
    };
  }

  async savePriceIfConfirmed(store, price) {
    const confirmed = confirm(
      `Save price for ${store}?\n\n` +
      `Product: ${this.productData.title}\n` +
      `Price: $${price.toFixed(2)}\n\n` +
      `Click OK to save to database.`
    );
    
    if (confirmed) {
      try {
        console.log(`TrueTag: Saving ${store} price $${price.toFixed(2)}`);
        await this.supabaseClient.insertPrice({
          modelNumber: this.productData.modelNumber,
          store: store,
          price: parseFloat(price),
          productTitle: this.productData.title,
          asin: this.productData.asin,
          amazonUrl: this.productData.currentUrl,
          sourceType: 'amazon',
        });
        console.log(`TrueTag: ✅ Saved ${store} price to database`);
        alert(`✅ Price saved for ${store}!`);
      } catch (error) {
        console.error(`TrueTag: Failed to save ${store} price`, error);
        alert(`❌ Failed to save price: ${error.message}`);
      }
    }
  }

  async logCurrentPrice() {
    try {
      await this.supabaseClient.insertPrice({
        modelNumber: this.productData.modelNumber,
        store: 'Amazon',
        price: this.productData.price,
        productTitle: this.productData.title,
        asin: this.productData.asin,
        amazonUrl: this.productData.currentUrl,
        sourceType: 'amazon',
      });
    } catch (error) {
      console.warn('TrueTag: Price write failed', error);
    }
  }
}

const trueTag = new TrueTagContentScript();
trueTag.init().catch((error) => {
  console.error('TrueTag: content init failed', error);
});
