# TrueTag - Price Comparison Chrome Extension

A beautiful, non-intrusive Chrome Extension (Manifest V3) that tracks price comparisons and price history for tech products across Amazon, Best Buy, Newegg, Target, and Micro Center.

## Features

✨ **Beautiful UI Design**
- Modern, clean interface using a deep Indigo/Slate color scheme with Emerald accents
- Floating overlay that appears only when relevant (significant savings found or price history available)
- Encapsulated in Shadow DOM to prevent CSS conflicts with Amazon's native styles
- Smooth animations and soft shadows for premium feel

💰 **Smart Price Comparison**
- Silent background price checking across 4 major retailers
- Displays the best price found with savings calculation
- Only shows overlay when savings ≥ $10 or when price history data is available

📊 **Price History Tracking**
- Integrates with Supabase for persistent price history
- Calculates 30-day price averages
- Shows historical price ranges and deal badges
- Identifies "Great Deal" opportunities (10%+ below average)

🔍 **Amazon Product Scraping**
- Extracts product title, current price, and model number
- Works on Amazon product detail pages (dp/ and gp/product/)
- Robust DOM selectors to handle Amazon's frequent layout changes

## Project Structure

```
TrueTag/
├── manifest.json              # Chrome Extension manifest (V3)
├── content.js                 # Content script for Amazon pages
├── background.js              # Service worker for background operations
├── styles.css                 # Complete design system and UI styles
├── amazon-scraper.js          # Amazon DOM scraping logic
├── supabase-client.js         # Supabase database integration
├── competitor-fetcher.js      # Background price fetching logic
├── ui-builder.js              # Shadow DOM UI construction
├── config.example.js          # Committable config template (safe)
├── config.js                  # Local config (gitignored, do not commit)
├── .env.example               # Environment variables template
├── .gitignore                 # Git ignore rules
└── README.md                  # This file
```

## Design System

### Colors
- **Primary**: `#0f172a` (Deep Slate) - Trustworthy, professional base
- **Primary Light**: `#1e293b` (Light Slate) - Secondary backgrounds
- **Accent**: `#10b981` (Emerald Green) - Highlights savings and deals
- **Accent Light**: `#6ee7b7` (Mint Green) - Secondary accent, better contrast
- **Text Primary**: `#f1f5f9` (Near White) - Main text
- **Text Secondary**: `#cbd5e1` (Light Gray) - Secondary text

