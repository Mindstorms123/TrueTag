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

  getHeaders() {
    return {
      'Content-Type': 'application/json',
      apikey: this.config.supabase.anonKey,
      Authorization: `Bearer ${this.config.supabase.anonKey}`,
    };
  }

  async getPriceHistory(modelNumber) {
    if (!this.config.supabase.url || !this.config.supabase.anonKey) {
      return [];
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - this.config.priceHistory.averageWindow);

    const query = new URLSearchParams({
      model_number: `eq.${modelNumber}`,
      created_at: `gte.${startDate.toISOString()}`,
      order: 'created_at.desc',
      limit: '1000',
    });

    const response = await fetch(
      `${this.config.supabase.url}/rest/v1/${this.config.supabase.table}?${query.toString()}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Supabase history fetch failed: ${response.status}`);
    }

    return response.json();
  }

  async insertPrice(priceRecord) {
    if (!this.config.supabase.writeEndpoint || !this.config.supabase.anonKey) {
      return null;
    }

    const payload = {
      model_number: priceRecord.modelNumber,
      store: priceRecord.store,
      price: Number.parseFloat(priceRecord.price),
      created_at: new Date().toISOString(),
    };

    const response = await fetch(this.config.supabase.writeEndpoint, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'x-truetag-client': 'extension',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Supabase write failed: ${response.status}`);
    }

    return response.json();
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
      'width:340px',
      'max-width:calc(100vw - 20px)',
      'font-family:Inter, Segoe UI, system-ui, sans-serif',
      'background:rgba(15,23,42,0.97)',
      'color:#f1f5f9',
      'border:1px solid #334155',
      'border-radius:14px',
      'box-shadow:0 20px 35px rgba(0,0,0,0.45)',
      'padding:14px',
      'line-height:1.35',
    ].join(';');

    const savings = Math.max(0, (uiData.amazonPrice || 0) - (uiData.bestPrice?.price || 0));
    const badgeText = uiData.priceHistory?.isGoodDeal
      ? `Great Deal: ${uiData.priceHistory.dealDescription || 'below 30-day average'}`
      : 'Price History Available';
    const dealUrl = uiData.bestPrice?.url || '';
    const isBestCurrentPrice = !!uiData.isBestCurrentPrice;
    const isCompetitorCheckUnverified = !!uiData.isCompetitorCheckUnverified;
    const isPriceIdentical = !!uiData.isPriceIdentical;
    const identicalStore = uiData.identicalStore || 'another retailer';
    const verifiedCompetitorCount = uiData.verifiedCompetitorCount || 0;
    const expectedCheckedStoreCount = uiData.expectedCheckedStoreCount || 4;
    const isComparisonPartial = !!uiData.isComparisonPartial;
    const dealButtonMarkup = !isBestCurrentPrice
      ? `
      <div style="margin-top:12px;display:flex;gap:8px;">
        <a
          href="${dealUrl}"
          target="_blank"
          rel="noopener noreferrer"
          style="${dealUrl
            ? 'display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;border-radius:9px;background:#10b981;color:#062b1c;text-decoration:none;font-weight:700;font-size:12px;'
            : 'display:inline-flex;align-items:center;justify-content:center;padding:8px 10px;border-radius:9px;background:#334155;color:#94a3b8;text-decoration:none;font-weight:700;font-size:12px;pointer-events:none;'}"
        >
          ${dealUrl ? 'View Deal' : 'No Link Available'}
        </a>
      </div>
    `
      : '';

    overlay.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.2px;">
          <span style="display:inline-flex;width:20px;height:20px;border-radius:6px;background:#10b981;color:#082f1d;align-items:center;justify-content:center;font-size:12px;">T</span>
          <span>TrueTag</span>
        </div>
        <button id="truetag-close" style="background:transparent;border:0;color:#cbd5e1;font-size:18px;cursor:pointer;">×</button>
      </div>
      <div style="margin-top:12px;padding:12px;border:1px solid #065f46;border-radius:10px;background:linear-gradient(135deg, rgba(16,185,129,.18), rgba(16,185,129,.05));">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#86efac;">${isBestCurrentPrice ? 'Current Best Price' : 'Best Alternative Price'}</div>
        <div style="margin-top:4px;font-size:15px;">
          ${isCompetitorCheckUnverified
            ? `Current best seen: <strong>$${(uiData.amazonPrice || 0).toFixed(2)}</strong> on Amazon (competitor check not yet verified).`
            : isPriceIdentical
            ? `Best verified price is <strong>$${(uiData.amazonPrice || 0).toFixed(2)}</strong> (same price at ${identicalStore}).`
            : isBestCurrentPrice
            ? `Best verified price is <strong>$${(uiData.amazonPrice || 0).toFixed(2)}</strong> on Amazon.`
            : `Found for <strong>$${(uiData.bestPrice?.price ?? 0).toFixed(2)}</strong> at ${uiData.bestPrice?.store || 'Unknown'}`}
        </div>
        ${!isCompetitorCheckUnverified && isComparisonPartial ? `<div style="margin-top:6px;color:#93c5fd;font-size:12px;">Verified stores: ${verifiedCompetitorCount}/${expectedCheckedStoreCount}</div>` : ''}
        ${!isBestCurrentPrice && !isCompetitorCheckUnverified && !isPriceIdentical && savings > 0 ? `<div style="margin-top:6px;color:#34d399;font-weight:700;">Save $${savings.toFixed(2)}</div>` : ''}
      </div>
      <div style="margin-top:10px;display:inline-block;padding:7px 10px;border-radius:999px;border:1px solid #14532d;background:rgba(22,163,74,.12);color:#bbf7d0;font-size:12px;font-weight:600;">
        ${badgeText}
      </div>
      ${dealButtonMarkup}
    `;

    overlay.querySelector('#truetag-close')?.addEventListener('click', () => overlay.remove());
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
    let bestPrice = null;
    let bestPriceDifference = 0;
    let verifiedCompetitorCount = 0;
    const expectedCheckedStoreCount = Object.keys(this.competitorPrices || {}).length || 4;

    for (const priceData of Object.values(this.competitorPrices || {})) {
      if (priceData?.verified !== true) continue;
      if (!priceData?.price) continue;
      const price = Number.parseFloat(priceData.price);
      if (!Number.isFinite(price)) continue;

      verifiedCompetitorCount += 1;

      if (!bestPrice || price < bestPrice.price) {
        bestPrice = { store: priceData.store, price, url: priceData.url || '' };
        bestPriceDifference = (this.productData.price || 0) - price;
      }
    }

    const hasVerifiedCompetitorPrice = !!bestPrice;
    const normalizedDelta = Math.round(bestPriceDifference * 100) / 100;
    const hasCheaperCompetitor = !!bestPrice && normalizedDelta >= 0.01;
    const isEqualPrice = !!bestPrice && Math.abs(normalizedDelta) < 0.01;
    const isComparisonPartial = verifiedCompetitorCount < expectedCheckedStoreCount;
    let isBestCurrentPrice = false;
    let isCompetitorCheckUnverified = false;
    let isPriceIdentical = false;
    let identicalStore = '';

    if (!bestPrice && this.config.ui?.forceShowForTesting) {
      const syntheticPrice = Math.max(0, (this.productData.price || 0) - 25);
      bestPrice = {
        store: 'Best Buy (test mode)',
        price: syntheticPrice,
        url: `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(
          this.productData.modelNumber || this.productData.title || ''
        )}`,
      };
      bestPriceDifference = (this.productData.price || 0) - syntheticPrice;
    }

    if (!hasVerifiedCompetitorPrice && !this.config.ui?.forceShowForTesting) {
      isCompetitorCheckUnverified = true;
      bestPrice = {
        store: 'Unavailable',
        price: this.productData.price,
        url: '',
      };
      bestPriceDifference = 0;
    } else if (isEqualPrice && !this.config.ui?.forceShowForTesting) {
      isBestCurrentPrice = true;
      isPriceIdentical = true;
      identicalStore = bestPrice?.store || '';
      bestPrice = {
        store: 'Amazon',
        price: this.productData.price,
        url: this.productData.currentUrl,
      };
      bestPriceDifference = 0;
    } else if (!hasCheaperCompetitor && !this.config.ui?.forceShowForTesting) {
      isBestCurrentPrice = true;
      bestPrice = {
        store: 'Amazon',
        price: this.productData.price,
        url: this.productData.currentUrl,
      };
      bestPriceDifference = 0;
    }

    let isGoodDeal = false;
    let dealDescription = '';

    if (this.priceHistory?.average) {
      const percentageBelowAverage =
        ((this.priceHistory.average - this.productData.price) / this.priceHistory.average) * 100;
      if (percentageBelowAverage >= 10) {
        isGoodDeal = true;
        dealDescription = `${percentageBelowAverage.toFixed(0)}% below 30-day average`;
      }
    }

    return {
      bestPrice,
      isBestCurrentPrice,
      isCompetitorCheckUnverified,
      isPriceIdentical,
      identicalStore,
      verifiedCompetitorCount,
      expectedCheckedStoreCount,
      isComparisonPartial,
      amazonPrice: this.productData.price,
      savings: bestPriceDifference,
      priceHistory: {
        average: this.priceHistory?.average || null,
        min: this.priceHistory?.range?.min || null,
        max: this.priceHistory?.range?.max || null,
        count: this.priceHistory?.count || 0,
        isGoodDeal,
        dealDescription,
      },
      competitors: this.competitorPrices || {},
    };
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
