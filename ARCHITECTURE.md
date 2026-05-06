# TrueTag Architecture & Design Document

## Executive Summary

**TrueTag** is a premium Chrome Extension (Manifest V3) that provides price comparison and price history tracking for tech products on Amazon, integrating with Best Buy, Newegg, Target, and Micro Center. The architecture prioritizes user experience with a non-intrusive, beautiful UI while maintaining clean code organization and extensibility.

---

## 1. Design System & UI/UX Philosophy

### 1.1 Color Palette

| Variable | Value | Purpose |
|----------|-------|---------|
| Primary | `#0f172a` | Deep slate base for trust & professionalism |
| Primary Light | `#1e293b` | Secondary backgrounds, cards |
| Accent | `#10b981` | Primary CTA, savings highlights |
| Accent Light | `#6ee7b7` | Better contrast alternative |
| Text Primary | `#f1f5f9` | Main text (99% of content) |
| Text Secondary | `#cbd5e1` | Labels, secondary info |
| Background Overlay | `rgba(15, 23, 42, 0.95)` | Semi-transparent dark background |
| Border | `#334155` | Subtle borders & dividers |

### 1.2 Rationale for Color Choices

**Deep Indigo/Slate Base**
- Conveys trust, security, and professionalism—essential for financial/price data
- Reduces eye strain during extended browsing
- Creates strong contrast for readability

**Emerald Green Accents**
- Universally associated with savings, growth, and "go" actions
- Creates visual hierarchy for "best price" and savings information
- High contrast on dark background (WCAG AAA compliant)

**Typography**
- System UI stack ensures consistency with user's OS
- Sans-serif for modern, clean appearance
- Weights: 600 (UI labels), 700 (headers), 800 (emphasis)

### 1.3 UI/UX Behavior

**Non-Intrusive Overlay Design**
```
Problem: Users hate extensions that break website layouts
Solution: 
  1. Float in bottom-right corner (least intrusive position)
  2. Only appear when value is clear (savings ≥$10 OR price history exists)
  3. Easily dismissible (X button in header)
  4. Graceful fade-in animation (300ms)
  5. Shadow DOM for complete style isolation
```

**Information Hierarchy**
```
1. Logo + Close Button (Minimal, clear branding)
2. Best Price Section (Most important - highlighted in green)
   - Store name + Price in large gradient text
   - Savings amount displayed prominently
3. Price History Insight (30-day context)
   - Deal badge ("Great Deal" / "Fair Price")
   - Historical avg/min/max for reference
4. Footer (Subtle branding)
```

### 1.4 Animations & Transitions

- **Slide-in**: 500ms ease-out (overlay entrance)
- **Hover effects**: 150ms smooth transitions (on clickable elements)
- **Loading shimmer**: Infinite loop on skeleton loaders

---

## 2. Architecture Overview

### 2.1 High-Level Flow

```
User visits Amazon product page
        ↓
Content Script Initializes (content.js)
        ↓
        ├─→ Scrape Amazon DOM (amazon-scraper.js)
        │   └─→ Extract: title, price, model number, ASIN
        │
        ├─→ Fetch Price History (supabase-client.js)
        │   └─→ Query price_history table for last 30 days
        │
        └─→ Background Message: Fetch Competitor Prices (background.js)
            └─→ CompetitorFetcher queries Best Buy, Newegg, Target, Micro Center
        
        ↓ (Parallel operations complete)
        
Process Data (content.js)
    ├─→ Calculate average price from history
    ├─→ Identify best competitor price
    ├─→ Determine if deal is "great" (10%+ below avg)
    └─→ Check if overlay should show (savings ≥$10 OR history exists)
        
        ↓ (If showOverlay = true)
        
Create & Inject UI (ui-builder.js)
    ├─→ Create Shadow DOM container
    ├─→ Encapsulate styles (prevent CSS conflicts)
    ├─→ Build component tree
    └─→ Inject into body
    
        ↓
        
Log Price to Database (supabase-client.js)
    └─→ Insert Amazon price record for future history tracking
```

### 2.2 File Structure & Responsibilities

