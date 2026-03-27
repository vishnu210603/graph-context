// v4 - Neo4j Aura Query API v2
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const NEO4J_URI = Deno.env.get("NEO4J_URI");
  const NEO4J_USER = Deno.env.get("NEO4J_USER");
  const NEO4J_PASSWORD = Deno.env.get("NEO4J_PASSWORD");

  if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) {
    return new Response(
      JSON.stringify({ error: "Neo4j credentials missing" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const host = NEO4J_URI.replace("neo4j+s://", "").replace("neo4j://", "").split("/")[0];
  const dbName = host.split(".")[0];
  const neo4jUrl = `https://${host}/db/${dbName}/query/v2`;
  const basicAuth = "Basic " + btoa(`${NEO4J_USER}:${NEO4J_PASSWORD}`);

  async function cypher(statement: string, parameters: Record<string, unknown> = {}) {
    const res = await fetch(neo4jUrl, {
      method: "POST",
      headers: {
        Authorization: basicAuth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ statement, parameters }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Neo4j ${res.status}: ${t.slice(0, 300)}`);
    }
    const d = await res.json();
    if (d.errors?.length) throw new Error(d.errors.map((e: any) => e.message).join("; "));
    return d;
  }

  function toGraph(result: any) {
    const nodes = new Map<string, any>();
    const edgeKeys = new Set<string>();
    const links: any[] = [];
    for (const row of result.data?.values || []) {
      for (const f of row) {
        if (!f || typeof f !== "object") continue;
        if (Array.isArray(f.labels) && f.elementId) {
          if (!nodes.has(f.elementId)) {
            const p = f.properties || {};
            const t = f.labels[0] || "Unknown";
            nodes.set(f.elementId, {
              id: f.elementId,
              label: p.salesOrder || p.delivery || p.billingDocument || p.plant || p.material || p.materialDescription || p.name || p.id || t,
              type: t,
              properties: p,
            });
          }
        }
        if (f.startNodeElementId && f.endNodeElementId) {
          const k = `${f.startNodeElementId}-${f.endNodeElementId}`;
          if (!edgeKeys.has(k)) {
            edgeKeys.add(k);
            links.push({ source: f.startNodeElementId, target: f.endNodeElementId, label: f.type || "REL" });
          }
        }
      }
    }
    return { nodes: Array.from(nodes.values()), links };
  }

  try {
    const body = await req.json();
    const { action, filters, nodeId } = body;
    let q = "";
    let p: Record<string, unknown> = {};

    if (action === "initial") {
      q = "MATCH (so:SalesOrder)-[r1:HAS_ITEM]->(item:SalesOrderItem) OPTIONAL MATCH (item)-[r2:USES_MATERIAL]->(m:Material) OPTIONAL MATCH (m)-[r3:PRODUCED_AT]->(pl:Plant) RETURN so,r1,item,r2,m,r3,pl LIMIT 80";
    } else if (action === "expand") {
      q = "MATCH (n)-[r]-(c) WHERE elementId(n)=$nodeId RETURN n,r,c LIMIT 50";
      p = { nodeId };
    } else if (action === "graph") {
      if (filters?.nodeType && !['SalesOrder', 'SalesOrderItem', 'Material', 'Plant', ''].includes(filters.nodeType)) {
        q = `MATCH (n:\`${filters.nodeType}\`)-[r]-(c) RETURN n,r,c LIMIT 200`;
      } else {
        const conds: string[] = [];
        if (filters?.orderId) { conds.push("so.salesOrder = $orderId"); p.orderId = filters.orderId; }
        if (filters?.plantId) { conds.push("pl.plant = $plantId"); p.plantId = filters.plantId; }
        if (filters?.materialId) { conds.push("m.material = $materialId"); p.materialId = filters.materialId; }
        if (filters?.currency) { conds.push("item.transactionCurrency = $currency"); p.currency = filters.currency; }
        if (filters?.minRevenue > 0) { conds.push("item.netAmount >= $minRevenue"); p.minRevenue = filters.minRevenue; }
        if (filters?.maxRevenue && filters.maxRevenue < 999999) { conds.push("item.netAmount <= $maxRevenue"); p.maxRevenue = filters.maxRevenue; }
        if (filters?.nodeType === 'Material') { conds.push("m IS NOT NULL"); }
        if (filters?.nodeType === 'Plant') { conds.push("pl IS NOT NULL"); }
        const w = conds.length ? "WHERE " + conds.join(" AND ") : "";
        q = `MATCH (so:SalesOrder)-[r1:HAS_ITEM]->(item:SalesOrderItem) OPTIONAL MATCH (item)-[r2:USES_MATERIAL]->(m:Material) OPTIONAL MATCH (m)-[r3:PRODUCED_AT]->(pl:Plant) ${w} RETURN so,r1,item,r2,m,r3,pl LIMIT 200`;
      }
    } else if (action === "schema") {
      const lr = await cypher("CALL db.labels() YIELD label RETURN collect(label) as labels");
      const rr = await cypher("CALL db.relationshipTypes() YIELD relationshipType RETURN collect(relationshipType) as types");
      return new Response(JSON.stringify({
        labels: lr.data?.values?.[0]?.[0] || [],
        relationshipTypes: rr.data?.values?.[0]?.[0] || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else if (action === "lookup") {
      const orders = await cypher("MATCH (so:SalesOrder) RETURN DISTINCT so.salesOrder AS val ORDER BY val LIMIT 100");
      const plants = await cypher("MATCH (pl:Plant) RETURN DISTINCT pl.plant AS val ORDER BY val LIMIT 100");
      const materials = await cypher("MATCH (m:Material) RETURN DISTINCT m.material AS val ORDER BY val LIMIT 100");
      const currencies = await cypher("MATCH (item:SalesOrderItem) RETURN DISTINCT item.transactionCurrency AS val ORDER BY val LIMIT 50");
      const labels = await cypher("CALL db.labels() YIELD label RETURN collect(label) as labels");

      const extract = (r: any) => (r.data?.values || []).map((v: any) => v[0]).filter(Boolean);

      return new Response(JSON.stringify({
        orders: extract(orders),
        plants: extract(plants),
        materials: extract(materials),
        currencies: extract(currencies),
        nodeTypes: labels.data?.values?.[0]?.[0] || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await cypher(q, p);
    const graph = toGraph(result);
    return new Response(JSON.stringify(graph), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[graph-data] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
