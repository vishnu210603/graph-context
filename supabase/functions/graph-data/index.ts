import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USER = Deno.env.get('NEO4J_USER');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

    if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) {
      throw new Error('Neo4j credentials not configured');
    }

    // Convert bolt URI to HTTP API
    const httpUri = NEO4J_URI
      .replace('neo4j+s://', 'https://')
      .replace('neo4j://', 'http://')
      .replace('bolt+s://', 'https://')
      .replace('bolt://', 'http://');

    // Query to get a sample of the graph (limit for performance)
    const query = `
      MATCH (n)
      WITH n LIMIT 200
      OPTIONAL MATCH (n)-[r]->(m)
      RETURN 
        collect(DISTINCT {
          id: elementId(n),
          labels: labels(n),
          properties: properties(n)
        }) as nodes,
        collect(DISTINCT {
          source: elementId(n),
          target: elementId(m),
          type: type(r)
        }) as relationships
    `;

    const response = await fetch(`${httpUri}/db/neo4j/tx/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${NEO4J_USER}:${NEO4J_PASSWORD}`),
      },
      body: JSON.stringify({
        statements: [{ statement: query, resultDataContents: ['row'] }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Neo4j error:', response.status, text);
      throw new Error(`Neo4j query failed: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.errors && result.errors.length > 0) {
      console.error('Neo4j query errors:', result.errors);
      throw new Error(result.errors[0].message);
    }

    const row = result.results?.[0]?.data?.[0]?.row;
    const rawNodes = row?.[0] || [];
    const rawRels = row?.[1] || [];

    // Build unique nodes
    const nodeMap = new Map();
    for (const n of rawNodes) {
      if (!n.id || nodeMap.has(n.id)) continue;
      const type = n.labels?.[0] || 'Unknown';
      const props = n.properties || {};
      const label = props.name || props.id || props.number || props.description || n.id.split(':').pop();
      nodeMap.set(n.id, {
        id: n.id,
        label: String(label).substring(0, 30),
        type,
        properties: props,
      });
    }

    // Build links (only where both source and target exist)
    const links = [];
    const seenLinks = new Set();
    for (const r of rawRels) {
      if (!r.source || !r.target || !r.type) continue;
      if (!nodeMap.has(r.source) || !nodeMap.has(r.target)) continue;
      const key = `${r.source}-${r.type}-${r.target}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ source: r.source, target: r.target, label: r.type });
    }

    const graphData = {
      nodes: Array.from(nodeMap.values()),
      links,
    };

    return new Response(JSON.stringify(graphData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Graph data error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