```
manifest.json
├─ Declares extension metadata
├─ Defines permissions (storage, tabs, host_permissions)
└─ Registers content_scripts and background service worker

content.js (Main Orchestrator)
├─ Runs on: amazon.com/dp/*, amazon.com/gp/product/*
├─ Imports: amazon-scraper, supabase-client, ui-builder
├─ Responsibilities:
│  ├─ Detect if on product page
│  ├─ Orchestrate scraping + data fetching
│  ├─ Process data for UI display
│  ├─ Manage UI injection timing
│  └─ Log prices to database
│
└─ Class: TrueTagContentScript

background.js (Background Service Worker)
├─ Lifetime: Persists for entire browser session
├─ Imports: competitor-fetcher, config
├─ Responsibilities:
│  ├─ Listen for messages from content scripts
│  ├─ Fetch competitor prices asynchronously
│  ├─ Cache prices (30-min TTL)
│  ├─ Implement rate limiting
│  └─ Periodic cache cleanup (1-hour intervals)
│
└─ Class: BackgroundWorker

amazon-scraper.js
├─ Pure utility class (no state)
├─ Static methods for DOM queries
├─ Responsibilities:
│  ├─ Extract product title
│  ├─ Extract current price (multi-selector approach)
│  ├─ Extract model number from product details
│  ├─ Extract ASIN from URL
│  ├─ Extract product image
│  ├─ Parse price strings ("$1,299.99" → 1299.99)
│  └─ Validate extracted data
│
└─ Class: AmazonScraper

supabase-client.js
├─ Handles Supabase API communication
├─ Uses REST API (no SDK needed)
├─ Responsibilities:
│  ├─ Authenticate with Supabase via anonKey
│  ├─ Query price_history table
│  ├─ Insert new price records
│  ├─ Calculate average prices
│  ├─ Calculate price ranges (min/max)
│  └─ Handle date filtering
│
└─ Class: SupabaseClient

competitor-fetcher.js
├─ **PLACEHOLDER** - Needs retailer-specific implementation
├─ Structure for fetching from:
│  ├─ Best Buy (bestbuy.com)
│  ├─ Newegg (newegg.com)
│  ├─ Target (target.com)
│  └─ Micro Center (microcenter.com)
├─ TODO:
│  ├─ Implement DOM parsing for each retailer
│  ├─ Handle CORS (Chrome extensions have relaxed restrictions)
│  ├─ Add error handling and timeouts
│  ├─ Consider Playwright for complex sites
│  └─ Test with real product models
│
└─ Class: CompetitorFetcher

ui-builder.js
├─ Creates Shadow DOM for style encapsulation
├─ Builds component tree
├─ Responsibilities:
│  ├─ Create container with Shadow DOM
│  ├─ Load CSS into shadow root
│  ├─ Build header (logo, close button)
│  ├─ Build content sections (best price, history)
│  ├─ Build footer (branding)
│  ├─ Handle user interactions (close button)
│  └─ Inject/remove from page DOM
│
└─ Class: UIBuilder

styles.css
├─ Design system tokens (colors, spacing, shadows, transitions)
├─ Component styles:
│  ├─ .truetag-overlay (main container)
│  ├─ .truetag-header
│  ├─ .truetag-best-price
│  ├─ .truetag-price-history
│  ├─ .truetag-competitor-item
│  └─ ... (etc)
├─ Animations
│  ├─ slideInUp (overlay entrance)
│  └─ shimmer (loading state)
└─ Responsive design (mobile: max-width: 480px)

config.js
├─ Environment configuration
├─ Settings for:
│  ├─ Supabase credentials
│  ├─ Competitor retailers
│  ├─ Price history thresholds
│  ├─ UI timing & animation
│  └─ Debug flag
│
└─ Export: CONFIG object

.env.example
├─ Template for sensitive values
└─ Instructions: Copy to .env, fill values, add to .gitignore
```

---

## 3. Core Features & Implementation Details

### 3.1 Amazon Product Scraping

**Challenge**: Amazon frequently changes their DOM structure

**Solution**: Multiple fallback selectors for each field

```javascript
static getProductTitle() {
  const selectors = [
    'h1 span#productTitle',        // Primary selector
    '.product-title',               // Fallback 1
    '[data-feature-name="title"]', // Fallback 2
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element.textContent.trim();
    }
  }
  return null;
}
```

