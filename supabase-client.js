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
   * Fetch price history for a product by model number
   * @param {string} modelNumber - The product's model number
   * @param {number} days - Number of days to lookback
   * @returns {Promise<Array>} Array of price records
   */
  async getPriceHistory(modelNumber, days = CONFIG.priceHistory.averageWindow) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const query = new URLSearchParams({
      'model_number': `eq.${modelNumber}`,
      'created_at': `gte.${startDate.toISOString()}`,
      'order': 'created_at.desc',
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
