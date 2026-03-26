import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import neo4j from "npm:neo4j-driver@5.27.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SYSTEM_PROMPT = `You are a precise data analyst assistant for a business graph database stored in Neo4j. The database contains:

ENTITIES: SalesOrder, PurchaseOrder, Delivery, BillingDocument, Invoice, Payment, JournalEntry, Customer, Material, Product, Plant, Address, SalesOrderItem, PurchaseOrderItem

RELATIONSHIPS: 
- SalesOrder -[:HAS_ITEM]-> SalesOrderItem
- SalesOrderItem -[:USES_MATERIAL]-> Material
- Material -[:PRODUCED_AT]-> Plant
- Orders linked to Customers via various relationships
- Deliveries linked to Orders/Plants
- BillingDocuments linked to Deliveries/Orders
- JournalEntries linked to BillingDocuments

CRITICAL RULES:
1. You MUST ALWAYS generate a Cypher query to answer ANY data question. NEVER guess or make up data.
2. Put your query in a \`\`\`cypher code block. Generate exactly ONE query.
3. ONLY answer questions about this business dataset (orders, deliveries, invoices, customers, products, materials, plants, etc.)
4. For unrelated questions respond: "This system is designed to answer questions related to the provided dataset only."
5. Keep queries simple and efficient. Always use LIMIT (default LIMIT 25).
6. When summarizing results, be specific with numbers and IDs from the actual data. Never fabricate values.
7. If a query returns no results, say so clearly - do NOT make up data.
8. Common property names: salesOrder (on SalesOrder), plant (on Plant), id (on Material), transactionCurrency, netAmount, requestedQuantity (on SalesOrderItem)

EXAMPLE QUERIES:
- Count orders: MATCH (so:SalesOrder) RETURN count(so) AS totalOrders
- Top revenue: MATCH (so:SalesOrder)-[:HAS_ITEM]->(item) WITH so, sum(item.netAmount) AS revenue RETURN so.salesOrder, revenue ORDER BY revenue DESC LIMIT 10
- Materials usage: MATCH (:SalesOrderItem)-[:USES_MATERIAL]->(m:Material) RETURN m.id, count(*) AS usage ORDER BY usage DESC LIMIT 10`;

async function executeCypher(query: string): Promise<any> {
  const NEO4J_URI = Deno.env.get('NEO4J_URI');
  const NEO4J_USER = Deno.env.get('NEO4J_USER');
  const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
  if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) return { error: 'Neo4j not configured' };

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();

  try {
    const result = await session.run(query);
    const records = result.records.map((record: any) => {
      const obj: Record<string, any> = {};
      record.keys.forEach((key: string) => {
        const val = record.get(key);
        if (val && typeof val === 'object' && val.properties) {
          obj[key] = { labels: val.labels, ...val.properties };
          for (const [k, v] of Object.entries(obj[key])) {
            if (typeof v === 'object' && v !== null && 'low' in v) obj[key][k] = (v as any).low;
          }
        } else if (typeof val === 'object' && val !== null && 'low' in val) {
          obj[key] = (val as any).low;
        } else {
          obj[key] = val;
        }
      });
      return obj;
    });
    return records;
  } catch (err) {
    console.error('Cypher execution error:', err);
    return { error: err.message };
  } finally {
    await session.close();
    await driver.close();
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured');

    const llmMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    // First LLM call to generate Cypher
    const llmResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: llmMessages, temperature: 0.1, max_tokens: 1500 }),
    });

    if (!llmResponse.ok) {
      if (llmResponse.status === 429) {
        return new Response(JSON.stringify({ reply: 'Rate limit reached. Please wait a moment and try again.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`LLM API error: ${llmResponse.status}`);
    }

    const llmResult = await llmResponse.json();
    let reply = llmResult.choices?.[0]?.message?.content || 'No response generated.';

    // Extract and execute Cypher query
    const cypherMatch = reply.match(/```cypher\n([\s\S]*?)```/);
    if (cypherMatch) {
      const cypherQuery = cypherMatch[1].trim();
      console.log('Executing Cypher:', cypherQuery);
      const queryResult = await executeCypher(cypherQuery);

      if (queryResult && !queryResult.error) {
        const resultStr = JSON.stringify(queryResult.slice(0, 50)).substring(0, 4000);
        const recordCount = queryResult.length;

        // Second LLM call to summarize actual results
        const followUp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You are a data analyst. Summarize the query results clearly and specifically. Use exact numbers and IDs from the data. Format with markdown. Do NOT include the cypher query in your response. If results are empty, clearly state no data was found.' },
              { role: 'user', content: messages[messages.length - 1].content },
              { role: 'assistant', content: `I ran a query and got ${recordCount} results.` },
              { role: 'user', content: `Here are the actual query results (${recordCount} records):\n${resultStr}\n\nProvide a clear, specific summary based ONLY on this data. Do not make up any values.` },
            ],
            temperature: 0.1,
            max_tokens: 1500,
          }),
        });

        if (followUp.ok) {
          const followUpResult = await followUp.json();
          reply = followUpResult.choices?.[0]?.message?.content || reply;
        }
      } else if (queryResult?.error) {
        // Try to fix the query
        reply = `I attempted to query the database but encountered an error: ${queryResult.error}\n\nPlease try rephrasing your question.`;
      }
    }

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ reply: `Error: ${error.message}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