**Price Parsing**
- Handles various formats: "$99.99", "$1,299.99", "€95,00"
- Removes currency symbols and commas
- Validates range (must be >$0 and <$1,000,000)
- Returns rounded to 2 decimal places

**Model Number Extraction**
Priority order:
1. Search product details table for "Model Number" or "Model #"
2. If available, extract pattern `[A-Z0-9]{3,}`
3. Fallback to ASIN (Amazon product ID)

### 3.2 Price History from Supabase

**Query Structure**
```javascript
// Fetch last 30 days of price history for a model
GET /rest/v1/price_history?
  model_number=eq.MODEL123&
  created_at=gte.2026-04-06T00:00:00.000Z&
  order=created_at.desc&
  limit=1000
```

**Data Processing**
- Calculate 30-day average price
- Identify price range (min/max)
- Determine deal quality:
  - "Great Deal" if ≥10% below average
  - "Fair Price" otherwise

**Schema**
```sql
price_history {
  id: UUID                    -- Primary key
  model_number: TEXT         -- Product identifier
  store: TEXT                -- "Amazon", "Best Buy", etc.
  price: NUMERIC             -- USD price
  created_at: TIMESTAMP      -- Auto-timestamp
}

Index: (model_number, created_at DESC)
```

### 3.3 Background Price Fetching

**Why Background Worker?**
- Prevents blocking user experience
- Runs asynchronously alongside content script
- Caching reduces redundant requests

**Cache Strategy**
```javascript
Cache Key: price_${modelNumber or productTitle}
TTL: 30 minutes
Cleanup: Automatic (every 1 hour)
```

**Message Protocol**
```javascript
// Content Script → Background Worker
{
  type: "FETCH_COMPETITOR_PRICES",
  productTitle: "iPhone 15 Pro",
  modelNumber: "A2847"
}

// Background Worker → Content Script
{
  competitorPrices: {
    bestbuy: { store: "Best Buy", price: 999.99, ... },
    newegg: { store: "Newegg", price: 1099.99, ... },
    target: { store: "Target", price: 949.99, ... },
    microcenter: { store: "Micro Center", price: 979.99, ... }
  }
}
```

### 3.4 UI Injection & Shadow DOM

