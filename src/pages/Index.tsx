import { useState, useEffect, useRef, useCallback } from 'react';
import GraphVisualization from '@/components/GraphVisualization';
import NodeInfoPanel from '@/components/NodeInfoPanel';
import ChatInterface from '@/components/ChatInterface';
import FilterPanel, { GraphFilters, DEFAULT_FILTERS } from '@/components/FilterPanel';
import AnalyticsPanel from '@/components/AnalyticsPanel';
import { GraphNode, GraphData } from '@/lib/graphData';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Network } from 'lucide-react';

const Index = () => {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GraphFilters>({ ...DEFAULT_FILTERS });
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const updateDimensions = useCallback(() => {
    if (graphContainerRef.current) {
      const rect = graphContainerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    }
  }, []);

  useEffect(() => {
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, [updateDimensions]);

  const fetchGraph = useCallback(async (filterParams?: GraphFilters) => {
    setLoading(true);
    setError(null);
    try {
      const body = filterParams ? {
        orderId: filterParams.orderId || null,
        plantId: filterParams.plantId || null,
        materialId: filterParams.materialId || null,
        currency: filterParams.currency || null,
        nodeType: filterParams.nodeType || null,
        minRevenue: filterParams.minRevenue ?? 0,
        maxRevenue: filterParams.maxRevenue ?? 999999,
        minQty: filterParams.minQty ?? 0,
      } : undefined;

      const resp = await supabase.functions.invoke('graph-data', { body });
      if (resp.error) throw new Error(resp.error.message);
      setGraphData(resp.data || { nodes: [], links: [] });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleApplyFilters = () => {
    fetchGraph(filters);
  };

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      {/* Graph Panel */}
      <div className="flex-1 relative" ref={graphContainerRef}>
        {/* Title bar */}
        <div className="absolute top-0 left-0 right-0 z-10 px-4 py-3 flex items-center gap-2 bg-gradient-to-b from-background via-background/80 to-transparent">
          <Network className="w-5 h-5 text-primary" />
          <h1 className="text-base font-bold text-foreground">Context Graph Explorer</h1>
          <span className="text-xs text-muted-foreground ml-2">
            {graphData.nodes.length} nodes · {graphData.links.length} edges
          </span>
        </div>

        {/* Filter Panel */}
        <FilterPanel filters={filters} onChange={setFilters} onApply={handleApplyFilters} />

        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading graph data...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-8">
              <p className="text-sm text-destructive mb-2">Failed to load graph</p>
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          </div>
        ) : (
          <GraphVisualization
            data={graphData}
            onNodeClick={setSelectedNode}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        {/* Analytics Panel */}
        <AnalyticsPanel />

        <NodeInfoPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      </div>

      {/* Chat Panel */}
      <div className="w-[380px] border-l border-border flex-shrink-0">
        <ChatInterface />
      </div>
    </div>
  );
};

export default Index;
