// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface PriceRecord {
  model_number?: string;
  asin?: string;
  product_title?: string;
  amazon_url?: string;
  offer_url?: string;
  source_url?: string;
  source_type?: string;
  offer_type?: string;
  page_title?: string;
  saved_at?: string;
  price: number;
  currency?: string;
  store: string;
  created_at?: string;
}

Deno.serve(async (req: Request) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Parse request payload
    const payload: PriceRecord = await req.json();

    // Validate required fields
    // require either model_number or asin plus store and price
    if ((!payload.model_number && !payload.asin) || !payload.store || payload.price === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate price
    if (typeof payload.price !== 'number' || payload.price <= 0 || payload.price > 1000000) {
      return new Response(
        JSON.stringify({ error: 'Invalid price' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client - USE SERVICE ROLE KEY (faster, no RLS overhead)
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Supabase config missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const now = new Date().toISOString();
    const oneDayAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    // Avoid duplicate inserts: check offer_url + price combination (strictest match)
    // This prevents re-saving when user clicks same link and enters same price
    let duplicate = null;
    if (payload.offer_url) {
      const { data: byOffer } = await supabase
        .from('price_history')
        .select('price,created_at')
        .eq('offer_url', payload.offer_url)
        .eq('price', payload.price)
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      duplicate = byOffer;
    }

    // If no exact URL+price match, check model+store+price combination (allows URL updates, prevents model duplicates)
    if (!duplicate && (payload.model_number || payload.asin)) {
      const query = supabase.from('price_history').select('price,created_at')
        .eq('store', payload.store)
        .eq('price', payload.price)
        .gte('created_at', oneDayAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (payload.model_number) query.eq('model_number', payload.model_number);
      else if (payload.asin) query.eq('asin', payload.asin);

      const { data: byModel } = await query.single();
      duplicate = byModel;
    }

    if (duplicate) {
      // Exact duplicate found: same URL + price (or model + store + price within 7 days)
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'Price already recorded for this offer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Price changed or new entry -> INSERT full enriched record into price_history
    const { error } = await supabase
      .from('price_history')
      .insert({
        model_number: payload.model_number || null,
        asin: payload.asin || null,
        product_title: payload.product_title || null,
        offer_url: payload.offer_url || null,
        source_url: payload.source_url || null,
        source_type: payload.source_type || null,
        offer_type: payload.offer_type || null,
        page_title: payload.page_title || null,
        price: payload.price,
        currency: payload.currency || 'USD',
        store: payload.store,
        saved_at: payload.saved_at || payload.created_at || now,
        created_at: payload.created_at || now,
      });

    if (error) {
      console.error('Insert failed:', JSON.stringify(error, null, 2));
      throw error;
    }

    return new Response(
      JSON.stringify({ success: true, inserted: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const details = error && typeof error === 'object' ? error : null;
    const message = error instanceof Error ? error.message : details?.message || String(error);
    console.error('Error:', message, details ? JSON.stringify(details, null, 2) : '');
    return new Response(
      JSON.stringify({
        error: message,
        details: details?.details || details?.hint || null,
        code: details?.code || null,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});