/**
 * UI Builder - Creates and manages the TrueTag overlay UI
 * Uses Shadow DOM to encapsulate styles and prevent CSS conflicts
 */

class UIBuilder {
  constructor() {
    this.shadowRoot = null;
    this.container = null;
  }

  /**
   * Create and inject the overlay UI
   * @param {Object} priceData - Price comparison data
   * @param {Object} historyData - Price history data
   * @returns {HTMLElement} Created overlay element
   */
  createOverlay(priceData, historyData) {
    // Create container
    this.container = document.createElement('div');
    this.container.id = 'truetag-widget-container';
    this.container.setAttribute('data-truetag', 'true');

    // Attach Shadow DOM
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Import styles via fetch
    this.loadStyles();

    // Build UI structure
    const overlay = this.buildOverlayStructure(priceData, historyData);

    // Append to shadow root
    this.shadowRoot.appendChild(overlay);

    return this.container;
  }

  /**
   * Load and inject CSS into Shadow DOM
   * @private
   */
  loadStyles() {
    // Create style tag
    const styleTag = document.createElement('style');
    
    // Inline the CSS (or fetch it dynamically in production)
    // For this example, we'll use a basic inline version
    const css = this.getStylesCSS();
    styleTag.textContent = css;
    
    this.shadowRoot.appendChild(styleTag);
  }

  /**
   * Get the CSS content
   * In production, this would be imported/fetched separately
   * @private
   */
  getStylesCSS() {
    // This is a simplified version - in production, load from styles.css
    return `
      :host {
        --color-primary: #0f172a;
        --color-primary-light: #1e293b;
        --color-accent: #10b981;
        --color-accent-light: #6ee7b7;
        --color-accent-dark: #059669;
        --color-warning: #f59e0b;
        --color-text-primary: #f1f5f9;
        --color-text-secondary: #cbd5e1;
        --color-bg-overlay: rgba(15, 23, 42, 0.95);
        --color-border: #334155;
        --font-family-base: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 12px;
        --spacing-lg: 16px;
        --spacing-xl: 24px;
        --radius-sm: 6px;
        --radius-md: 8px;
        --radius-lg: 12px;
        --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
        --transition-base: 300ms cubic-bezier(0.4, 0, 0.2, 1);
        --transition-slow: 500ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .truetag-overlay {
        font-family: var(--font-family-base);
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 360px;
        max-width: calc(100vw - 32px);
        background: var(--color-bg-overlay);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-xl);
        z-index: 2147483647;
        animation: slideInUp var(--transition-slow) ease-out forwards;
        color: var(--color-text-primary);
        overflow: hidden;
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

      .truetag-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--color-border);
        gap: var(--spacing-md);
      }

      .truetag-logo {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-weight: 700;
        font-size: 14px;
        letter-spacing: -0.3px;
        text-transform: uppercase;
      }

      .truetag-logo-icon {
        width: 20px;
        height: 20px;
        background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-light) 100%);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 800;
        color: var(--color-primary);
      }

      .truetag-close {
        background: none;
        border: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        padding: var(--spacing-xs);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-sm);
        font-size: 18px;
        line-height: 1;
      }

      .truetag-close:hover {
        background: var(--color-primary-light);
        color: var(--color-text-primary);
      }

      .truetag-content {
        padding: var(--spacing-lg);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .truetag-best-price {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(110, 231, 183, 0.05) 100%);
        border: 1px solid var(--color-accent-dark);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .truetag-best-price-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--color-accent-light);
        opacity: 0.9;
      }

      .truetag-best-price-store {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .truetag-best-price-value {
        font-size: 28px;
        font-weight: 700;
        background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-light) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .truetag-savings {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-accent);
        margin-top: var(--spacing-xs);
      }

      .truetag-footer {
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: 1px solid var(--color-border);
        text-align: center;
        font-size: 11px;
        color: var(--color-text-secondary);
      }
    `;
  }

