// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface PriceRecord {
  model_number: string;
  store: string;
  price: number;
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
    if (!payload.model_number || !payload.store || payload.price === undefined) {
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
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Check: gibt es einen Eintrag mit GLEICHER model + store + PREIS in letzten 24h?
    // Wenn ja -> skip (Duplikat). Wenn nein -> insert (neue Preis-Version)
    const { data: lastRecord } = await supabase
      .from('price_history')
      .select('price')
      .eq('model_number', payload.model_number)
      .eq('store', payload.store)
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Price hasn't changed -> skip (duplicate)
    if (lastRecord && Math.abs(lastRecord.price - payload.price) < 0.01) {
      return new Response(
        JSON.stringify({ success: true, skipped: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Price changed or new entry -> INSERT
    const { error } = await supabase
      .from('price_history')
      .insert({
        model_number: payload.model_number,
        store: payload.store,
        price: payload.price,
        created_at: payload.created_at || now,
      });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, inserted: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});