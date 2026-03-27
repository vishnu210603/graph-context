import { getNodeColor } from '@/types/graph';
import type { GraphNode } from '@/types/graph';
import { X, Expand } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { ScrollArea } from '@/components/ui/scroll-area';

interface NodeInfoPanelProps {
  node: GraphNode | null;
  onClose: () => void;
  onExpand?: (nodeId: string) => void;
}

const NodeInfoPanel = ({ node, onClose, onExpand }: NodeInfoPanelProps) => {
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          initial={{ x: 300, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 300, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute top-0 right-0 w-80 h-full bg-card border-l border-border z-20 flex flex-col"
        >
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getNodeColor(node.type) }}
              />
              <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                {node.type}
              </span>
            </div>
            <Button size="icon" variant="ghost" onClick={onClose} className="h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1 p-4">
            <h3 className="text-lg font-semibold mb-4 text-foreground">{node.label}</h3>
            <p className="text-[10px] text-muted-foreground mb-3 font-mono">ID: {node.id}</p>

            <div className="space-y-2">
              {Object.entries(node.properties || {}).map(([key, value]) => (
                <div key={key} className="bg-secondary/50 rounded-md p-2.5">
                  <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-0.5">
                    {key}
                  </div>
                  <div className="text-sm text-foreground break-all">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {onExpand && (
            <div className="p-3 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => onExpand(node.id)}
              >
                <Expand className="h-3 w-3 mr-2" />
                Expand Connections
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NodeInfoPanel;
