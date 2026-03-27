import { useCallback, useRef, useState, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { getNodeColor, getNodeSize } from '@/types/graph';
import type { GraphData, GraphNode } from '@/types/graph';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface GraphVisualizationProps {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  selectedNodeId?: string;
  width: number;
  height: number;
}

const GraphVisualization = ({ data, onNodeClick, selectedNodeId, width, height }: GraphVisualizationProps) => {
  const fgRef = useRef<any>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const handleZoomIn = () => fgRef.current?.zoom(fgRef.current.zoom() * 1.5, 300);
  const handleZoomOut = () => fgRef.current?.zoom(fgRef.current.zoom() / 1.5, 300);
  const handleFit = () => fgRef.current?.zoomToFit(400, 40);

  useEffect(() => {
    if (fgRef.current && data.nodes.length > 0) {
      setTimeout(() => fgRef.current?.zoomToFit(400, 40), 500);
    }
  }, [data]);

  const handleNodeClick = useCallback((node: any) => {
    onNodeClick(node as GraphNode);
    fgRef.current?.centerAt(node.x, node.y, 500);
    fgRef.current?.zoom(2.5, 500);
  }, [onNodeClick]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = getNodeSize(node.type);
    const color = getNodeColor(node.type);
    const isHovered = hoveredNode === node.id;
    const isSelected = selectedNodeId === node.id;

    if (isHovered || isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, size + 4, 0, 2 * Math.PI);
      ctx.fillStyle = color + '44';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = isHovered || isSelected ? '#ffffff' : color + '88';
    ctx.lineWidth = isHovered || isSelected ? 2 : 1;
    ctx.stroke();

    if (globalScale > 0.8 || isHovered) {
      const label = node.label || node.type || '';
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${fontSize}px 'Space Grotesk', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#e2e8f0';
      const displayLabel = label.length > 16 ? label.slice(0, 14) + '…' : label;
      ctx.fillText(displayLabel, node.x, node.y + size + 2);
    }
  }, [hoveredNode, selectedNodeId]);

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.strokeStyle = 'hsl(220, 14%, 22%)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }, []);

  const legendTypes = ['SalesOrder', 'SalesOrderItem', 'DeliveryDocument', 'BillingDocument', 'JournalEntry', 'Material', 'Plant', 'BusinessPartner'];

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <Button size="icon" variant="secondary" onClick={handleZoomIn} className="h-8 w-8">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="secondary" onClick={handleZoomOut} className="h-8 w-8">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="secondary" onClick={handleFit} className="h-8 w-8">
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={width}
        height={height}
        nodeCanvasObject={paintNode}
        linkCanvasObject={paintLink}
        onNodeClick={handleNodeClick}
        onNodeHover={(node: any) => setHoveredNode(node?.id || null)}
        nodeRelSize={6}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={1}
        d3AlphaDecay={0.04}
        d3VelocityDecay={0.3}
        cooldownTicks={100}
        backgroundColor="transparent"
      />

      <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 bg-card/80 backdrop-blur-sm rounded-lg p-2 border border-border">
        {legendTypes.map(type => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getNodeColor(type) }} />
            <span className="text-[10px] text-muted-foreground">{type.replace(/([A-Z])/g, ' $1').trim()}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GraphVisualization;
