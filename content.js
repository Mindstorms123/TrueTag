/**
 * TrueTag content script (classic script, no dynamic module imports)
 * Runs on Amazon product pages and shows a non-intrusive overlay.
 */

const DEFAULT_CONFIG = {
  supabase: {
    url: '',
    anonKey: '',
    table: 'price_history',
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
      'width:360px',
      'max-width:calc(100vw - 40px)',
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
      .truetag-found-btn {
        transition: all 200ms ease !important;
      }
      .truetag-found-btn:hover {
        background: #059669 !important;
      }
    `;

    // Build shop links HTML - simple clickable links only
    const shopLinks = uiData.shopLinks || {};
    const shopLinksHTML = Object.entries(shopLinks)
      .map(([storeName, linkData]) => {
        if (!linkData || !linkData.url) return '';
        return `
          <a 
            href="${linkData.url}" 
            target="_blank" 
            rel="noopener noreferrer"
            class="truetag-shop-link"
            data-store="${linkData.store}"
            style="display:block;margin-top:10px;padding:12px;border-radius:8px;background:#1e293b;border:1px solid #475569;color:#e2e8f0;text-decoration:none;font-size:13px;font-weight:600;text-align:center;"
          >
            🔍 Compare at ${linkData.store}
          </a>
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

      <div style="margin-top:14px;padding:12px;background:#1a1f3a;border-radius:8px;border:1px solid #334155;">
        <div style="font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:10px;">📊 Check other retailers:</div>
        ${shopLinksHTML}
      </div>

      <div style="margin-top:10px;text-align:center;font-size:11px;color:#64748b;">
        Click store → find product → click "Found" button
      </div>
    `;

    overlay.appendChild(style);

    // Close button
    overlay.querySelector('#truetag-close')?.addEventListener('click', () => overlay.remove());

    // Shop links - save product info when clicked
    overlay.querySelectorAll('.truetag-shop-link').forEach(link => {
      link.addEventListener('click', async (e) => {
        const store = e.target.dataset.store;
        console.log(`TrueTag: User clicked link for ${store}`);

        const productInfo = {
          title: uiData.title,
          modelNumber: uiData.modelNumber,
          amazonPrice: uiData.amazonPrice,
          store: store,
          timestamp: Date.now(),
        };

        try {
          // Save to storage so shop-scraper.js can access it
          await chrome.storage.local.set({ 'truetag_product_info': productInfo });
          console.log(`TrueTag: Saved product info for ${store}:`, productInfo);
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
    // Get competitor shop links
    const shopLinks = this.competitorPrices || {};
    const amazonPrice = Number.parseFloat(this.productData.price || 0);
    
    // Log links to console for debugging
    console.log('TrueTag: Competitor Links:', shopLinks);
    
    // Return UI data
    return {
      title: this.productData.title,
      modelNumber: this.productData.modelNumber,
      amazonPrice: amazonPrice,
      shopLinks: shopLinks,
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
        });
        console.log(`TrueTag: ✅ Saved ${store} price to database`);
        alert(`✅ Price saved for ${store}!`);
      } catch (error) {
        console.error(`TrueTag: Failed to save ${store} price`, error);
        alert(`❌ Failed to save price: ${error.message}`);
      }
    }
  }

  async askForPriceAndSave(store) {
    console.log(`TrueTag: User clicked Found for ${store}`);
    
    // Step 1: Ask if user wants to save
    const shouldSave = confirm(
      `Ready to save price for ${store}?\n\n` +
      `${this.productData.title}\n` +
      `Amazon: $${(this.productData.price || 0).toFixed(2)}\n\n` +
      `Click OK to open ${store} in new tab.\n` +
      `The dialog will appear on the shop page.`
    );

    if (!shouldSave) {
      console.log(`TrueTag: User declined ${store}`);
      return;
    }

    // Store product info for the shop page
    const productInfo = {
      title: this.productData.title,
      modelNumber: this.productData.modelNumber,
      amazonPrice: this.productData.price,
      store: store,
      timestamp: Date.now(),
    };

    try {
      // Save to chrome.storage.local so shop-scraper.js can access it
      await chrome.storage.local.set({ 'truetag_product_info': productInfo });
      console.log(`TrueTag: Saved product info to session:`, productInfo);

      // Ask background to open shop link in new tab
      const shopLinks = this.competitorPrices[store.toLowerCase()] || {};
      if (shopLinks.url) {
        chrome.runtime.sendMessage({
          type: 'OPEN_SHOP_TAB',
          url: shopLinks.url,
          store: store,
        });
        console.log(`TrueTag: Sent message to open ${store}`);
      }
    } catch (error) {
      console.error(`TrueTag: Failed to save product info`, error);
      alert(`❌ Error: Could not prepare shop tab`);
    }
  }

  async logCurrentPrice() {
    try {
      await this.supabaseClient.insertPrice({
        modelNumber: this.productData.modelNumber,
        store: 'Amazon',
        price: this.productData.price,
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
