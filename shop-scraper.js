/**
 * Shop Price Scraper
 * Content script that runs on Best Buy, Newegg, Target, and Micro Center
 * Extracts product prices from these sites for TrueTag
 */

// Listen for price extraction requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXTRACT_PRICE') {
    const price = extractPriceFromPage();
    sendResponse({ price: price });
  }
});

// On page load, check if there's product info waiting
document.addEventListener('DOMContentLoaded', () => {
  console.log('ShopScraper: DOMContentLoaded fired');
  setTimeout(checkForPendingProductInfo, 500);
});

// Also check immediately in case DOM is already loaded
if (document.readyState === 'complete') {
  console.log('ShopScraper: DOM already complete');
  setTimeout(checkForPendingProductInfo, 500);
} else {
  setTimeout(checkForPendingProductInfo, 1000);
}

/**
 * Check if there's product info from Amazon page (user clicked "Found")
 */
async function checkForPendingProductInfo() {
  try {
    console.log('ShopScraper: Checking for pending product info...');
    const stored = await chrome.storage.local.get('truetag_product_info');
    const productInfo = stored['truetag_product_info'];

    if (!productInfo) {
      console.log('ShopScraper: ❌ No pending product info found');
      return;
    }

    console.log('ShopScraper: ✅ Found pending product info:', productInfo);

    // Check if this is from the same store
    const domain = getStoreDomain(productInfo.store);
    const isCorrectStore = window.location.href.includes(domain);
    console.log(`ShopScraper: Store check - Looking for "${domain}" in URL: ${isCorrectStore}`);

    if (!isCorrectStore) {
      console.log(`ShopScraper: ❌ Store mismatch - Expected ${domain}, skipping`);
      return;
    }

    // Show the capture dialog
    console.log('ShopScraper: 📋 Showing price capture dialog');
    showPriceCaptureDialog(productInfo);

    // Clear the stored info after showing dialog
    await chrome.storage.local.remove('truetag_product_info');
  } catch (error) {
    console.error('ShopScraper: Error checking for product info', error);
  }
}

/**
 * Get domain to match store
 */
function getStoreDomain(store) {
  if (store.includes('Best Buy')) return 'bestbuy.com';
  if (store.includes('Newegg')) return 'newegg.com';
  if (store.includes('Target')) return 'target.com';
  if (store.includes('Micro Center')) return 'microcenter.com';
  return '';
}

/**
 * Show dialog to capture price and confirm product
 */
function showPriceCaptureDialog(productInfo) {
  console.log('ShopScraper: Showing price capture dialog');

  // Extract price from page first
  const extractedPrice = extractPriceFromPage();
  console.log('ShopScraper: Extracted price from page:', extractedPrice);

  // Step 1: Ask if this is the same product
  const isSameProduct = confirm(
    `Is this the same product?\n\n` +
    `Product: ${productInfo.title}\n` +
    `Amazon: $${(productInfo.amazonPrice || 0).toFixed(2)}\n\n` +
    `Store: ${productInfo.store}`
  );

  if (!isSameProduct) {
    console.log('ShopScraper: User declined product match');
    return;
  }

  // Step 2: Ask for price (with extracted price as default if available)
  let price = null;

  if (extractedPrice) {
    // Price was extracted - ask for confirmation
    const confirmed = confirm(
      `Found price: $${extractedPrice.toFixed(2)}\n\n` +
      `Is this correct?`
    );

    if (confirmed) {
      price = extractedPrice;
    } else {
      // Ask user to enter manually
      const input = prompt(
        `Enter the price you see:\n` +
        `(Example: 299.99)`,
        extractedPrice.toFixed(2)
      );
      if (input) {
        price = parseFloat(input);
      }
    }
  } else {
    // No auto-extracted price, ask manually
    const input = prompt(
      `Enter the price you found at ${productInfo.store}:\n` +
      `(Example: 299.99)`,
      ''
    );
    if (input) {
      price = parseFloat(input);
    }
  }

  if (!price || !Number.isFinite(price) || price <= 0) {
    alert('❌ Invalid price. Could not save.');
    return;
  }

  // Step 3: Final confirmation
  const saveConfirmed = confirm(
    `Save this price?\n\n` +
    `Store: ${productInfo.store}\n` +
    `Price: $${price.toFixed(2)}\n` +
    `Product: ${productInfo.title}`
  );

  if (saveConfirmed) {
    // Send message to background to save price
    chrome.runtime.sendMessage(
      {
        type: 'SAVE_COMPETITOR_PRICE',
        productInfo: productInfo,
        price: price,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('ShopScraper: Message error', chrome.runtime.lastError);
          alert('❌ Error saving price');
          return;
        }

        if (response.success) {
          console.log('ShopScraper: Price saved successfully');
          alert(`✅ Price saved for ${productInfo.store}!`);
        } else {
          console.error('ShopScraper: Save failed', response.error);
          alert(`❌ Failed to save: ${response.error}`);
        }
      }
    );
  }
}

