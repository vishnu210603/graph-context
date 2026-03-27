import { supabase } from '@/integrations/supabase/client';
import type { GraphData, FilterState, LookupData } from '@/types/graph';

export async function fetchInitialGraph(): Promise<GraphData> {
  const resp = await supabase.functions.invoke('graph-data', {
    body: { action: 'initial' },
  });
  if (resp.error) throw new Error(resp.error.message);
  return resp.data || { nodes: [], links: [] };
}

export async function fetchFilteredGraph(filters: FilterState): Promise<GraphData> {
  const resp = await supabase.functions.invoke('graph-data', {
    body: { action: 'graph', filters },
  });
  if (resp.error) throw new Error(resp.error.message);
  return resp.data || { nodes: [], links: [] };
}

export async function expandNode(nodeId: string): Promise<GraphData> {
  const resp = await supabase.functions.invoke('graph-data', {
    body: { action: 'expand', nodeId },
  });
  if (resp.error) throw new Error(resp.error.message);
  return resp.data || { nodes: [], links: [] };
}

export async function fetchLookupData(): Promise<LookupData> {
  const resp = await supabase.functions.invoke('graph-data', {
    body: { action: 'lookup' },
  });
  if (resp.error) throw new Error(resp.error.message);
  return resp.data || { orders: [], plants: [], materials: [], currencies: [], nodeTypes: [] };
}

export async function sendChatMessage(
  message: string,
  history: { role: string; content: string }[]
): Promise<string> {
  const resp = await supabase.functions.invoke('chat', {
    body: { message, history },
  });
  if (resp.error) throw new Error(resp.error.message);
  return resp.data?.response || resp.data?.reply || 'No response generated.';
}