**Why Shadow DOM?**
- Complete style isolation (Amazon CSS can't interfere)
- Prevents accidental style leaks to host page
- Modern best practice for web components

**Structure**
```javascript
container = new ShadowRoot (mode: 'open')
├── <style> (all CSS, inlined or imported)
└── <div class="truetag-overlay">
    ├── <div class="truetag-header"> (logo + close)
    ├── <div class="truetag-content"> (price data)
    └── <div class="truetag-footer"> (branding)
```

**Positioning**
- Fixed position (bottom-right corner)
- z-index: 2147483647 (very high, but not `999999` to avoid issues)
- Responsive: width adjusts on mobile (<480px)

---

## 4. Detailed Component Architecture

### 4.1 TrueTagContentScript Class

**Lifecycle**
```javascript
init() → 
  isAmazonProductPage() → 
  start() →
    scrapeProductInfo() →
    fetchPriceHistory() →
    requestCompetitorPrices() →
    processDataForUI() →
    injectUI() →
    logCurrentPrice()
```

**Key Methods**

| Method | Purpose | Async |
|--------|---------|-------|
| `init()` | Entry point, checks page type | Yes |
| `start()` | Begin extraction process | Yes |
| `scrapeProductInfo()` | Extract from Amazon DOM | No |
| `fetchPriceHistory()` | Query Supabase | Yes |
| `requestCompetitorPrices()` | Send message to background | Yes |
| `processDataForUI()` | Prepare display data | No |
| `injectUI()` | Create and mount overlay | Yes |
| `logCurrentPrice()` | Insert to database | Yes |

### 4.2 BackgroundWorker Class

**Responsibilities**
```javascript
class BackgroundWorker {
  initMessageListeners()      // Listen for chrome.runtime.onMessage
  handleCompetitorPriceFetch() // Main message handler
  generateCacheKey()          // Create cache key from product
  getCachedPrices()           // Check cache (with TTL)
  setCachedPrices()           // Store in cache
  clearCache()                // Manual cache clear
  schedulePeriodicCleanup()   // Auto cleanup (1-hour interval)
}
```

### 4.3 UIBuilder Class

**Key Methods**
```javascript
createOverlay(priceData, historyData)   // Main entry
buildOverlayStructure()                 // Component tree
buildHeader()                           // Logo + close
buildContent()                          // Price sections
buildBestPriceSection()                // Competitor price highlight
buildPriceHistorySection()             // Deal badge + stats
buildFooter()                          // TrueTag branding
closeOverlay()                         // Remove from DOM
injectIntoPage()                       // Add to body
```

**Shadow DOM Creation**
```javascript
const container = document.createElement('div');
const shadowRoot = container.attachShadow({ mode: 'open' });

// Inject styles
const styleTag = document.createElement('style');
styleTag.textContent = CSS_CONTENT;
shadowRoot.appendChild(styleTag);

// Inject UI elements
shadowRoot.appendChild(overlay);
```

---

## 5. Data Flow Example

### Use Case: User views iPhone 15 on Amazon

**Step 1: Scraping (Synchronous)**
```
Amazon Page DOM
  ↓ [Multiple selectors attempt]
  ├─ h1 span#productTitle? → "Apple iPhone 15 Pro Max, 256GB, Space Black"
  ├─ .a-price-whole → "$1,099.99"
  ├─ Product Details → "Model Number: A2847"
  └─ URL → ASIN: "B0CGQ537GN"

Result: {
  title: "Apple iPhone 15 Pro Max, 256GB, Space Black",
  price: 1099.99,
  modelNumber: "A2847",
  asin: "B0CGQ537GN",
  currentUrl: "https://www.amazon.com/dp/B0CGQ537GN"
}
```

**Step 2: Price History Query**
```
Supabase Request:
  GET /rest/v1/price_history?
    model_number=eq.A2847&
    created_at=gte.2026-04-06T00:00:00Z&
    order=created_at.desc

Result (last 30 days):
  [
    { store: "Amazon", price: 1099.99, created_at: "2026-05-06" },
    { store: "Amazon", price: 1089.99, created_at: "2026-05-03" },
    { store: "Best Buy", price: 1049.99, created_at: "2026-05-01" },
    ... (27 more records)
  ]

Calculations:
  Average: $1054.32
  Min: $999.99 (Best Buy, 2 weeks ago)
  Max: $1199.99 (Amazon, 3 weeks ago)
  Current Deal: 4.3% BELOW average (not great, but fair)
```

**Step 3: Competitor Price Fetch**
```
Background Worker Message:
  {
    type: "FETCH_COMPETITOR_PRICES",
    productTitle: "Apple iPhone 15 Pro Max, 256GB, Space Black",
    modelNumber: "A2847"
  }

Background Worker:
  1. Check cache for "price_A2847" → NOT FOUND (first time)
  2. Fetch from CompetitorFetcher:
     - Best Buy: $1049.99 (Found!)
     - Newegg: Out of stock
     - Target: Not available
     - Micro Center: $1074.99

Result:
  {
    bestbuy: { store: "Best Buy", price: 1049.99 },
    newegg: null,
    target: null,
    microcenter: { store: "Micro Center", price: 1074.99 }
  }

Cache entry created (30-min TTL)
```

**Step 4: Data Processing**
```
Best price found: Best Buy at $1049.99
Amazon price: $1099.99
Savings: $50.00

Deal quality:
  Savings $50 ≥ $10? YES → Show overlay
  Price 4.3% below average? NO → Not "great deal"

UI Data prepared:
  {
    bestPrice: {
      store: "Best Buy",
      price: 1049.99
    },
    amazonPrice: 1099.99,
    savings: 50.00,
    priceHistory: {
      average: 1054.32,
      min: 999.99,
      max: 1199.99,
      isGoodDeal: false
    }
  }
```

**Step 5: UI Injection**
```
UIBuilder creates Shadow DOM:
┌─ .truetag-overlay [slideInUp animation]
│  ├─ .truetag-header
│  │  ├─ Logo "TrueTag"
│  │  └─ Close button "✕"
│  ├─ .truetag-content
│  │  ├─ .truetag-best-price
│  │  │  ├─ "BEST PRICE FOUND"
│  │  │  ├─ "Best Buy"
│  │  │  ├─ "$1,049.99"
│  │  │  └─ "Save $50.00"
│  │  └─ .truetag-price-history
│  │     ├─ "30-DAY AVERAGE"
│  │     ├─ Badge: "• Fair Price"
│  │     └─ Stats: Avg $1054 | Min $999 | Max $1199
│  └─ .truetag-footer
│     └─ "Powered by TrueTag"
└─ (Injected into document.body)
```

**Step 6: Price Logging**
```
Insert into Supabase:
  {
    model_number: "A2847",
    store: "Amazon",
    price: 1099.99,
    created_at: "2026-05-06T14:32:15.000Z"
  }

Supabase returns:
  { id: "uuid-...", ...}

Next time this product is viewed, history will be more complete.
```

---

## 6. Security & Privacy Considerations

### 6.1 Permission Minimization

**Permissions Used**
- `storage` - Save local state only
- `tabs` - Detect page changes
- Host permissions - Only Amazon and competitor sites

**NOT Requested**
- `webRequest` - Not needed (using fetch)
- `activeTab` - Using manifest host_permissions instead
- `identity` - User data stays local

### 6.2 Data Protection

**Sensitive Data**
- Supabase API key stored in `config.js` (should be environment variable in production)
- Price data is non-PII (no user tracking)
- Model numbers are product identifiers (public)

**Best Practices**
- Use `.env` file for credentials (not committed to git)
- Shadow DOM prevents injection attacks
- CSP (Content Security Policy) in manifest restricts scripts
- No data sent to third parties except Supabase

### 6.3 CORS & Same-Origin Policy

**Why competitor fetching needs care**
- Chrome Extension has elevated permissions (can make cross-origin requests)
- Must handle CORS responses carefully
- Implement timeouts to prevent hanging requests

---

## 7. Extensibility & Future Features

### 7.1 Adding a New Retailer

To add e.g., **Adorama** price checking:

**1. Update config.js**
```javascript
competitors: {
  // ... existing
  adorama: {
    name: 'Adorama',
    baseUrl: 'https://www.adorama.com/s/',
    searchParam: 'q',
  },
}
```

**2. Implement in competitor-fetcher.js**
```javascript
static async fetchAdoramaPrice(productTitle, modelNumber) {
  const searchQuery = modelNumber || productTitle;
  const url = `https://www.adorama.com/s/?q=${encodeURIComponent(searchQuery)}`;
  
  const response = await fetch(url);
  const html = await response.text();
  const price = this.extractPriceFromHTML(html, 'adorama');
  
  return {
    store: 'Adorama',
    price: price,
    url: url,
    timestamp: new Date().toISOString(),
  };
}

