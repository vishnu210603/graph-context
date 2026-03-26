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

    if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) {
      throw new Error('Neo4j credentials not configured');
    }

    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    const session = driver.session();

    try {
      // Get nodes
      const nodesResult = await session.run('MATCH (n) RETURN n LIMIT 300');
      const relsResult = await session.run('MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 500');

      const nodeMap = new Map();

      function addNode(record: any) {
        const node = record;
        const id = node.elementId || node.identity?.toString();
        if (!id || nodeMap.has(id)) return id;
        const labels = node.labels || [];
        const props: Record<string, any> = {};
        for (const [k, v] of Object.entries(node.properties || {})) {
          props[k] = typeof v === 'object' && v !== null && 'low' in v ? (v as any).low : v;
        }
        const type = labels[0] || 'Unknown';
        const label = props.name || props.id || props.number || props.description || props.MaterialNumber || props.CustomerNumber || String(id).split(':').pop();
        nodeMap.set(id, { id, label: String(label).substring(0, 30), type, properties: props });
        return id;
      }

      for (const record of nodesResult.records) {
        addNode(record.get('n'));
      }

      const links: any[] = [];
      const seenLinks = new Set();
      for (const record of relsResult.records) {
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
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    if (driver) await driver.close();
  }
});
