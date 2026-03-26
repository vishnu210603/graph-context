import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function runCypher(httpUri: string, user: string, password: string, query: string, params: Record<string, any> = {}) {
  // Try Query API v2 first, fallback to tx/commit
  const endpoints = [
    { url: `${httpUri}/db/neo4j/query/v2`, body: JSON.stringify({ statement: query, parameters: params }), parse: 'v2' },
    { url: `${httpUri}/db/data/query/v2`, body: JSON.stringify({ statement: query, parameters: params }), parse: 'v2' },
    { url: `${httpUri}/db/neo4j/tx/commit`, body: JSON.stringify({ statements: [{ statement: query, parameters: params, resultDataContents: ['row'] }] }), parse: 'tx' },
  ];

  for (const ep of endpoints) {
    try {
      console.log(`Trying endpoint: ${ep.url}`);
      const response = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Basic ' + btoa(`${user}:${password}`),
        },
        body: ep.body,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`Endpoint ${ep.url} returned ${response.status}: ${text}`);
        continue;
      }

      const result = await response.json();
      console.log(`Success with endpoint: ${ep.url}`);
      return { result, format: ep.parse };
    } catch (err) {
      console.error(`Endpoint ${ep.url} error:`, err);
      continue;
    }
  }

  throw new Error('All Neo4j API endpoints failed. Check credentials and database status.');
}

function parseNodes(result: any, format: string) {
  const nodeMap = new Map();
  const links: any[] = [];
  const seenLinks = new Set();

  if (format === 'v2') {
    // Query API v2 format: { data: { fields: [...], values: [[...], ...] } }
    const records = result.data?.values || result.records || [];
    for (const record of records) {
      const row = Array.isArray(record) ? record : [record];
      for (const item of row) {
        if (!item) continue;
        // Node object
        if (item.elementId || item._id !== undefined) {
          const id = item.elementId || String(item._id);
          if (!nodeMap.has(id)) {
            const labels = item.labels || [];
            const props = item.properties || item;
            const type = labels[0] || 'Unknown';
            const label = props.name || props.id || props.number || props.description || id.split(':').pop();
            nodeMap.set(id, { id, label: String(label).substring(0, 30), type, properties: props });
          }
        }
        // Relationship object
        if (item.startNodeElementId && item.endNodeElementId) {
          const key = `${item.startNodeElementId}-${item.type}-${item.endNodeElementId}`;
          if (!seenLinks.has(key)) {
            seenLinks.add(key);
            links.push({ source: item.startNodeElementId, target: item.endNodeElementId, label: item.type || 'RELATED' });
          }
        }
      }
    }
  } else {
    // tx/commit format
    const columns = result.results?.[0]?.columns || [];
    const rows = result.results?.[0]?.data || [];
    for (const dataRow of rows) {
      const row = dataRow.row || [];
      const meta = dataRow.meta || [];
      for (let i = 0; i < row.length; i++) {
        const item = row[i];
        const m = meta[i];
        if (!item || !m) continue;
        if (m.type === 'node') {
          const id = String(m.id);
          if (!nodeMap.has(id)) {
            const type = m.labels?.[0] || columns[i] || 'Unknown';
            const label = item.name || item.id || item.number || item.description || id;
            nodeMap.set(id, { id, label: String(label).substring(0, 30), type, properties: item });
          }
        }
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USER = Deno.env.get('NEO4J_USER');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

    if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) {
      throw new Error('Neo4j credentials not configured');
    }

    const httpUri = NEO4J_URI
      .replace('neo4j+s://', 'https://')
      .replace('neo4j://', 'http://')
      .replace('bolt+s://', 'https://')
      .replace('bolt://', 'http://');

    // Get nodes and relationships
    const nodesQuery = `MATCH (n) RETURN n LIMIT 300`;
    const relsQuery = `MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 500`;

    const [nodesResult, relsResult] = await Promise.all([
      runCypher(httpUri, NEO4J_USER, NEO4J_PASSWORD, nodesQuery),
      runCypher(httpUri, NEO4J_USER, NEO4J_PASSWORD, relsQuery),
    ]);

    const nodeData = parseNodes(nodesResult.result, nodesResult.format);
    const relData = parseNodes(relsResult.result, relsResult.format);

    // Merge nodes
    const allNodes = new Map();
    for (const n of [...nodeData.nodes, ...relData.nodes]) {
      if (!allNodes.has(n.id)) allNodes.set(n.id, n);
    }

    // Filter links to only include nodes we have
    const allLinks = relData.links.filter(l => allNodes.has(l.source) && allNodes.has(l.target));

    return new Response(JSON.stringify({ nodes: Array.from(allNodes.values()), links: allLinks }), {
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
