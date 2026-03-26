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

    // Parse filters from body (POST) or use defaults
    let filters: any = {};
    try {
      if (req.method === 'POST') {
        filters = await req.json();
      }
    } catch { /* no body = no filters */ }

    const orderId = filters.orderId || null;
    const plantId = filters.plantId || null;
    const materialId = filters.materialId || null;
    const currency = filters.currency || null;
    const minRevenue = filters.minRevenue ?? 0;
    const maxRevenue = filters.maxRevenue ?? 999999999;
    const minQty = filters.minQty ?? 0;

    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    const session = driver.session();

    try {
      // Build the filtered query
      const hasFilters = orderId || plantId || materialId || currency || minRevenue > 0 || maxRevenue < 999999999 || minQty > 0;

      let nodesQuery: string;
      let relsQuery: string;
      let params: Record<string, any> = {};

      if (hasFilters) {
        // Filtered query focusing on SalesOrder supply chain
        nodesQuery = `
          MATCH (so:SalesOrder)-[:HAS_ITEM]->(item:SalesOrderItem)
          OPTIONAL MATCH (item)-[:USES_MATERIAL]->(m:Material)
          OPTIONAL MATCH (m)-[:PRODUCED_AT]->(p:Plant)
          WHERE 
            ($orderId IS NULL OR so.salesOrder = $orderId) AND
            ($plantId IS NULL OR p.plant = $plantId) AND
            ($materialId IS NULL OR m.id = $materialId) AND
            ($currency IS NULL OR item.transactionCurrency = $currency) AND
            (item.requestedQuantity >= $minQty)
          WITH so, item, m, p, item.netAmount AS revenue
          WHERE revenue >= $minRevenue AND revenue <= $maxRevenue
          RETURN so, item, m, p
          LIMIT 200
        `;
        params = { orderId, plantId, materialId, currency, minRevenue, maxRevenue, minQty };

        relsQuery = `
          MATCH (so:SalesOrder)-[r:HAS_ITEM]->(item:SalesOrderItem)
          OPTIONAL MATCH (item)-[r2:USES_MATERIAL]->(m:Material)
          OPTIONAL MATCH (m)-[r3:PRODUCED_AT]->(p:Plant)
          WHERE 
            ($orderId IS NULL OR so.salesOrder = $orderId) AND
            ($plantId IS NULL OR p.plant = $plantId) AND
            ($materialId IS NULL OR m.id = $materialId) AND
            ($currency IS NULL OR item.transactionCurrency = $currency) AND
            (item.requestedQuantity >= $minQty)
          WITH so, item, m, p, r, r2, r3, item.netAmount AS revenue
          WHERE revenue >= $minRevenue AND revenue <= $maxRevenue
          RETURN so, r, item, r2, m, r3, p
          LIMIT 200
        `;
      } else {
        // Unfiltered: get everything
        nodesQuery = 'MATCH (n) RETURN n LIMIT 300';
        relsQuery = 'MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 500';
      }

      const [nodesResult, relsResult] = await Promise.all([
        session.run(nodesQuery, params),
        session.run(relsQuery, params),
      ]);

      const nodeMap = new Map();

      function addNode(node: any) {
        if (!node) return null;
        const id = node.elementId || node.identity?.toString();
        if (!id || nodeMap.has(id)) return id;
        const labels = node.labels || [];
        const props: Record<string, any> = {};
        for (const [k, v] of Object.entries(node.properties || {})) {
          props[k] = typeof v === 'object' && v !== null && 'low' in v ? (v as any).low : v;
        }
        const type = labels[0] || 'Unknown';
        const label = props.name || props.id || props.number || props.description || props.MaterialNumber || props.CustomerNumber || props.salesOrder || props.plant || String(id).split(':').pop();
        nodeMap.set(id, { id, label: String(label).substring(0, 30), type, properties: props });
        return id;
      }

      if (hasFilters) {
        // Extract nodes from filtered results
        for (const record of nodesResult.records) {
          for (const key of record.keys) {
            const val = record.get(key);
            if (val && val.labels) addNode(val);
          }
        }
      } else {
        for (const record of nodesResult.records) {
          addNode(record.get('n'));
        }
      }

      const links: any[] = [];
      const seenLinks = new Set();

      for (const record of relsResult.records) {
        if (hasFilters) {
          // Process filtered relationship results
          const nodeKeys = record.keys.filter((k: string) => !k.startsWith('r'));
          const relKeys = record.keys.filter((k: string) => k.startsWith('r'));
          
          // Add all nodes
          for (const key of record.keys) {
            const val = record.get(key);
            if (val && val.labels) addNode(val);
          }
          
          // Add relationships
          for (const key of record.keys) {
            const val = record.get(key);
            if (val && val.type && val.start && val.end) {
              const sourceId = val.startNodeElementId || val.start?.toString();
              const targetId = val.endNodeElementId || val.end?.toString();
              const relType = val.type;
              const linkKey = `${sourceId}-${relType}-${targetId}`;
              if (!seenLinks.has(linkKey) && nodeMap.has(sourceId) && nodeMap.has(targetId)) {
                seenLinks.add(linkKey);
                links.push({ source: sourceId, target: targetId, label: relType });
              }
            }
          }
        } else {
          const n = record.get('n');
          const r = record.get('r');
          const m = record.get('m');
          const sourceId = addNode(n);
          const targetId = addNode(m);
          const relType = r.type;
          const key = `${sourceId}-${relType}-${targetId}`;
          if (!seenLinks.has(key)) {
            seenLinks.add(key);
            links.push({ source: sourceId, target: targetId, label: relType });
          }
        }
      }

      await session.close();
      return new Response(JSON.stringify({ nodes: Array.from(nodeMap.values()), links }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } finally {
      await session.close();
    }
  } catch (error) {
    console.error('Graph data error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    if (driver) await driver.close();
  }
});
