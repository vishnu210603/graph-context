import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function runCypher(httpUri: string, user: string, password: string, query: string) {
  const endpoints = [
    { url: `${httpUri}/db/neo4j/query/v2`, body: JSON.stringify({ statement: query }), parse: 'v2' },
    { url: `${httpUri}/db/data/query/v2`, body: JSON.stringify({ statement: query }), parse: 'v2' },
    { url: `${httpUri}/db/neo4j/tx/commit`, body: JSON.stringify({ statements: [{ statement: query, resultDataContents: ['row'] }] }), parse: 'tx' },
  ];

  for (const ep of endpoints) {
    try {
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
        console.error(`${ep.url} returned ${response.status}: ${text}`);
        continue;
      }
      return await response.json();
    } catch (err) {
      console.error(`${ep.url} error:`, err);
      continue;
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You are a data analyst assistant for a business graph database stored in Neo4j. The database contains these entity types:

ENTITIES: SalesOrder, PurchaseOrder, Delivery, BillingDocument, Invoice, Payment, JournalEntry, Customer, Material, Product, Plant, Address, SalesOrderItem, PurchaseOrderItem

RELATIONSHIPS: Orders CONTAIN items, Orders linked to Customers, Deliveries linked to Orders/Plants, BillingDocuments linked to Deliveries/Orders, JournalEntries linked to BillingDocuments, Items reference Materials/Products

IMPORTANT RULES:
1. When you need data, generate ONE Cypher query in a \`\`\`cypher code block. Only ONE query per response.
2. ONLY answer questions about this business dataset (orders, deliveries, invoices, customers, products, etc.)
3. For unrelated questions respond: "This system is designed to answer questions related to the provided dataset only."
4. Keep queries simple and efficient. Use LIMIT when appropriate.
5. Provide clear natural language answers grounded in the data.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USER = Deno.env.get('NEO4J_USER');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured');

    const llmMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages];

    // First LLM call
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
    if (cypherMatch && NEO4J_URI && NEO4J_USER && NEO4J_PASSWORD) {
      const cypherQuery = cypherMatch[1].trim();
      const httpUri = NEO4J_URI.replace('neo4j+s://', 'https://').replace('neo4j://', 'http://').replace('bolt+s://', 'https://').replace('bolt://', 'http://');

      const queryResult = await runCypher(httpUri, NEO4J_USER, NEO4J_PASSWORD, cypherQuery);

      if (queryResult) {
        const resultStr = JSON.stringify(queryResult).substring(0, 4000);

        const followUp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              ...llmMessages,
              { role: 'assistant', content: reply },
              { role: 'user', content: `Here are the query results. Provide a clear natural language summary:\n${resultStr}` },
            ],
            temperature: 0.3,
            max_tokens: 1500,
          }),
        });

        if (followUp.ok) {
          const followUpResult = await followUp.json();
          reply = followUpResult.choices?.[0]?.message?.content || reply;
        }
      } else {
        reply += '\n\n⚠️ Could not execute the database query. The database may be temporarily unavailable.';
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
