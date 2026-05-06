/**
 * Copy this file to config.js for local development.
 * Keep config.js out of git to avoid sharing credentials.
 */

const CONFIG = {
  // Supabase Configuration
  supabase: {
    // Allowed: project URL from Supabase Settings > API > Project URL
    url: 'https://fsqhokrifvwuqbjmlovo.supabase.co',
    // Allowed: anon public key from Supabase Settings > API > Project API keys
    // Never use: service_role key in this extension config
    anonKey: 'your-anon-key-here',
    table: 'price_history',
    // Edge Function endpoint that performs validated writes
    // Example: https://<project-ref>.supabase.co/functions/v1/ingest-price
    writeEndpoint: 'https://fsqhokrifvwuqbjmlovo.supabase.co/functions/v1/ingest-price',
  },

  competitors: {
    bestbuy: {
      name: 'Best Buy',
      baseUrl: 'https://www.bestbuy.com/site/searchpage.jsp',
      searchParam: 'st',
    },
    newegg: {
      name: 'Newegg',
      baseUrl: 'https://www.newegg.com/p/pl',
      searchParam: 'N',
    },
    target: {
      name: 'Target',
      baseUrl: 'https://www.target.com/s',
      searchParam: 'searchTerm',
    },
    microcenter: {
      name: 'Micro Center',
      baseUrl: 'https://www.microcenter.com/search/search_results.aspx',
      searchParam: 'searchterm',
    },
  },

  priceHistory: {
    averageWindow: 30,
    minDataPoints: 3,
  },

  ui: {
    overlay: {
      position: 'bottom-right',
      showDelay: 500,
      animationDuration: 500,
    },
    // Set to true only for local UI testing.
    forceShowForTesting: false,
  },

  debug: false,
};

export default CONFIG;
