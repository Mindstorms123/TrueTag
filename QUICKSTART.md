# TrueTag - Quick Start Guide

## 🚀 For Developers

### Prerequisites
- Chrome/Chromium browser (v88+)
- Text editor or IDE
- Supabase account
- Node.js (optional, for testing)

### 1️⃣ Setup (5 minutes)

```bash
# Navigate to project
cd c:\Users\wuest\OneDrive\Projekte\TrueTag

# Copy environment template
cp .env.example .env

# Edit .env with your Supabase credentials
# .env should NOT be committed to git (it's in .gitignore)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

### 2️⃣ Update config.js

Open `config.js` and replace with your actual values:

```javascript
const CONFIG = {
  supabase: {
    url: 'https://your-project.supabase.co',      // ← Replace
    anonKey: 'your-anon-key-here',                 // ← Replace
    table: 'price_history',
  },
  // ... rest stays the same
};
```

### 3️⃣ Create Supabase Table

In your Supabase SQL Editor, run:

```sql
-- Create price_history table
CREATE TABLE price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  model_number TEXT NOT NULL,
  store TEXT NOT NULL,
  price NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX idx_model_number_created_at 
ON price_history(model_number, created_at DESC);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- Allow anonymous reads/writes for MVP
CREATE POLICY "Allow anon insert"
ON price_history FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon select"
ON price_history FOR SELECT TO anon
USING (true);
```

### 4️⃣ Load in Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode" (toggle top-right)
3. Click "Load unpacked"
4. Select the TrueTag folder
5. Extension should appear with icon

**Status**: You should see "TrueTag" in your extensions list

### 5️⃣ Test It

1. Navigate to an Amazon product page
   - Example: `amazon.com/dp/B0CGQ537GN` (any product)
2. Wait 2-3 seconds for extension to process
3. Check browser console (F12 → Console tab):
   - Look for "TrueTag:" log messages
   - No errors should appear

**Expected console output**:
```
TrueTag: Initializing on Amazon product page
TrueTag: Product data scraped {title: "...", price: 99.99, ...}
TrueTag: Price history retrieved {records: [...], average: 89.99, ...}
TrueTag: Competitor prices received {bestbuy: {...}, newegg: null, ...}
TrueTag: UI overlay injected
TrueTag: Price logged to database
```

---

## 🎨 Design Preview

### Color Scheme

```
Primary:        #0f172a (Deep Slate)      ████████
Accent:         #10b981 (Emerald)         ████████
Text:           #f1f5f9 (Near White)      ████████
```

### Overlay Layout

```
┌─────────────────────────────────────┐
│ ⊟ TrueTag                        ✕  │  ← Header
├─────────────────────────────────────┤
│                                     │
│  BEST PRICE FOUND                   │
│  Best Buy                           │
│  $899.99                            │
│  Save $100.00                       │  ← Best Price Section
│                                     │
│  30-DAY AVERAGE                     │
│  ✓ Great Deal                       │
│  Avg $950 | Min $850 | Max $1100   │  ← History Section
│                                     │
├─────────────────────────────────────┤
│ Powered by TrueTag                  │  ← Footer
└─────────────────────────────────────┘
```

---

## 🔍 Debugging Tips

### Enable Debug Logging

Edit `config.js`:
```javascript
debug: true,  // Set to true
```

This logs all operations to console:
```
Background: Message received {type: "FETCH_COMPETITOR_PRICES", ...}
Background: Returning cached prices {bestbuy: {...}, ...}
TrueTag: Product data scraped {title: "...", ...}
```

### Check Supabase Connection

Open DevTools Console and run:

```javascript
// Import client and test
const supabase = new SupabaseClient();
supabase.getPriceHistory('A2847', 30)
  .then(data => console.log('Success:', data))
  .catch(err => console.error('Error:', err));
