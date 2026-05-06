/**
 * Content Script - Runs on Amazon product pages
 * 
 * Responsibilities:
 * 1. Detect Amazon product pages
 * 2. Scrape product information (title, price, model number)
 * 3. Query Supabase for price history
 * 4. Send model number to background worker for competitor price checking
 * 5. Inject beautiful UI overlay with price comparison data
 */

let AmazonScraper;
let SupabaseClient;
let UIBuilder;
let CONFIG;

class TrueTagContentScript {
  constructor() {
    this.supabaseClient = null;
    this.uiBuilder = null;
    this.productData = null;
    this.priceHistory = null;
    this.competitorPrices = null;
    this.modulesLoaded = false;
  }

  /**
   * Dynamically load ESM modules so this file can run as a regular content script.
   */
  async loadModules() {
    if (this.modulesLoaded) {
      return;
    }

    const [amazonModule, supabaseModule, uiModule, configModule] = await Promise.all([
      import(chrome.runtime.getURL('amazon-scraper.js')),
      import(chrome.runtime.getURL('supabase-client.js')),
      import(chrome.runtime.getURL('ui-builder.js')),
      import(chrome.runtime.getURL('config.js')),
    ]);

    AmazonScraper = amazonModule.default;
    SupabaseClient = supabaseModule.default;
    UIBuilder = uiModule.default;
    CONFIG = configModule.default;

    this.supabaseClient = new SupabaseClient();
    this.modulesLoaded = true;
  }

  /**
   * Initialize content script
   */
  async init() {
    await this.loadModules();

    // Verify we're on an Amazon product page
    if (!AmazonScraper.isAmazonProductPage()) {
      console.log('Not an Amazon product page');
      return;
    }

    console.log('TrueTag: Initializing on Amazon product page');

    // Wait for page to be fully loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start());
    } else {
      this.start();
    }
  }

  /**
   * Start the price comparison process
   * @private
   */
  async start() {
    try {
      // 1. Scrape product information
      this.productData = AmazonScraper.scrapeProductInfo();
      if (!this.productData) {
        console.warn('Failed to scrape product information');
        return;
      }

      console.log('TrueTag: Product data scraped', this.productData);

      // 2. Fetch price history from Supabase
      await this.fetchPriceHistory();

      // 3. Request competitor prices from background worker
      await this.requestCompetitorPrices();

      // 4. Process and prepare data for UI
      const uiData = this.processDataForUI();

      // 5. Create and inject UI
      if (uiData) {
        await this.injectUI(uiData);

        // 6. Log the current price to Supabase
        await this.logCurrentPrice();
      }
    } catch (error) {
      console.error('TrueTag: Error during initialization', error);
    }
  }

  /**
   * Fetch price history from Supabase
   * @private
   */
  async fetchPriceHistory() {
    try {
      const history = await this.supabaseClient.getPriceHistory(
        this.productData.modelNumber,
        CONFIG.priceHistory.averageWindow
      );

      if (history && history.length > 0) {
        this.priceHistory = {
          records: history,
          average: this.supabaseClient.calculateAveragePrice(history),
          range: this.supabaseClient.getPriceRange(history),
          count: history.length,
        };

        console.log('TrueTag: Price history retrieved', this.priceHistory);
      }
    } catch (error) {
      console.error('TrueTag: Failed to fetch price history', error);
    }
  }

  /**
   * Request competitor prices from background worker
   * @private
   */
  async requestCompetitorPrices() {
    return new Promise((resolve) => {
      // Send message to background worker
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_COMPETITOR_PRICES',
          productTitle: this.productData.title,
          modelNumber: this.productData.modelNumber,
        },
        (response) => {
          if (response && response.competitorPrices) {
            this.competitorPrices = response.competitorPrices;
            console.log('TrueTag: Competitor prices received', this.competitorPrices);
          }
          resolve();
        }
      );
    });
  }

  /**
   * Process data for UI display
   * @private
   */
  processDataForUI() {
    // Find best price among competitors
    let bestPrice = null;
    let bestPriceDifference = 0;

    if (this.competitorPrices) {
      for (const [store, priceData] of Object.entries(this.competitorPrices)) {
        if (priceData && priceData.price) {
          const price = parseFloat(priceData.price);
          if (!bestPrice || price < bestPrice.price) {
            bestPrice = {
              store: priceData.store,
              price: price,
            };
            bestPriceDifference = this.productData.price - price;
          }
        }
      }
    }

    // Only show overlay if there's a meaningful savings or interesting history
    if (!bestPrice && (!this.priceHistory || !this.priceHistory.records.length)) {
      console.log('TrueTag: No significant savings or history found');
      return null;
    }

    // Only show overlay if savings >= $10 or if there's price history data
    const showOverlay =
      (bestPrice && bestPriceDifference >= 10) ||
      (this.priceHistory && this.priceHistory.records.length >= CONFIG.priceHistory.minDataPoints);

    if (!showOverlay) {
      console.log('TrueTag: Savings too small and no significant history');
      return null;
    }

    // Determine if current price is a good deal
    let isGoodDeal = false;
    let dealDescription = '';

    if (this.priceHistory && this.priceHistory.average) {
      const percentageBelowAverage =
        ((this.priceHistory.average - this.productData.price) / this.priceHistory.average) * 100;

      if (percentageBelowAverage >= 10) {
        isGoodDeal = true;
        dealDescription = `${percentageBelowAverage.toFixed(0)}% below 30-day average`;
      }
    }

    return {
      bestPrice: bestPrice,
      amazonPrice: this.productData.price,
      savings: bestPriceDifference,
      priceHistory: {
        average: this.priceHistory?.average || null,
        min: this.priceHistory?.range.min || null,
        max: this.priceHistory?.range.max || null,
        count: this.priceHistory?.count || 0,
        isGoodDeal: isGoodDeal,
        dealDescription: dealDescription,
      },
      competitors: this.competitorPrices || {},
    };
  }

  /**
   * Inject UI overlay into page
   * @private
   */
  async injectUI(uiData) {
    try {
      // Create UI builder
      this.uiBuilder = new UIBuilder();

      // Create overlay with data
      const overlay = this.uiBuilder.createOverlay(uiData, uiData.priceHistory);

      // Wait a moment before injecting to ensure page is ready
      await new Promise((resolve) => setTimeout(resolve, CONFIG.ui.overlay.showDelay));

      // Inject into page
      this.uiBuilder.injectIntoPage();

      console.log('TrueTag: UI overlay injected');
    } catch (error) {
      console.error('TrueTag: Failed to inject UI', error);
    }
  }

  /**
   * Log current price to Supabase
   * @private
   */
  async logCurrentPrice() {
    try {
      const priceRecord = {
        modelNumber: this.productData.modelNumber,
        store: 'Amazon',
        price: this.productData.price,
      };

      await this.supabaseClient.insertPrice(priceRecord);
      console.log('TrueTag: Price logged to database');
    } catch (error) {
      console.error('TrueTag: Failed to log price', error);
    }
  }
}

// Initialize the content script
const trueTag = new TrueTagContentScript();
trueTag.init().catch((error) => {
  console.error('TrueTag: Content script init failed', error);
});
