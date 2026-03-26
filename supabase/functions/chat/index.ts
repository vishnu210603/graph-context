import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SYSTEM_PROMPT = `You are a data analyst assistant for a business graph database. The database contains the following entity types and relationships:

ENTITIES:
- SalesOrder / PurchaseOrder: Business orders with properties like order number, date, amount
- Delivery: Deliveries linked to orders, with delivery dates and quantities
- BillingDocument / Invoice: Billing records linked to deliveries and orders
- Payment / JournalEntry: Financial records linked to invoices
- Customer: Customer entities with names and IDs
- Material / Product: Items ordered or delivered
- Plant: Warehouse/plant locations

RELATIONSHIPS:
- Orders CONTAIN items (PurchaseOrderItem, SalesOrderItem)
- Orders are linked to Customers
- Deliveries are linked to Orders and Plants
- BillingDocuments are linked to Deliveries and Orders
- JournalEntries are linked to BillingDocuments
- Items reference Materials/Products

You can answer questions about:
- Order flows (order → delivery → billing → payment)
- Finding broken/incomplete flows
- Product/material analysis
- Customer analysis
- Relationships between entities

GUARDRAILS:
- ONLY answer questions related to the dataset and domain (orders, deliveries, invoices, payments, customers, products, etc.)
- If a user asks about general knowledge, creative writing, coding help, or anything NOT related to this business data, respond with: "This system is designed to answer questions related to the provided dataset only. Please ask about orders, deliveries, invoices, customers, or products."
- Always ground your answers in the data. If you need to query, generate a Cypher query.

When you need to query data, generate a Cypher query and I will execute it. Format queries in a \`\`\`cypher code block.

Provide clear, concise answers with relevant data points.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
    const NEO4J_URI = Deno.env.get('NEO4J_URI');
    const NEO4J_USER = Deno.env.get('NEO4J_USER');
    const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');

    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured');

    // First LLM call to understand the query and potentially generate Cypher
    const llmMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    const llmResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: llmMessages,
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('Groq error:', llmResponse.status, errText);
      if (llmResponse.status === 429) {
        return new Response(JSON.stringify({ reply: 'Rate limit reached. Please wait a moment and try again.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`LLM API error: ${llmResponse.status}`);
    }

    const llmResult = await llmResponse.json();
    let reply = llmResult.choices?.[0]?.message?.content || 'No response generated.';

    // Check if the reply contains a Cypher query to execute
    const cypherMatch = reply.match(/```cypher\n([\s\S]*?)```/);
    
    if (cypherMatch && NEO4J_URI && NEO4J_USER && NEO4J_PASSWORD) {
      const cypherQuery = cypherMatch[1].trim();
      
      const httpUri = NEO4J_URI
        .replace('neo4j+s://', 'https://')
        .replace('neo4j://', 'http://')
        .replace('bolt+s://', 'https://')
        .replace('bolt://', 'http://');

      try {
        const neo4jResponse = await fetch(`${httpUri}/db/neo4j/tx/commit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa(`${NEO4J_USER}:${NEO4J_PASSWORD}`),
          },
          body: JSON.stringify({
            statements: [{ statement: cypherQuery, resultDataContents: ['row'] }],
          }),
        });

        if (neo4jResponse.ok) {
          const neo4jResult = await neo4jResponse.json();
          
          if (neo4jResult.errors?.length > 0) {
            reply += `\n\n⚠️ Query error: ${neo4jResult.errors[0].message}`;
          } else {
            const columns = neo4jResult.results?.[0]?.columns || [];
            const rows = neo4jResult.results?.[0]?.data?.map((d: any) => d.row) || [];
            
            if (rows.length > 0) {
              // Send results back to LLM for natural language answer
              const resultSummary = JSON.stringify({ columns, rows: rows.slice(0, 50) });
              
              const followUpResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${GROQ_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'llama-3.3-70b-versatile',
                  messages: [
                    ...llmMessages,
                    { role: 'assistant', content: reply },
                    { role: 'user', content: `Here are the query results. Please provide a clear, natural language summary of these results:\n${resultSummary}` },
                  ],
                  temperature: 0.3,
                  max_tokens: 2048,
                }),
              });

              if (followUpResponse.ok) {
                const followUpResult = await followUpResponse.json();
                reply = followUpResult.choices?.[0]?.message?.content || reply;
              }
            } else {
              reply += '\n\nThe query returned no results.';
            }
          }
        }
      } catch (neo4jError) {
        console.error('Neo4j execution error:', neo4jError);
        reply += '\n\n⚠️ Could not execute database query. Providing answer based on general knowledge of the dataset.';
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
