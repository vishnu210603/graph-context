import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import neo4j from "npm:neo4j-driver@5.27.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SYSTEM_PROMPT = `You are a data analyst assistant for a business graph database stored in Neo4j. The database contains these entity types:

ENTITIES: SalesOrder, PurchaseOrder, Delivery, BillingDocument, Invoice, Payment, JournalEntry, Customer, Material, Product, Plant, Address, SalesOrderItem, PurchaseOrderItem

RELATIONSHIPS: Orders CONTAIN items, Orders linked to Customers, Deliveries linked to Orders/Plants, BillingDocuments linked to Deliveries/Orders, JournalEntries linked to BillingDocuments, Items reference Materials/Products

IMPORTANT RULES:
1. When you need data, generate exactly ONE Cypher query in a \`\`\`cypher code block. Only ONE query.
2. ONLY answer questions about this business dataset (orders, deliveries, invoices, customers, products, etc.)
3. For unrelated questions respond: "This system is designed to answer questions related to the provided dataset only."
4. Keep queries simple and efficient. Use LIMIT when appropriate.
5. Provide clear natural language answers grounded in the data.`;

async function executeCypher(query: string): Promise<any> {
  const NEO4J_URI = Deno.env.get('NEO4J_URI');
  const NEO4J_USER = Deno.env.get('NEO4J_USER');
  const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

  if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) return null;

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
          // Convert neo4j integers
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

    const llmResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: llmMessages, temperature: 0.3, max_tokens: 1500 }),
    });

    if (!llmResponse.ok) {
      if (llmResponse.status === 429) {
        return new Response(JSON.stringify({ reply: 'Rate limit reached. Please wait and try again.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`LLM API error: ${llmResponse.status}`);
    }

    const llmResult = await llmResponse.json();
    let reply = llmResult.choices?.[0]?.message?.content || 'No response generated.';

    // Execute Cypher if present
    const cypherMatch = reply.match(/```cypher\n([\s\S]*?)```/);
    if (cypherMatch) {
      const cypherQuery = cypherMatch[1].trim();
      const queryResult = await executeCypher(cypherQuery);

      if (queryResult && !queryResult.error) {
        const resultStr = JSON.stringify(queryResult.slice(0, 50)).substring(0, 4000);

        const followUp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              ...llmMessages,
              { role: 'assistant', content: reply },
              { role: 'user', content: `Here are the query results (${queryResult.length} total records). Provide a clear natural language summary:\n${resultStr}` },
            ],
            temperature: 0.3,
            max_tokens: 1500,
          }),
        });

        if (followUp.ok) {
          const followUpResult = await followUp.json();
          reply = followUpResult.choices?.[0]?.message?.content || reply;
        }
      } else if (queryResult?.error) {
        reply += `\n\n⚠️ Query error: ${queryResult.error}`;
      }
    }

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({ reply: `Error: ${error.message}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
