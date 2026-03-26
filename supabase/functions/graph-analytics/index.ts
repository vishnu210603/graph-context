import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import neo4j from "npm:neo4j-driver@5.27.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'low' in v) return v.low;
  return Number(v) || 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let driver;
  try {
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USER = Deno.env.get('NEO4J_USER');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
    if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) throw new Error('Neo4j credentials not configured');

    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    const session = driver.session();

    try {
      const [revRes, matRes, ordRes] = await Promise.all([
        session.run(`
          MATCH (so:SalesOrder)-[:HAS_ITEM]->(item)
          WITH so, sum(item.netAmount) AS revenue
          RETURN so.salesOrder AS orderId, revenue
          ORDER BY revenue DESC LIMIT 10
        `),
        session.run(`
          MATCH (:SalesOrderItem)-[:USES_MATERIAL]->(m:Material)
          RETURN m.id AS materialId, count(*) AS usage
          ORDER BY usage DESC LIMIT 10
        `),
        session.run(`
          MATCH (so:SalesOrder)-[:HAS_ITEM]->(item)
          RETURN so.salesOrder AS orderId, count(item) AS totalItems
          ORDER BY totalItems DESC LIMIT 10
        `),
      ]);

      return new Response(JSON.stringify({
        revenueLeaders: revRes.records.map((r: any) => ({
          orderId: r.get('orderId'),
          revenue: toNum(r.get('revenue')),
        })),
        topMaterials: matRes.records.map((r: any) => ({
          materialId: r.get('materialId'),
          usage: toNum(r.get('usage')),
        })),
        topOrders: ordRes.records.map((r: any) => ({
          orderId: r.get('orderId'),
          totalItems: toNum(r.get('totalItems')),
        })),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } finally {
      await session.close();
    }
  } catch (error) {
    console.error('Analytics error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    if (driver) await driver.close();
  }
});
