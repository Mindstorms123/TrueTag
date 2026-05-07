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

    // Don't clear immediately - let the panel persist until user saves or closes
    // The panel will clear on successful save
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
  console.log('ShopScraper: Showing elegant price capture panel');

  // Extract price from page first
  const extractedPrice = extractPriceFromPage();
  console.log('ShopScraper: Extracted price from page:', extractedPrice);

  // Validate extracted price - only use if within reasonable range of Amazon price
  let validatedPrice = null;
  if (extractedPrice && productInfo.amazonPrice) {
    const ratio = extractedPrice / productInfo.amazonPrice;
    // Only accept prices between 50% and 200% of Amazon price
    if (ratio >= 0.5 && ratio <= 2.0) {
      validatedPrice = extractedPrice;
      console.log(`ShopScraper: ✅ Extracted price validated (ratio: ${ratio.toFixed(2)})`);
    } else {
      console.log(`ShopScraper: ⚠️ Extracted price seems wrong (ratio: ${ratio.toFixed(2)}), ignoring`);
    }
  } else if (extractedPrice) {
    // No Amazon price to compare, use extracted price but mark as uncertain
    validatedPrice = extractedPrice;
    console.log('ShopScraper: ⚠️ No Amazon price to validate against');
  }

  // Create shadow DOM container for elegant panel
  const container = document.createElement('div');
  container.id = 'truetag-price-panel';
  container.setAttribute('data-truetag', 'true');

  const shadowRoot = container.attachShadow({ mode: 'open' });

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    :host {
      --color-primary: #0f172a;
      --color-accent: #10b981;
      --color-text: #f1f5f9;
      --color-border: #334155;
    }

    .truetag-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 380px;
      max-width: calc(100vw - 40px);
      background: rgba(15, 23, 42, 0.97);
      border: 1px solid var(--color-border);
      border-radius: 14px;
      box-shadow: 0 20px 35px rgba(0, 0, 0, 0.6);
      z-index: 2147483647;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--color-text);
      animation: slideInUp 400ms ease-out;
    }

    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .panel-title {
      font-weight: 700;
      font-size: 14px;
      letter-spacing: -0.3px;
      text-transform: uppercase;
    }

    .panel-close {
      background: none;
      border: none;
      color: #cbd5e1;
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .panel-close:hover {
      color: var(--color-text);
    }

    .product-info {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.05));
      border: 1px solid #065f46;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 12px;
      font-size: 13px;
    }

    .product-title {
      font-weight: 600;
      margin-bottom: 4px;
    }

    .product-price {
      color: #86efac;
      font-size: 12px;
      margin-bottom: 4px;
    }

    .amazon-price {
      color: #64748b;
      font-size: 11px;
    }

    .price-input-group {
      margin-bottom: 12px;
    }

    .price-label {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      display: block;
      color: #cbd5e1;
    }

    .price-input {
      width: 100%;
      padding: 10px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      background: #1e293b;
      color: var(--color-text);
      font-size: 14px;
      font-weight: 600;
      box-sizing: border-box;
    }

    .price-input:focus {
      outline: none;
      border-color: var(--color-accent);
      background: #273548;
    }

    .button-group {
      display: flex;
      gap: 8px;
    }

    .btn {
      flex: 1;
      padding: 10px;
      border-radius: 8px;
      border: none;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 200ms ease;
    }

    .btn-confirm {
      background: var(--color-accent);
      color: #082f1d;
    }

    .btn-confirm:hover {
      background: #059669;
    }

    .btn-cancel {
      background: #334155;
      color: var(--color-text);
    }

    .btn-cancel:hover {
      background: #475569;
    }

    .status-message {
      font-size: 12px;
      padding: 8px;
      border-radius: 6px;
      text-align: center;
      margin-bottom: 8px;
    }

    .status-success {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid #065f46;
      color: #86efac;
    }

    .status-error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid #7f1d1d;
      color: #fca5a5;
    }
  `;

  // Build HTML
  const panel = document.createElement('div');
  panel.className = 'truetag-panel';

  panel.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">✓ TrueTag</div>
      <button class="panel-close" id="panel-close">×</button>
    </div>

    <div class="product-info">
      <div class="product-title">${productInfo.title}</div>
      <div class="product-price">Store: ${productInfo.store}</div>
      <div class="amazon-price">Amazon: $${(productInfo.amazonPrice || 0).toFixed(2)}</div>
    </div>

    <div id="status-message"></div>

    <div class="price-input-group">
      <label class="price-label">Did you find this product? Enter the price:</label>
      <input 
        type="number" 
        id="price-input" 
        class="price-input" 
        placeholder="e.g. 299.99"
        value="${validatedPrice ? validatedPrice.toFixed(2) : ''}"
        step="0.01"
        min="0"
      >
    </div>

    <div class="button-group">
      <button id="btn-confirm" class="btn btn-confirm">✓ Yes, Save</button>
      <button id="btn-cancel" class="btn btn-cancel">✗ Cancel</button>
    </div>
  `;

  shadowRoot.appendChild(style);
  shadowRoot.appendChild(panel);

  // Event listeners
  const closeBtn = shadowRoot.getElementById('panel-close');
  const confirmBtn = shadowRoot.getElementById('btn-confirm');
  const cancelBtn = shadowRoot.getElementById('btn-cancel');
  const priceInput = shadowRoot.getElementById('price-input');
  const statusMsg = shadowRoot.getElementById('status-message');

  closeBtn.addEventListener('click', () => {
    container.remove();
    clearProductInfo();
  });

  cancelBtn.addEventListener('click', () => {
      clearProductInfo();
    container.remove();
  });

  confirmBtn.addEventListener('click', async () => {
    const price = parseFloat(priceInput.value);

    if (!price || !Number.isFinite(price) || price <= 0) {
      showStatus(statusMsg, '❌ Please enter a valid price', 'error');
      return;
    }

    // Disable button during save
    confirmBtn.disabled = true;
    confirmBtn.textContent = '⏳ Saving...';

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
          showStatus(statusMsg, '❌ Error saving price', 'error');
          confirmBtn.disabled = false;
          confirmBtn.textContent = '✓ Yes, Save';
          return;
        }

        if (response.success) {
          console.log('ShopScraper: Price saved successfully');
          showStatus(statusMsg, `✅ Price saved for ${productInfo.store}!`, 'success');
          
          // Close after 2 seconds
          setTimeout(() => {
                        clearProductInfo();
            container.remove();
          }, 2000);
        } else {
          console.error('ShopScraper: Save failed', response.error);
          showStatus(statusMsg, `❌ Error: ${response.error}`, 'error');
          confirmBtn.disabled = false;
          confirmBtn.textContent = '✓ Yes, Save';
        }
      }
    );
  });

  document.body.appendChild(container);
}

