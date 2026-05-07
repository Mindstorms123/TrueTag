/**
 * Supabase Client Helper
 * Handles price history database operations
 */

import CONFIG from './config.js';

class SupabaseClient {
  constructor() {
    this.url = CONFIG.supabase.url;
    this.anonKey = CONFIG.supabase.anonKey;
    this.table = CONFIG.supabase.table;
    this.writeEndpoint = CONFIG.supabase.writeEndpoint;
  }

  /**
   * Build headers for Supabase API requests
   */
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      apikey: this.anonKey,
      Authorization: `Bearer ${this.anonKey}`,
    };
  }

  /**
   * Fetch current store offers for a product by model number.
   * This reads the compact summary view instead of the full event table.
   * @param {string} modelNumber - The product's model number
   * @returns {Promise<Array>} Array of current offer rows
   */
  async getPriceHistory(modelNumber) {
    const query = new URLSearchParams({
      'model_number': `eq.${modelNumber}`,
      'active': 'eq.true',
      'order': 'saved_at.desc,last_seen_at.desc',
      'limit': '1000',
    });

    try {
      const response = await fetch(
        `${this.url}/rest/v1/${this.table}?${query.toString()}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`Supabase error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch price history:', error);
      return [];
    }
  }

  /**
   * Insert a new price record
   * @param {Object} priceRecord - Record object with model_number, store, price
   * @returns {Promise<Object>} Inserted record
   */
  async insertPrice(priceRecord) {
    const payload = {
      model_number: priceRecord.modelNumber,
      store: priceRecord.store,
      price: parseFloat(priceRecord.price),
      created_at: new Date().toISOString(),
        product_title: priceRecord.productTitle || null,
        asin: priceRecord.asin || null,
        amazon_url: priceRecord.amazonUrl || null,
      source_url: priceRecord.sourceUrl || priceRecord.offerUrl || null,
      source_type: priceRecord.sourceType || null,
      offer_url: priceRecord.offerUrl || priceRecord.sourceUrl || null,
      offer_type: priceRecord.offerType || priceRecord.sourceType || null,
      page_title: priceRecord.pageTitle || null,
      saved_at: priceRecord.savedAt || new Date().toISOString(),
    };

    try {
      if (!this.writeEndpoint) {
        throw new Error('Missing supabase.writeEndpoint. Writes must go through an Edge Function.');
      }

      const response = await fetch(this.writeEndpoint, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'x-truetag-client': 'extension',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Supabase error: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to insert price record:', error);
      return null;
    }
  }

  /**
   * Calculate average price from history records
   * @param {Array} records - Array of price records
   * @returns {number} Average price
   */
  calculateAveragePrice(records) {
    if (records.length === 0) return null;
    const sum = records.reduce((acc, record) => acc + parseFloat(record.price), 0);
    return sum / records.length;
  }

  /**
   * Get min and max prices from history
   * @param {Array} records - Array of price records
   * @returns {Object} Object with min and max prices
   */
  getPriceRange(records) {
    if (records.length === 0) return { min: null, max: null };
    const prices = records.map(r => parseFloat(r.price));
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
    };
  }
}

export default SupabaseClient;
