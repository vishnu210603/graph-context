import { useState, useEffect, useRef, useCallback } from 'react';
import GraphVisualization from '@/components/GraphVisualization';
import NodeInfoPanel from '@/components/NodeInfoPanel';
import ChatInterface from '@/components/ChatInterface';
import FilterPanel from '@/components/FilterPanel';
import AnalyticsPanel from '@/components/AnalyticsPanel';
import { fetchInitialGraph, fetchFilteredGraph, fetchLookupData, expandNode } from '@/lib/graphApi';
import type { GraphNode, GraphData, FilterState, LookupData } from '@/types/graph';
import { DEFAULT_FILTERS } from '@/types/graph';
import { Loader2, Network } from 'lucide-react';

const EMPTY_LOOKUP: LookupData = { orders: [], plants: [], materials: [], currencies: [], nodeTypes: [] };

const Index = () => {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [lookupData, setLookupData] = useState<LookupData>(EMPTY_LOOKUP);
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

  // Load initial graph + lookup data
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const [graph, lookup] = await Promise.all([
          fetchInitialGraph(),
          fetchLookupData(),
        ]);
        setGraphData(graph);
        setLookupData(lookup);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleApplyFilters = async () => {
    setLoading(true);
    setError(null);
    try {
      const hasAnyFilter = filters.orderId || filters.plantId || filters.materialId ||
        filters.currency || filters.nodeType || filters.minRevenue > 0 ||
        filters.maxRevenue < 50000 || filters.minQty > 0;

      const graph = hasAnyFilter
        ? await fetchFilteredGraph(filters)
        : await fetchInitialGraph();
      setGraphData(graph);
      setSelectedNode(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExpand = async (nodeId: string) => {
    try {
      const expanded = await expandNode(nodeId);
      // Merge expanded nodes/links into existing graph
      setGraphData(prev => {
        const existingNodeIds = new Set(prev.nodes.map(n => n.id));
        const existingLinkKeys = new Set(prev.links.map(l => `${l.source}-${l.target}`));
        const newNodes = expanded.nodes.filter(n => !existingNodeIds.has(n.id));
        const newLinks = expanded.links.filter(l => !existingLinkKeys.has(`${l.source}-${l.target}`));
        return {
          nodes: [...prev.nodes, ...newNodes],
          links: [...prev.links, ...newLinks],
        };
      });
    } catch (err: any) {
      console.error('Expand error:', err);
    }
  };

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <div className="flex-1 relative" ref={graphContainerRef}>
        <div className="absolute top-0 left-0 right-0 z-10 px-4 py-3 flex items-center gap-2 bg-gradient-to-b from-background via-background/80 to-transparent">
          <Network className="w-5 h-5 text-primary" />
          <h1 className="text-base font-bold text-foreground">Context Graph Explorer</h1>
          <span className="text-xs text-muted-foreground ml-2">
            {graphData.nodes.length} nodes · {graphData.links.length} edges
          </span>
        </div>

        <FilterPanel
          filters={filters}
          lookupData={lookupData}
          onChange={setFilters}
          onApply={handleApplyFilters}
          isLoading={loading}
        />

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
            selectedNodeId={selectedNode?.id}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        <AnalyticsPanel />

        <NodeInfoPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExpand={handleExpand}
        />
      </div>

      <div className="w-[380px] border-l border-border flex-shrink-0">
        <ChatInterface />
      </div>
    </div>
  );
};

export default Index;