```

### Verify Amazon Scraping

In DevTools Console on an Amazon product page:

```javascript
const product = AmazonScraper.scrapeProductInfo();
console.log(product);
// Should output: {title: "...", price: 99.99, modelNumber: "XYZ123", ...}
```

### Test Competitor Fetching

Manually trigger background fetch:

```javascript
chrome.runtime.sendMessage({
  type: 'FETCH_COMPETITOR_PRICES',
  productTitle: 'iPhone 15',
  modelNumber: 'A2847'
}, response => console.log(response));
```

---

## 🛠️ Common Issues & Solutions

### Issue: Overlay not appearing

**Cause**: Savings < $10 AND no price history

**Solution**: 
- Add test data to Supabase for same model number
- Or find a product with >$10 price difference

**Verify**: Check config.js settings:
```javascript
priceHistory: {
  minDataPoints: 3,  // Need at least 3 records
}
```

### Issue: "Supabase error: 401 Unauthorized"

**Cause**: Invalid API key

**Solution**:
- Get correct anon key from Supabase dashboard
- Project Settings → API → "anon (public)" key
- Update config.js

### Issue: Console errors "Cannot read properties of null"

**Cause**: DOM selector mismatch (Amazon changed their structure)

**Solution**:
- Open DevTools Elements tab
- Find the correct current selector
- Update amazon-scraper.js with new selector

**Example**:
```javascript
// If h1 span#productTitle doesn't exist:
// 1. Open DevTools on product page
// 2. Find where title actually is
// 3. Update selector in getProductTitle()
```

### Issue: Prices "null" for competitors

**Cause**: Competitor fetcher not implemented

**Expected**: This is the current state!

**TODO**: Implement retailer-specific DOM parsing in competitor-fetcher.js

---

## 📚 File Reference

| File | Purpose | Modified For |
|------|---------|--------------|
| `manifest.json` | Extension config | ✖️ Rarely |
| `content.js` | Main orchestrator | ✓ Feature additions |
| `background.js` | Service worker | ✓ Performance tweaks |
| `amazon-scraper.js` | DOM parsing | ✓ When Amazon changes structure |
| `supabase-client.js` | DB operations | ✓ Query optimization |
| `ui-builder.js` | UI creation | ✓ Design changes |
| `styles.css` | Design system | ✓ UI improvements |
| `config.js` | Settings | ✓ Configuration |

---

## 🎯 Next Steps for Development

### Immediate (This Week)
1. [ ] Test on 10+ real Amazon products
2. [ ] Fix any DOM selector issues
3. [ ] Verify Supabase integration works

### Short Term (This Month)
1. [ ] Implement Best Buy price parser
2. [ ] Implement Newegg price parser
3. [ ] Implement Target price parser
4. [ ] Implement Micro Center price parser
5. [ ] Add comprehensive error handling
6. [ ] Add user notifications

### Medium Term (Next Quarter)
1. [ ] Add unit tests
2. [ ] Add E2E tests
3. [ ] Create settings page
4. [ ] Implement price alerts
5. [ ] Build analytics

---

## 💡 Pro Tips

### Tip 1: Use Chrome DevTools
- Right-click extension icon → "Inspect" → Opens extension DevTools
- Check console, storage, network requests
- Use `debugger;` statements in code

### Tip 2: Test with Shadow DOM
- DevTools has a checkbox: "Show user agent shadow DOM"
- Helps verify Shadow DOM styles don't leak

### Tip 3: Monitor Supabase
- Open Supabase dashboard
- Watch price_history table update in real-time
- Verify data structure matches expectations

### Tip 4: Cache Management
- Prices are cached for 30 minutes
- Force refresh: Send "CLEAR_PRICE_CACHE" message
```javascript
chrome.runtime.sendMessage({type: 'CLEAR_PRICE_CACHE'}, 
  response => console.log('Cache cleared:', response));
```

### Tip 5: Performance Monitoring
- Use Chrome DevTools Performance tab
- Record page load with extension active
- Look for unnecessary long tasks

---

## 🚨 Emergency Fixes

### Extension Won't Load
```bash
# Check manifest.json syntax
# Right-click → Inspect → Extensions page shows errors

# Common fixes:
1. Check JSON is valid (no trailing commas)
2. Verify all file paths exist
3. Check no syntax errors in .js files
```

### Content Script Not Running
```javascript
// Add to top of content.js:
console.log('TrueTag content script loading...');

// If you don't see this in console, check:
1. manifest.json content_scripts matches URLs
2. Extension is actually enabled in chrome://extensions
3. Refresh page after enabling extension
```

### Service Worker Dies
- Service workers auto-suspend after inactivity
- They wake up when message arrives
- Check DevTools → Extensions tab for "Unregistered" status

---

## 📞 Getting Help

**Need to debug?**

1. Check console output
2. Review ARCHITECTURE.md for design details
3. Look at code comments in each file
4. Check if Supabase connection is working

**Questions about design?**

- Review DESIGN DECISIONS in styles.css
- Check COLOR PALETTE section
- Read UI/UX philosophy in ARCHITECTURE.md

**Performance issues?**

- Check DevTools Performance tab
- Review Performance Considerations in ARCHITECTURE.md
- Test on slower networks with throttling

---

**Happy developing! 🎉**

Questions? Check the main README.md or ARCHITECTURE.md for comprehensive documentation.
