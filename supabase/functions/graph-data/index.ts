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

    let filters: any = {};
    try {
      if (req.method === 'POST') {
        filters = await req.json();
      }
    } catch { /* no body */ }

    const orderId = filters.orderId || null;
    const plantId = filters.plantId || null;
    const materialId = filters.materialId || null;
    const currency = filters.currency || null;
    const nodeType = filters.nodeType || null;
    const minRevenue = filters.minRevenue ?? 0;
    const maxRevenue = filters.maxRevenue ?? 999999999;
    const minQty = filters.minQty ?? 0;

    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

    const hasFilters = orderId || plantId || materialId || currency || nodeType || minRevenue > 0 || maxRevenue < 999999999 || minQty > 0;

    let query: string;
    let params: Record<string, any> = {};

    if (hasFilters) {
      // Single combined query that returns nodes and relationships
      query = `
        MATCH (so:SalesOrder)-[r1:HAS_ITEM]->(item:SalesOrderItem)
        OPTIONAL MATCH (item)-[r2:USES_MATERIAL]->(m:Material)
        OPTIONAL MATCH (m)-[r3:PRODUCED_AT]->(p:Plant)
        WHERE 
          ($orderId IS NULL OR so.salesOrder = $orderId) AND
          ($plantId IS NULL OR p.plant = $plantId) AND
          ($materialId IS NULL OR m.id = $materialId) AND
          ($currency IS NULL OR item.transactionCurrency = $currency) AND
          (item.requestedQuantity >= $minQty)
        WITH so, item, m, p, r1, r2, r3, item.netAmount AS revenue
        WHERE revenue >= $minRevenue AND revenue <= $maxRevenue
        RETURN so, item, m, p, r1, r2, r3
        LIMIT 200
      `;
      params = { orderId, plantId, materialId, currency, minRevenue, maxRevenue, minQty };
    } else {
      // Single query that returns paths
      query = `
        MATCH (so:SalesOrder)-[r1:HAS_ITEM]->(item:SalesOrderItem)
        OPTIONAL MATCH (item)-[r2:USES_MATERIAL]->(m:Material)
        OPTIONAL MATCH (m)-[r3:PRODUCED_AT]->(p:Plant)
        RETURN so, item, m, p, r1, r2, r3
        LIMIT 200
      `;
    }

    const session = driver.session();
    try {
      const result = await session.run(query, params);

      const nodeMap = new Map();
      const links: any[] = [];
      const seenLinks = new Set();

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
        const label = props.salesOrder || props.plant || props.name || props.id || props.number || props.description || String(id).split(':').pop();
        nodeMap.set(id, { id, label: String(label).substring(0, 30), type, properties: props });
        return id;
      }

      function addRel(rel: any) {
        if (!rel) return;
        const sourceId = rel.startNodeElementId || rel.start?.toString();
        const targetId = rel.endNodeElementId || rel.end?.toString();
        const relType = rel.type;
        const linkKey = `${sourceId}-${relType}-${targetId}`;
        if (!seenLinks.has(linkKey) && nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          seenLinks.add(linkKey);
          links.push({ source: sourceId, target: targetId, label: relType });
        }
      }

      for (const record of result.records) {
        // Add all nodes first
        addNode(record.get('so'));
        addNode(record.get('item'));
        addNode(record.get('m'));
        addNode(record.get('p'));
        // Then relationships
        addRel(record.get('r1'));
        addRel(record.get('r2'));
        addRel(record.get('r3'));
      }

      // If nodeType filter, remove non-matching nodes and dangling links
      let nodes = Array.from(nodeMap.values());
      let finalLinks = links;
      if (nodeType) {
        const keepIds = new Set(nodes.filter(n => n.type === nodeType).map(n => n.id));
        // Also keep nodes connected to matching nodes
        for (const link of links) {
          if (keepIds.has(link.source)) keepIds.add(link.target);
          if (keepIds.has(link.target)) keepIds.add(link.source);
        }
        nodes = nodes.filter(n => keepIds.has(n.id));
        const nodeIds = new Set(nodes.map(n => n.id));
        finalLinks = links.filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));
      }

      return new Response(JSON.stringify({ nodes, links: finalLinks }), {
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