### Typography
- **Font Family**: System UI stack (-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Roboto")
- **Weights Used**: 600 (semibold), 700 (bold), 800 (extrabold)
- **Letter Spacing**: Tighter on uppercase labels (-0.3px to 0.5px)

### Spacing System
- `xs`: 4px, `sm`: 8px, `md`: 12px, `lg`: 16px, `xl`: 24px

### Border Radius
- `sm`: 6px, `md`: 8px, `lg`: 12px

### Shadows
- **Small**: 0 1px 2px 0 rgba(0,0,0,0.3)
- **Large**: 0 20px 25px -5px rgba(0,0,0,0.6)

### Why This Design Works
- **Non-intrusive**: Fixed position overlay in bottom-right corner, easily dismissible
- **High contrast**: Dark background with bright accents ensure readability
- **Modern feel**: Soft shadows and smooth animations create premium appearance
- **Accessibility**: Large touch targets, clear visual hierarchy, WCAG compliant
- **Encapsulated**: Shadow DOM prevents CSS conflicts with host page

## Setup Instructions

### Prerequisites
- Chrome browser (v88+)
- Node.js (for development, optional)
- Supabase account with `price_history` table

### 1. Configure Environment

Copy `config.example.js` to `config.js` and fill in your project values.

```bash
cp config.example.js config.js
```

Then edit `config.js` locally:

```javascript
const CONFIG = {
  supabase: {
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key-here',
    table: 'price_history',
  },
  // ... other config
};
```

Important:
- `config.js` is gitignored and should never be committed.
- `config.example.js` is the safe template that stays in the repo.
- If `config.js` was already committed in the past, run `git rm --cached config.js` once.

### 2. Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `TrueTag/` folder
5. Extension should appear in your extensions list

### 3. Supabase Setup

Create the `price_history` table in your Supabase database:

```sql
create table price_history (
  id uuid default gen_random_uuid() primary key,
  model_number text not null,
  store text not null,
  price numeric not null,
  created_at timestamp default now()
);

-- Create index for faster queries
create index idx_model_number_created_at 
on price_history(model_number, created_at desc);

-- Security: allow reads, block direct writes from clients
alter table price_history enable row level security;

create policy "public read price history"
on price_history for select
to anon, authenticated
using (true);

-- No insert policy for anon/authenticated on this table.
-- Writes should only happen via Edge Function using service role.
```

### 4. Secure Write Path (Recommended)

Do not insert directly into `price_history` from the extension.
Use a Supabase Edge Function (example: `ingest-price`) that validates payloads and inserts with service role permissions.

Set this in your local `config.js`:

```javascript
supabase: {
  url: 'https://your-project.supabase.co',
  anonKey: 'your-anon-key-here',
  table: 'price_history',
  writeEndpoint: 'https://your-project.supabase.co/functions/v1/ingest-price',
}
```

Important:
- Extension clients are public clients. Secrets cannot be hidden in extension code.
- RLS + Edge Function validation + rate limiting is the correct protection model.
- If a key was exposed before, rotate it in Supabase.

## How It Works

### Flow Diagram

1. **User visits Amazon product page** → Content script initializes
2. **Scrape product info** → Extract title, price, model number from DOM
3. **Parallel operations**:
   - Fetch price history from Supabase (last 30 days)
   - Send background message to fetch competitor prices
4. **Process data** → Calculate average, identify savings, determine deal quality
5. **Inject UI** → Create Shadow DOM overlay with comparison data
6. **Log price** → Insert current Amazon price into price_history table

### Content Script (`content.js`)
- Runs on `amazon.com/dp/*` and `amazon.com/gp/product/*` pages
- Orchestrates the entire flow
- Manages communication with background worker
- Handles UI injection timing

### Background Worker (`background.js`)
- Manages message passing from content scripts
- Caches competitor prices (30-minute TTL) to reduce requests
- Implements rate limiting and cache cleanup
- Fetches prices from 4 competitors asynchronously

### Amazon Scraper (`amazon-scraper.js`)
- Multiple DOM selectors for each product field (Amazon changes structure frequently)
- Handles price parsing (removes $, commas, validates range)
- Extracts ASIN as fallback for model number

### Supabase Client (`supabase-client.js`)
- RESTful API calls to Supabase
- Calculates price averages and ranges
- Handles date filtering for 30-day window

### UI Builder (`ui-builder.js`)
- Creates Shadow DOM for style encapsulation
- Builds component structure (header, content, footer)
- Handles overlay injection and removal
- CSS-in-JS for styles (can be refactored to separate file)

### Competitor Fetcher (`competitor-fetcher.js`)
- **Placeholder implementation** - needs completion for production
- Structure ready for adding retailer-specific parsers
- Each competitor needs custom DOM parsing logic
- Could be upgraded to use official APIs if available

## Key Architectural Decisions

### 1. Shadow DOM for Style Encapsulation
**Why**: Amazon has extensive CSS that could conflict with our overlay. Shadow DOM provides true style isolation.

```javascript
const shadowRoot = container.attachShadow({ mode: 'open' });
shadowRoot.appendChild(styleElement);
shadowRoot.appendChild(overlayElement);
```

### 2. Non-Intrusive Overlay
**Why**: Users hate extensions that break website layouts. Our floating overlay appears only when it adds value.

**Decision tree**:
- Show if savings ≥ $10, OR
- Show if price history exists (≥3 data points)
- Otherwise, silently collect data in background

### 3. Service Worker Caching
**Why**: Reduce API calls and improve performance. 30-minute cache TTL balances freshness with performance.

```javascript
getCachedPrices(cacheKey) {
  const cached = this.priceCache.get(cacheKey);
  if (Date.now() - cached.timestamp > 30 * 60 * 1000) {
    return null; // Cache expired
  }
  return cached.data;
}
```

### 4. Modular ES6 Classes
**Why**: Clean code organization, easy to test, maintainable.

- `AmazonScraper` - DOM parsing
- `SupabaseClient` - Database operations
- `CompetitorFetcher` - Background price checking
- `UIBuilder` - UI creation
- `BackgroundWorker` - Service worker logic

## Configuration

Key settings in `config.js`:

```javascript
// Show overlay only for savings ≥ $10 and ≥3 price history points
priceHistory: {
  averageWindow: 30, // days
  minDataPoints: 3,
}

// UI appearance
ui: {
  overlay: {
    position: 'bottom-right',
    showDelay: 500, // ms before showing
    animationDuration: 500, // ms
  },
}

// Retailers to check
competitors: {
  bestbuy, newegg, target, microcenter
}
```

## Development

### Debugging

Enable debug logging in `config.js`:

```javascript
debug: true
```

This logs all scraping, Supabase queries, and competitor fetches to console.

### Testing

1. Install extension in developer mode
2. Open DevTools on Amazon product page (F12)
3. Check Console tab for TrueTag logs
4. Visit a product page to trigger the flow

### Next Steps for Production

1. **Complete Competitor Parsers** (`competitor-fetcher.js`)
   - Implement DOM parsing for each retailer
   - Add error handling and timeouts
   - Consider using Playwright for complex sites

2. **Authentication**
   - Add user accounts for personalized preferences
   - Sync price history across devices

3. **API Integration**
   - Partner with retailer APIs instead of scraping
   - Implement server-side proxy for CORS handling

4. **Analytics**
   - Track which products users compare
   - Understand user behavior and savings

5. **Monetization**
   - Affiliate links to retailers
   - Premium features (price alerts, trending deals)

## Browser Permissions Required

- `storage` - Save user preferences locally
- `tabs` - Detect when user visits product pages
- Host permissions for Amazon, Best Buy, Newegg, Target, Micro Center, Supabase

## Troubleshooting

**Overlay not appearing**
- Check browser console for errors
- Verify model number is being extracted
- Confirm Supabase credentials in config.js

**Prices not updating**
- Check network tab for failed requests
- Verify Supabase table exists and has data
- Competitor fetcher may need retailer-specific fixes

**CSS conflicts on page**
- Shadow DOM should prevent this, but check console for warnings
- Increase specificity in styles.css if needed

## License

[Add your license here]

## Support

[Add support contact information]