  /**
   * Build the complete overlay structure
   * @private
   */
  buildOverlayStructure(priceData, historyData) {
    const overlay = document.createElement('div');
    overlay.className = 'truetag-overlay';

    // Header
    overlay.appendChild(this.buildHeader());

    // Content
    overlay.appendChild(this.buildContent(priceData, historyData));

    // Footer
    overlay.appendChild(this.buildFooter());

    return overlay;
  }

  /**
   * Build header with logo and close button
   * @private
   */
  buildHeader() {
    const header = document.createElement('div');
    header.className = 'truetag-header';

    const logo = document.createElement('div');
    logo.className = 'truetag-logo';

    const logoIcon = document.createElement('div');
    logoIcon.className = 'truetag-logo-icon';
    logoIcon.textContent = '₹'; // Price tag symbol

    const logoText = document.createElement('span');
    logoText.textContent = 'TrueTag';

    logo.appendChild(logoIcon);
    logo.appendChild(logoText);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'truetag-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.closeOverlay());

    header.appendChild(logo);
    header.appendChild(closeBtn);

    return header;
  }

  /**
   * Build main content area
   * @private
   */
  buildContent(priceData, historyData) {
    const content = document.createElement('div');
    content.className = 'truetag-content';

    // Best price section
    if (priceData && priceData.bestPrice) {
      content.appendChild(this.buildBestPriceSection(priceData));
    }

    // Price history section
    if (historyData) {
      content.appendChild(this.buildPriceHistorySection(historyData));
    }

    return content;
  }

  /**
   * Build best price section
   * @private
   */
  buildBestPriceSection(priceData) {
    const section = document.createElement('div');
    section.className = 'truetag-best-price';

    const label = document.createElement('div');
    label.className = 'truetag-best-price-label';
    label.textContent = 'Best Price Found';

    const store = document.createElement('div');
    store.className = 'truetag-best-price-store';
    store.textContent = priceData.bestPrice.store || 'Unknown Store';

    const price = document.createElement('div');
    price.className = 'truetag-best-price-value';
    price.textContent = `$${priceData.bestPrice.price.toFixed(2)}`;

    section.appendChild(label);
    section.appendChild(store);
    section.appendChild(price);

    // Add savings if available
    if (priceData.amazonPrice && priceData.bestPrice.price < priceData.amazonPrice) {
      const savings = document.createElement('div');
      savings.className = 'truetag-savings';
      const savingsAmount = (priceData.amazonPrice - priceData.bestPrice.price).toFixed(2);
      savings.textContent = `Save $${savingsAmount}`;
      section.appendChild(savings);
    }

    return section;
  }

  /**
   * Build price history section
   * @private
   */
  buildPriceHistorySection(historyData) {
    const section = document.createElement('div');
    section.className = 'truetag-price-history';

    const title = document.createElement('div');
    title.className = 'truetag-history-title';
    title.textContent = '30-Day Average';

    const badge = document.createElement('div');
    badge.className = 'truetag-history-badge';

    if (historyData.isGoodDeal) {
      badge.classList.add('great-deal');
      badge.textContent = '✓ Great Deal';
    } else {
      badge.classList.add('fair-deal');
      badge.textContent = '• Fair Price';
    }

    section.appendChild(title);
    section.appendChild(badge);

    return section;
  }

  /**
   * Build footer
   * @private
   */
  buildFooter() {
    const footer = document.createElement('div');
    footer.className = 'truetag-footer';
    footer.textContent = 'Powered by TrueTag';

    return footer;
  }

  /**
   * Close and remove overlay
   * @public
   */
  closeOverlay() {
    if (this.container && this.container.parentNode) {
      this.container.remove();
      this.container = null;
      this.shadowRoot = null;
    }
  }

  /**
   * Inject overlay into page
   * @public
   */
  injectIntoPage() {
    if (this.container && !document.body.contains(this.container)) {
      document.body.appendChild(this.container);
    }
  }
}

export default UIBuilder;