/**
 * Extract price from current page based on site
 */
function extractPriceFromPage() {
  const url = window.location.href;
  console.log('ShopScraper: Extracting price from:', url);

  if (url.includes('bestbuy.com')) {
    return extractBestBuyPrice();
  } else if (url.includes('newegg.com')) {
    return extractNeweggPrice();
  } else if (url.includes('target.com')) {
    return extractTargetPrice();
  } else if (url.includes('microcenter.com')) {
    return extractMicroCenterPrice();
  }

  return null;
}

/**
 * Extract price from Best Buy product page
 */
function extractBestBuyPrice() {
  try {
    // Try different price selectors on Best Buy
    const selectors = [
      '[data-testid="priceblock"] [class*="price"]',
      '[class*="Price"] [class*="currency"]',
      'div[class*="priceLarge"]',
      'span[class*="Price"]',
      '[aria-label*="$"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Best Buy price found:', price);
          return price;
        }
      }
    }

    // Fallback: Search all page text for price patterns
    const pageText = document.body.innerText;
    const prices = pageText.match(/\$\s*(\d+\.?\d{0,2})/g);
    if (prices && prices.length > 0) {
      const price = extractNumericPrice(prices[0]);
      if (price && price > 50 && price < 10000) {
        console.log('ShopScraper: Best Buy price (fallback):', price);
        return price;
      }
    }
  } catch (error) {
    console.error('ShopScraper: Best Buy extraction error', error);
  }

  return null;
}

/**
 * Extract price from Newegg product page
 */
function extractNeweggPrice() {
  try {
    // Try Newegg price selectors
    const selectors = [
      '[class*="Price-priceLarge"]',
      'div[class*="money"]',
      '[class*="CurrentPrice"]',
      '[class*="priceLarge"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Newegg price found:', price);
          return price;
        }
      }
    }

    // Fallback: Search for price patterns
    const pageText = document.body.innerText;
    const prices = pageText.match(/\$\s*(\d+\.?\d{0,2})/g);
    if (prices && prices.length > 0) {
      const price = extractNumericPrice(prices[0]);
      if (price && price > 50 && price < 10000) {
        console.log('ShopScraper: Newegg price (fallback):', price);
        return price;
      }
    }
  } catch (error) {
    console.error('ShopScraper: Newegg extraction error', error);
  }

  return null;
}

/**
 * Extract price from Target product page
 */
function extractTargetPrice() {
  try {
    // Try Target price selectors
    const selectors = [
      '[data-testid="price"]',
      '[class*="CellPrice"]',
      '[class*="Price-module"]',
      'span[class*="price"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Target price found:', price);
          return price;
        }
      }
    }

    // Fallback: Search for price patterns
    const pageText = document.body.innerText;
    const prices = pageText.match(/\$\s*(\d+\.?\d{0,2})/g);
    if (prices && prices.length > 0) {
      const price = extractNumericPrice(prices[0]);
      if (price && price > 50 && price < 10000) {
        console.log('ShopScraper: Target price (fallback):', price);
        return price;
      }
    }
  } catch (error) {
    console.error('ShopScraper: Target extraction error', error);
  }

  return null;
}

/**
 * Extract price from Micro Center product page
 */
function extractMicroCenterPrice() {
  try {
    // Try Micro Center price selectors
    const selectors = [
      '[class*="price"]',
      '[id*="price"]',
      'span[class*="Price"]',
      'div[class*="actualPrice"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Micro Center price found:', price);
          return price;
        }
      }
    }

    // Fallback: Search for price patterns
    const pageText = document.body.innerText;
    const prices = pageText.match(/\$\s*(\d+\.?\d{0,2})/g);
    if (prices && prices.length > 0) {
      const price = extractNumericPrice(prices[0]);
      if (price && price > 50 && price < 10000) {
        console.log('ShopScraper: Micro Center price (fallback):', price);
        return price;
      }
    }
  } catch (error) {
    console.error('ShopScraper: Micro Center extraction error', error);
  }

  return null;
}

/**
 * Extract numeric price from text
 */
function extractNumericPrice(text) {
  if (!text) return null;

  // Match price patterns like $299.99, $599, 299.99, etc.
  const match = text.match(/\$?\s*(\d+\.?\d{0,2})/);
  if (match && match[1]) {
    const price = parseFloat(match[1]);
    if (Number.isFinite(price) && price > 0 && price < 100000) {
      return price;
    }
  }

  return null;
}

console.log('ShopScraper: Content script loaded');
