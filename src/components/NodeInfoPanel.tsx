import { GraphNode, getNodeColor } from '@/lib/graphData';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

interface NodeInfoPanelProps {
  node: GraphNode | null;
  onClose: () => void;
}

const NodeInfoPanel = ({ node, onClose }: NodeInfoPanelProps) => {
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          initial={{ x: 300, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 300, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute top-0 right-0 w-80 h-full bg-card border-l border-border z-20 overflow-y-auto"
        >
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
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

            <h3 className="text-lg font-semibold mb-4 text-foreground">{node.label}</h3>

            <div className="space-y-2">
              {Object.entries(node.properties).map(([key, value]) => (
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NodeInfoPanel;