// Add case in fetchCompetitorPrice()
case 'adorama':
  return this.fetchAdoramaPrice(productTitle, modelNumber);
```

**3. Add UI component**
```javascript
// Competitor list in buildContent() already displays all fetched prices
// No changes needed if structure is consistent
```

### 7.2 Alternative Data Sources

**Current**: Supabase PostgreSQL

**Future Options**:
- Firebase Realtime Database
- MongoDB Atlas
- DynamoDB
- GraphQL API

**Switch Process**:
1. Create `supabase-client-v2.js` or `firebase-client.js`
2. Implement same interface (getPriceHistory, insertPrice, etc.)
3. Update imports in `content.js`
4. Minimal impact on rest of codebase

### 7.3 Enhanced Features

**Price Alerts**
- Notify user when price drops below threshold
- Use Chrome notifications API
- Store alert preferences in storage

**Multi-Marketplace**
- Extend to eBay, Wish, AliExpress
- Create platform-specific scrapers (eBayScaper, etc.)
- Reuse same Supabase schema

**Mobile App**
- React Native app syncs with same Supabase
- Share price history across devices
- Push notifications for deals

**Web Dashboard**
- User account system (Auth0, Firebase)
- View all tracked products and history
- Set price alerts
- Export data

---

## 8. Performance Considerations

### 8.1 Content Script Impact

**Optimization**
- Scraping is synchronous but fast (<100ms)
- Supabase & competitor fetches are async (don't block page)
- UI injection happens after all data ready

**Metrics to Monitor**
- Time to scrape: <200ms target
- Time to fetch history: <500ms
- Time to fetch competitors: <2000ms (cached after)
- Total page load impact: <2500ms

### 8.2 Memory Usage

**Typical Memory Footprint**
- Content script: ~500KB (includes shadow DOM)
- Background worker: ~200KB
- Shadow DOM & styles: ~50KB
- Cache (30 items): ~100KB

**Total Impact**: ~1MB per tab (negligible)

### 8.3 Network Requests

**Requests per product view**
1. Supabase: 1 request (~1KB response)
2. Competitor fetcher: 4 requests (throttled, cached)
3. Database write: 1 request

**Optimization**
- Cache competitor prices (30-min TTL)
- Batch price history queries
- Gzip compression on all requests

---

## 9. Testing Strategy

### 9.1 Unit Tests

**Files to test**
```javascript
// amazon-scraper.test.js
- Test parsePriceString() with various formats
- Test getProductTitle() with multiple selectors
- Test model number extraction patterns