function showStatus(element, message, type) {
  const status = document.createElement('div');
  status.className = `status-message status-${type}`;
  status.textContent = message;
  
  element.innerHTML = '';
  element.appendChild(status);
}

async function clearProductInfo() {
  try {
    await chrome.storage.local.remove('truetag_product_info');
    console.log('ShopScraper: Cleared product info from storage');
  } catch (error) {
    console.error('ShopScraper: Error clearing product info', error);
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
    // Try only explicit product-price selectors on Best Buy
    const selectors = [
      '[data-testid="customer-price"]',
      '[data-testid="shop-product-price"]',
      '[itemprop="price"]',
      'meta[property="product:price:amount"]',
      'meta[itemprop="price"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.content || element.getAttribute('content') || element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Best Buy price found:', price);
          return price;
        }
      }
    }

    // Fallback: inspect visible price-like nodes in the product summary area.
    // Prefer the largest displayed price, which is usually the main product price.
    const candidateNodes = Array.from(document.querySelectorAll('main *, [role="main"] *'))
      .filter((element) => {
        const text = (element.textContent || '').trim();
        if (!text) return false;
        return /^\$\d{2,5}(?:\.\d{2})?$/.test(text) || /\$\d{2,5}(?:\.\d{2})?/.test(text);
      })
      .map((element) => {
        const text = (element.textContent || '').trim();
        const price = extractNumericPrice(text);
        const fontSize = Number.parseFloat(window.getComputedStyle(element).fontSize || '0') || 0;
        const rect = element.getBoundingClientRect();
        const visibleArea = rect.width > 0 && rect.height > 0 ? rect.width * rect.height : 0;
        return { element, text, price, fontSize, visibleArea };
      })
      .filter((candidate) => candidate.price && candidate.price > 50 && candidate.price < 10000);

    if (candidateNodes.length > 0) {
      candidateNodes.sort((a, b) => {
        if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
        if (b.visibleArea !== a.visibleArea) return b.visibleArea - a.visibleArea;
        return b.price - a.price;
      });

      const bestCandidate = candidateNodes[0];
      console.log('ShopScraper: Best Buy visible fallback price found:', bestCandidate.price, bestCandidate.text);
      return bestCandidate.price;
    }

    console.log('ShopScraper: Best Buy price not found with strict selectors or visible fallback');
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
    // Try only explicit product-price selectors on Newegg
    const selectors = [
      '[itemprop="price"]',
      'meta[property="product:price:amount"]',
      'meta[itemprop="price"]',
      '[class*="Price-current"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.content || element.getAttribute('content') || element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Newegg price found:', price);
          return price;
        }
      }
    }

    console.log('ShopScraper: Newegg price not found with strict selectors');
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
    // Try only explicit product-price selectors on Target
    const selectors = [
      '[data-test="product-price"]',
      '[data-testid="product-price"]',
      '[itemprop="price"]',
      'meta[property="product:price:amount"]',
      'meta[itemprop="price"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.content || element.getAttribute('content') || element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Target price found:', price);
          return price;
        }
      }
    }

    console.log('ShopScraper: Target price not found with strict selectors');
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
    // Try only explicit product-price selectors on Micro Center
    const selectors = [
      '[itemprop="price"]',
      'meta[property="product:price:amount"]',
      'meta[itemprop="price"]',
      '[class*="actualPrice"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        const text = element.content || element.getAttribute('content') || element.textContent;
        const price = extractNumericPrice(text);
        if (price) {
          console.log('ShopScraper: Micro Center price found:', price);
          return price;
        }
      }
    }

    console.log('ShopScraper: Micro Center price not found with strict selectors');
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
// Persist check every 2 seconds to handle navigations within the shop
setInterval(() => {
  // Only check if no panel is currently shown
  if (!document.getElementById('truetag-price-panel')) {
    checkForPendingProductInfo();
  }
}, 2000);
