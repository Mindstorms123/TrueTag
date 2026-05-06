/**
 * Amazon Product Scraper
 * Extracts product information from Amazon product pages
 */

class AmazonScraper {
  /**
   * Extract product information from Amazon DOM
   * @returns {Object} Product data object
   */
  static scrapeProductInfo() {
    try {
      const product = {
        title: this.getProductTitle(),
        price: this.getProductPrice(),
        modelNumber: this.getModelNumber(),
        asin: this.getASIN(),
        imageUrl: this.getProductImage(),
        currentUrl: window.location.href,
      };

      // Validate that we have minimum required data
      if (!product.title || !product.price || !product.modelNumber) {
        throw new Error('Missing required product data');
      }

      return product;
    } catch (error) {
      console.error('Failed to scrape product info:', error);
      return null;
    }
  }

  /**
   * Get product title from Amazon page
   * @returns {string|null}
   */
  static getProductTitle() {
    // Try multiple selectors as Amazon changes DOM structure
    const selectors = [
      'h1 span#productTitle',
      '.product-title',
      '[data-feature-name="title"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent.trim();
      }
    }

    return null;
  }

  /**
   * Get product current price
   * @returns {number|null}
   */
  static getProductPrice() {
    const selectors = [
      '.a-price-whole',
      '.a-price.a-text-price.a-size-medium',
      '[data-a-color="price"]',
      '.a-price-whole span',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const priceText = element.textContent.trim();
        const price = this.parsePriceString(priceText);
        if (price !== null) {
          return price;
        }
      }
    }

    return null;
  }

  /**
   * Extract model number from product details
   * @returns {string|null}
   */
  static getModelNumber() {
    // Look for model number in product details
    const detailsTable = document.querySelector('[data-feature-name="detailBullets"]');
    if (detailsTable) {
      const rows = detailsTable.querySelectorAll('li');
      for (const row of rows) {
        const text = row.textContent;
        // Check for common model number indicators
        if (
          text.includes('Model Number') ||
          text.includes('Model #') ||
          text.includes('Model:')
        ) {
          const modelNumber = text.split(':')[1]?.trim() || text.split('Number')[1]?.trim();
          if (modelNumber) {
            return modelNumber.replace(/[^a-zA-Z0-9-]/g, '').trim();
          }
        }
      }
    }

    // Fallback: use ASIN if available
    const asin = this.getASIN();
    if (asin) {
      // Extract model from page title if possible
      const title = this.getProductTitle();
      if (title) {
        // Extract model-like patterns from title
        const match = title.match(/[A-Z0-9]{3,}/);
        if (match) {
          return match[0];
        }
      }
      return asin;
    }

    return null;
  }

  /**
   * Get ASIN (Amazon Standard Identification Number)
   * @returns {string|null}
   */
  static getASIN() {
    // ASIN is typically in the URL
    const urlMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
    if (urlMatch) {
      return urlMatch[1];
    }

    // Fallback: look in page data
    const element = document.querySelector('[data-asin]');
    if (element) {
      return element.getAttribute('data-asin');
    }

    return null;
  }

  /**
   * Get product image URL
   * @returns {string|null}
   */
  static getProductImage() {
    const img = document.querySelector('img.a-dynamic-image');
    if (img && img.src) {
      return img.src;
    }

    const containerImg = document.querySelector('.a-unrotated-image-container img');
    if (containerImg && containerImg.src) {
      return containerImg.src;
    }

    return null;
  }

  /**
   * Parse price string to number
   * Handles formats like "$99.99", "$1,299.99"
   * @param {string} priceString
   * @returns {number|null}
   */
  static parsePriceString(priceString) {
    if (!priceString) return null;

    // Remove currency symbols and commas
    const cleanPrice = priceString
      .replace(/[$€£¥]/g, '')
      .replace(/,/g, '')
      .trim();

    const price = parseFloat(cleanPrice);

    // Validate it's a reasonable price
    if (!isNaN(price) && price > 0 && price < 1000000) {
      return Math.round(price * 100) / 100;
    }

    return null;
  }

  /**
   * Check if we're on an Amazon product page
   * @returns {boolean}
   */
  static isAmazonProductPage() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    const isAmazonHost = host === 'www.amazon.com' || host === 'www.amazon.de';
    const hasProductPath = /\/(?:.*\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/.test(path);
    return isAmazonHost && hasProductPath;
  }
}

export default AmazonScraper;
