import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const NEO4J_URI = Deno.env.get('NEO4J_URI');
  const NEO4J_USER = Deno.env.get('NEO4J_USER');
  const NEO4J_PASSWORD = Deno.env.get('NEO4J_PASSWORD');
  const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');

  if (!NEO4J_URI || !NEO4J_USER || !NEO4J_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Neo4j credentials not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const host = NEO4J_URI.replace('neo4j+s://', '').replace('neo4j://', '').split('/')[0];
  const dbName = host.split('.')[0];
  const neo4jQueryUrl = `https://${host}/db/${dbName}/query/v2`;
  const authHeader = 'Basic ' + btoa(`${NEO4J_USER}:${NEO4J_PASSWORD}`);

  async function runCypher(query: string, params: Record<string, any> = {}) {
    const resp = await fetch(neo4jQueryUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ statement: query, parameters: params }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Neo4j HTTP error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    if (data.errors && data.errors.length > 0) {
      throw new Error(data.errors.map((e: any) => e.message).join('; '));
    }
    return data;
  }

  async function getSchemaInfo() {
    try {
      const labelsResult = await runCypher("CALL db.labels() YIELD label RETURN collect(label) as labels");
      const relsResult = await runCypher("CALL db.relationshipTypes() YIELD relationshipType RETURN collect(relationshipType) as types");

      const labels = labelsResult.data?.values?.[0]?.[0] || [];
      const relTypes = relsResult.data?.values?.[0]?.[0] || [];

      const propsInfo: string[] = [];
      for (const label of labels.slice(0, 10)) {
        try {
          const propResult = await runCypher(`MATCH (n:\`${label}\`) RETURN keys(n) as props LIMIT 1`);
          const props = propResult.data?.values?.[0]?.[0] || [];
          propsInfo.push(`${label}: {${props.join(', ')}}`);
        } catch { /* skip */ }
      }

      return { labels, relTypes, propsInfo };
    } catch (e) {
      console.error('Schema fetch error:', e);
      return { labels: [], relTypes: [], propsInfo: [] };
    }
  }

  try {
    const body = await req.json();
    // Support both old format { messages } and new format { message, history }
    let message: string;
    let history: { role: string; content: string }[] = [];

    if (body.message) {
      message = body.message;
      history = body.history || [];
    } else if (body.messages && Array.isArray(body.messages)) {
      const msgs = body.messages;
      message = msgs[msgs.length - 1]?.content || '';
      history = msgs.slice(0, -1);
    } else {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Guardrail
    const lowerMsg = message.toLowerCase();
    const offTopicPatterns = [
      /write (a |me )?(poem|story|essay|song|joke)/,
      /what is the meaning of life/,
      /tell me about yourself/,
      /who (is|was) (the president|elon|trump|biden)/,
      /recipe for/,
      /how to (cook|bake|make food)/,
    ];

    if (offTopicPatterns.some(p => p.test(lowerMsg))) {
      return new Response(JSON.stringify({
        response: "This system is designed to answer questions related to the provided dataset only. I can help you explore sales orders, deliveries, billing documents, journal entries, materials, plants, and their relationships."
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const schema = await getSchemaInfo();

    const systemPrompt = `You are a data analyst assistant for a business graph database. You help users query and understand relationships between business entities.

## Database Schema (Neo4j)
Node Labels: ${schema.labels.join(', ')}
Relationship Types: ${schema.relTypes.join(', ')}
Node Properties:
${schema.propsInfo.join('\n')}

## Your Role
1. When the user asks a question about the data, generate a Cypher query to answer it.
2. Return ONLY a JSON object with this format: {"cypher": "YOUR QUERY HERE", "explanation": "brief explanation"}
3. If the question is not related to the dataset, respond with: {"guardrail": true, "response": "This system is designed to answer questions related to the provided dataset only."}
4. Use LIMIT to keep results manageable (max 25 rows).
5. Always use proper Cypher syntax for Neo4j.
6. Focus on the entity types and relationships present in the schema.

## Important
- Only answer questions about the dataset
- Generate valid Cypher queries
- Be concise in explanations`;

    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...(history || []).slice(-6),
      { role: 'user', content: message },
    ];

    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: chatMessages,
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text();
      console.error('Groq error:', groqResp.status, errText);
      if (groqResp.status === 429) {
        return new Response(JSON.stringify({ response: 'Rate limited. Please try again in a moment.' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Groq API error: ${groqResp.status}`);
    }

    const groqData = await groqResp.json();
    const llmResponse = groqData.choices?.[0]?.message?.content || '';

    let finalResponse = '';
    try {
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.guardrail) {
          finalResponse = parsed.response || "This system is designed to answer questions related to the provided dataset only.";
        } else if (parsed.cypher) {
          try {
            const cypherResult = await runCypher(parsed.cypher);
            const rows = cypherResult.data?.values || [];
            const columns = cypherResult.data?.fields || [];

            if (rows.length === 0) {
              finalResponse = `${parsed.explanation || ''}\n\nThe query returned no results.`;
            } else {
              let resultTable = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;
              for (const row of rows.slice(0, 25)) {
                const formattedRow = row.map((cell: any) => {
                  if (cell === null || cell === undefined) return '-';
                  if (typeof cell === 'object') return JSON.stringify(cell).slice(0, 50);
                  return String(cell).slice(0, 50);
                });
                resultTable += `| ${formattedRow.join(' | ')} |\n`;
              }

              finalResponse = `${parsed.explanation || ''}\n\n${resultTable}\n\n*${rows.length} result${rows.length !== 1 ? 's' : ''}*`;
            }
          } catch (cypherErr: any) {
            finalResponse = `Query failed: ${cypherErr.message}\n\nCould you rephrase your question?`;
          }
        } else {
          finalResponse = llmResponse;
        }
      } else {
        finalResponse = llmResponse;
      }
    } catch {
      finalResponse = llmResponse;
    }

    return new Response(JSON.stringify({ response: finalResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('Chat error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
