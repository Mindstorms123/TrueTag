/**
 * Competitor Price Fetcher
 * Background service worker module to fetch prices from competing retailers
 * 
 * NOTE: This is a structural placeholder. In production, you'll need to:
 * 1. Implement actual DOM parsing for each competitor (or use their APIs if available)
 * 2. Handle CORS issues (Chrome Extension has relaxed CORS restrictions)
 * 3. Implement retry logic and rate limiting
 * 4. Cache results to avoid excessive requests
 */

class CompetitorFetcher {
  static parsePriceValue(value) {
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000000) {
      return null;
    }
    return Math.round(parsed * 100) / 100;
  }

  static normalizeBestBuyUrl(pathOrUrl) {
    if (!pathOrUrl) {
      return null;
    }

    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }

    if (pathOrUrl.startsWith('/')) {
      return `https://www.bestbuy.com${pathOrUrl}`;
    }

    return `https://www.bestbuy.com/${pathOrUrl}`;
  }

  static extractBestBuyPrice(html) {
    const patterns = [
      /"salePrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      /"currentPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      /"customerPrice"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
      /itemprop="price"\s+content="([0-9]+(?:\.[0-9]+)?)"/i,
      /aria-hidden="true">\$([0-9][0-9,]*(?:\.[0-9]{2})?)</i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const normalized = match[1].replace(/,/g, '');
      const price = this.parsePriceValue(normalized);
      if (price !== null) {
        return price;
      }
    }

    return null;
  }

  static extractBestBuyProductUrl(html, fallbackUrl) {
    const patterns = [
      /"canonicalUrl"\s*:\s*"(\/site\/[^"]+)"/i,
      /href="(\/site\/[^"]+\.p\?skuId=[0-9]+)"/i,
      /href="(\/site\/[^"]+\/[0-9]+\.p)"/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.normalizeBestBuyUrl(match[1].replace(/\\u002F/g, '/'));
      }
    }

    return fallbackUrl;
  }

  /**
   * Fetch prices from all competitors
   * @param {string} productTitle - Product title/search term
   * @param {string} modelNumber - Model number for more specific search
   * @returns {Promise<Object>} Prices from each competitor
   */
  static async fetchAllCompetitors(productTitle, modelNumber) {
    const competitors = ['bestbuy', 'newegg', 'target', 'microcenter'];
    const results = {};

    for (const competitor of competitors) {
      try {
        const price = await this.fetchCompetitorPrice(
          competitor,
          productTitle,
          modelNumber
        );
        results[competitor] = price;
      } catch (error) {
        console.error(`Failed to fetch price from ${competitor}:`, error);
        results[competitor] = null;
      }
    }

    return results;
  }

  /**
   * Fetch price from a specific competitor
   * @param {string} competitor - Competitor key
   * @param {string} productTitle - Product title/search term
   * @param {string} modelNumber - Model number
   * @returns {Promise<Object|null>} Price data object
   */
  static async fetchCompetitorPrice(competitor, productTitle, modelNumber) {
    switch (competitor) {
      case 'bestbuy':
        return this.fetchBestBuyPrice(productTitle, modelNumber);
      case 'newegg':
        return this.fetchNeweggPrice(productTitle, modelNumber);
      case 'target':
        return this.fetchTargetPrice(productTitle, modelNumber);
      case 'microcenter':
        return this.fetchMicroCenterPrice(productTitle, modelNumber);
      default:
        return null;
    }
  }

  /**
   * Fetch Best Buy Price
   * @private
   */
  static async fetchBestBuyPrice(productTitle, modelNumber) {
    const searchQuery = modelNumber || productTitle;
    const searchUrl = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(
      searchQuery
    )}`;

    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`Best Buy HTTP ${response.status}`);
      }

      const html = await response.text();

      const price = this.extractBestBuyPrice(html);
      if (price === null) {
        return null;
      }

      const productUrl = this.extractBestBuyProductUrl(html, searchUrl);

      return {
        store: 'Best Buy',
        price: price,
        url: productUrl,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Best Buy fetch failed:', error);
      return null;
    }
  }

  /**
   * Fetch Newegg Price
   * @private
   */
  static async fetchNeweggPrice(productTitle, modelNumber) {
    const searchQuery = modelNumber || productTitle;
    const url = `https://www.newegg.com/p/pl?d=${encodeURIComponent(searchQuery)}`;

    try {
      const response = await fetch(url);
      const html = await response.text();
      const price = this.extractPriceFromHTML(html, 'newegg');

      return {
        store: 'Newegg',
        price: price,
        url: url,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Newegg fetch failed:', error);
      return null;
    }
  }

  /**
   * Fetch Target Price
   * @private
   */
  static async fetchTargetPrice(productTitle, modelNumber) {
    const searchQuery = modelNumber || productTitle;
    const url = `https://www.target.com/s?searchTerm=${encodeURIComponent(searchQuery)}`;

    try {
      const response = await fetch(url);
      const html = await response.text();
      const price = this.extractPriceFromHTML(html, 'target');

      return {
        store: 'Target',
        price: price,
        url: url,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Target fetch failed:', error);
      return null;
    }
  }

  /**
   * Fetch Micro Center Price
   * @private
   */
  static async fetchMicroCenterPrice(productTitle, modelNumber) {
    const searchQuery = modelNumber || productTitle;
    const url = `https://www.microcenter.com/search/search_results.aspx?searchterm=${encodeURIComponent(
      searchQuery
    )}`;

    try {
      const response = await fetch(url);
      const html = await response.text();
      const price = this.extractPriceFromHTML(html, 'microcenter');

      return {
        store: 'Micro Center',
        price: price,
        url: url,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Micro Center fetch failed:', error);
      return null;
    }
  }

  /**
   * Extract price from HTML response
   * This is a placeholder - each retailer would need specific parsing logic
   * @private
   */
  static extractPriceFromHTML(html, store) {
    // TODO: Implement specific parsing for each store
    // This would involve:
    // 1. Creating a temporary DOM parser
    // 2. Querying for product price selectors specific to each store
    // 3. Parsing and validating the price

    // For now, return null as placeholder
    console.warn(`Price extraction not yet implemented for ${store}`);
    return null;
  }
}

export default CompetitorFetcher;
