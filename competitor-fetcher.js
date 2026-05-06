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

  static extractFirstPriceByPatterns(html, patterns) {
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const normalized = String(match[1]).replace(/,/g, '');
      const price = this.parsePriceValue(normalized);
      if (price !== null) {
        return price;
      }
    }

    return null;
  }

  static extractJsonLdProductPrice(html) {
    const scripts = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const script of scripts) {
      const jsonText = script
        .replace(/<script[^>]*>/i, '')
        .replace(/<\/script>/i, '')
        .trim();

      try {
        const parsed = JSON.parse(jsonText);
        const nodes = Array.isArray(parsed) ? parsed : [parsed];

        for (const node of nodes) {
          const offers = node?.offers;
          if (!offers) {
            continue;
          }

          const offerItems = Array.isArray(offers) ? offers : [offers];
          for (const offer of offerItems) {
            const price = this.parsePriceValue(offer?.price);
            if (price !== null) {
              return price;
            }
          }
        }
      } catch {
        // Ignore non-JSON-LD script payloads.
      }
    }

    return null;
  }

  static normalizeStoreUrl(baseUrl, pathOrUrl) {
    if (!pathOrUrl) {
      return null;
    }

    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return pathOrUrl;
    }

    if (pathOrUrl.startsWith('/')) {
      return `${baseUrl}${pathOrUrl}`;
    }

    return `${baseUrl}/${pathOrUrl}`;
  }

  static extractFirstUrlByPatterns(html, baseUrl, patterns, fallbackUrl) {
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        return this.normalizeStoreUrl(baseUrl, match[1].replace(/\\u002F/g, '/'));
      }
    }

    return fallbackUrl;
  }

  static isLikelyBlockedOrFallbackPage(html) {
    const markers = [
      'are you a human',
      'verify you are a human',
      'captcha',
      'access denied',
      'temporarily unavailable',
    ];

    const normalized = (html || '').toLowerCase();
    return markers.some((marker) => normalized.includes(marker));
  }

  static isValidNeweggProductUrl(url) {
    if (!url) {
      return false;
    }

    if (!/^https:\/\/www\.newegg\.com\//i.test(url)) {
      return false;
    }

    if (/\/p\/pl\b/i.test(url)) {
      return false;
    }

    return /\/p\/[A-Z0-9-]+/i.test(url);
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
        verified: true,
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
    const searchUrl = `https://www.newegg.com/p/pl?d=${encodeURIComponent(searchQuery)}`;

    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`Newegg HTTP ${response.status}`);
      }

      const html = await response.text();
      if (this.isLikelyBlockedOrFallbackPage(html)) {
        return null;
      }

      const pricePatterns = [
        /"finalPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
        /"currentPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
        /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?\s*,\s*"currency"/i,
        /\$([0-9][0-9,]*(?:\.[0-9]{2})?)<\/strong>/i,
      ];

      const price = this.extractFirstPriceByPatterns(html, pricePatterns) || this.extractJsonLdProductPrice(html);
      if (price === null) {
        return null;
      }

      const productUrl = this.extractFirstUrlByPatterns(
        html,
        'https://www.newegg.com',
        [
          /href="(https:\/\/www\.newegg\.com\/[^"]+\/p\/[A-Z0-9-]+)"/i,
          /href="(\/[^"]+\/p\/[A-Z0-9-]+)"/i,
        ],
        null
      );

      if (!this.isValidNeweggProductUrl(productUrl)) {
        return null;
      }

      return {
        store: 'Newegg',
        price: price,
        url: productUrl,
        verified: true,
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
    const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(searchQuery)}`;

    try {
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`Target HTTP ${response.status}`);
      }

      const html = await response.text();
      const pricePatterns = [
        /"current_retail"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i,
        /"formatted_current_price"\s*:\s*"\$?([0-9]+(?:\.[0-9]+)?)"/i,
        /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?\s*,\s*"priceCurrency"/i,
        /\$([0-9][0-9,]*(?:\.[0-9]{2})?)<\/span>/i,
      ];

      const price = this.extractFirstPriceByPatterns(html, pricePatterns) || this.extractJsonLdProductPrice(html);
      if (price === null) {
        return null;
      }

      const productUrl = this.extractFirstUrlByPatterns(
        html,
        'https://www.target.com',
        [
          /href="(\/p\/[^"]+-\/A-[0-9]+)"/i,
          /"canonical"\s*:\s*"(https:\/\/www\.target\.com\/[^"]+)"/i,
        ],
        searchUrl
      );

      return {
        store: 'Target',
        price: price,
        url: productUrl,
        verified: true,
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
    const searchUrl = `https://www.microcenter.com/search/search_results.aspx?searchterm=${encodeURIComponent(
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
        throw new Error(`Micro Center HTTP ${response.status}`);
      }

      const html = await response.text();
      const pricePatterns = [
        /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?\s*,\s*"priceCurrency"/i,
        /"currentPrice"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i,
        /data-price="([0-9]+(?:\.[0-9]+)?)"/i,
        /\$([0-9][0-9,]*(?:\.[0-9]{2})?)<\/span>/i,
      ];

      const price = this.extractFirstPriceByPatterns(html, pricePatterns) || this.extractJsonLdProductPrice(html);
      if (price === null) {
        return null;
      }

      const productUrl = this.extractFirstUrlByPatterns(
        html,
        'https://www.microcenter.com',
        [
          /href="(\/product\/[0-9]+\/[^"]+)"/i,
          /"canonical"\s*:\s*"(https:\/\/www\.microcenter\.com\/[^"]+)"/i,
        ],
        searchUrl
      );

      return {
        store: 'Micro Center',
        price: price,
        url: productUrl,
        verified: true,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Micro Center fetch failed:', error);
      return null;
    }
  }
}

export default CompetitorFetcher;
