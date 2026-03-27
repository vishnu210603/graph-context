import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import neo4j from "npm:neo4j-driver@5.27.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let driver;
  try {
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USER = Deno.env.get('NEO4J_USER');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
    if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) throw new Error('Neo4j credentials not configured');

    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

    // Run queries sequentially to avoid "open transaction" error
    const extract = (res: any) => res.records.map((r: any) => {
      const v = r.get('val');
      return typeof v === 'object' && v !== null && 'low' in v ? v.low : v;
    }).filter(Boolean);

    const session1 = driver.session();
    let plants, currencies, orders, materials, nodeTypes;
    try {
      const plantsRes = await session1.run('MATCH (p:Plant) RETURN DISTINCT p.plant AS val LIMIT 50');
      plants = extract(plantsRes);
    } finally { await session1.close(); }

    const session2 = driver.session();
    try {
      const currenciesRes = await session2.run('MATCH (item:SalesOrderItem) RETURN DISTINCT item.transactionCurrency AS val LIMIT 20');
      currencies = extract(currenciesRes);
    } finally { await session2.close(); }

    const session3 = driver.session();
    try {
      const ordersRes = await session3.run('MATCH (so:SalesOrder) RETURN so.salesOrder AS val LIMIT 30');
      orders = extract(ordersRes);
    } finally { await session3.close(); }

    const session4 = driver.session();
    try {
      const materialsRes = await session4.run('MATCH (m:Material) RETURN m.id AS val LIMIT 30');
      materials = extract(materialsRes);
    } finally { await session4.close(); }

    const session5 = driver.session();
    try {
      const typesRes = await session5.run('MATCH (n) RETURN DISTINCT labels(n)[0] AS val LIMIT 20');
      nodeTypes = extract(typesRes);
    } finally { await session5.close(); }

    return new Response(JSON.stringify({
      plants,
      currencies,
      orders,
      materials,
      nodeTypes,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Filter options error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    if (driver) await driver.close();
  }
});