// supabase-client.test.js
- Mock Supabase responses
- Test calculateAveragePrice() with datasets
- Test date filtering

// ui-builder.test.js
- Test overlay structure creation
- Test shadow DOM attachment
- Test close button event handling
```

### 9.2 Integration Tests

**Test scenarios**
1. Full flow on real Amazon product page
2. Price history fetching with actual Supabase
3. Message passing between content & background worker
4. Shadow DOM isolation from page styles

### 9.3 Manual Testing

**Checklist**
- [ ] Load extension in Chrome dev mode
- [ ] Navigate to 10+ Amazon product pages
- [ ] Verify UI appears only when savings ≥$10
- [ ] Check Supabase data inserts correctly
- [ ] Test overlay on mobile device (responsive)
- [ ] Verify no console errors
- [ ] Close overlay button works
- [ ] Cache clears after TTL expires

---

## 10. Deployment Checklist

- [ ] Replace Supabase credentials with environment variables
- [ ] Test in incognito mode
- [ ] Enable privacy mode & check permissions
- [ ] Verify no console errors or warnings
- [ ] Test competitor price fetching (mock or real)
- [ ] Create Chrome Web Store assets (icons, screenshots)
- [ ] Write privacy policy for extension listing
- [ ] Set up automatic updates (manifest version bump)
- [ ] Create release notes for v0.1.0

---

## 11. Known Limitations & TODOs

### 11.1 Current Limitations

| Issue | Impact | Solution |
|-------|--------|----------|
| Competitor fetcher incomplete | Can't fetch real prices yet | Implement retailer-specific parsers |
| Model number extraction manual | Relies on Amazon's structure | Add ML-based fallback |
| No user authentication | Can't sync across devices | Add Firebase Auth |
| Static configuration | API keys in code | Use Chrome storage.sync |
| No error recovery | Fails silently | Add retry logic & user notifications |

### 11.2 Production TODOs

```javascript
// Priority: HIGH
[ ] Implement competitor price parsing (all 4 retailers)
[ ] Add comprehensive error handling
[ ] Implement retry logic with exponential backoff
[ ] Add user notifications for errors
[ ] Test on 100+ products for scraping accuracy

// Priority: MEDIUM
[ ] Add unit tests (Jest)
[ ] Add E2E tests (Playwright)
[ ] Implement analytics
[ ] Add competitor pricing historical data

// Priority: LOW
[ ] Add settings page (UI preferences)
[ ] Implement price alerts
[ ] Create dashboard web app
[ ] Add multi-language support
```

---

## Conclusion

TrueTag is architected for **scalability**, **maintainability**, and **excellent user experience**. The modular design allows for easy feature additions and platform expansions. The focus on non-intrusive, beautiful design ensures users will want to keep the extension enabled.

**Next Steps**:
1. Test on real products (especially edge cases)
2. Implement competitor price fetching
3. Collect user feedback from beta testers
4. Expand to additional retailers
5. Build complementary web dashboard

---

**Document Version**: 1.0  
**Last Updated**: May 6, 2026  
**Status**: Active Development (MVP)
