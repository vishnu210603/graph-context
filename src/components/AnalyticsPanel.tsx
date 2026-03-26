import { useState, useEffect } from 'react';
import { BarChart3, Package, ShoppingCart, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface LeaderboardItem {
  orderId: string;
  revenue: number;
}

interface TopMaterial {
  materialId: string;
  usage: number;
}

interface OrderByItems {
  orderId: string;
  totalItems: number;
}

const AnalyticsPanel = () => {
  const [collapsed, setCollapsed] = useState(true);
  const [revenueLeaders, setRevenueLeaders] = useState<LeaderboardItem[]>([]);
  const [topMaterials, setTopMaterials] = useState<TopMaterial[]>([]);
  const [topOrders, setTopOrders] = useState<OrderByItems[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = async () => {
    if (revenueLeaders.length > 0) return; // already loaded
    setLoading(true);
    try {
      const resp = await supabase.functions.invoke('graph-analytics');
      if (resp.data) {
        setRevenueLeaders(resp.data.revenueLeaders || []);
        setTopMaterials(resp.data.topMaterials || []);
        setTopOrders(resp.data.topOrders || []);
      }
    } catch (e) {
      console.error('Analytics fetch failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (!next) fetchAnalytics();
  };

  return (
    <div className="absolute bottom-14 left-3 z-10 w-64">
      <button
        onClick={toggle}
        className="flex items-center gap-2 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary transition-colors w-full"
      >
        <BarChart3 className="w-3.5 h-3.5 text-primary" />
        <span>Analytics</span>
        {collapsed ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>

      {!collapsed && (
        <div className="mb-1 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 space-y-3 max-h-80 overflow-y-auto" style={{ position: 'absolute', bottom: '100%', left: 0, width: '100%', marginBottom: '4px' }}>
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-4">Loading analytics...</p>
          ) : (
            <>
              {/* Revenue Leaderboard */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <ShoppingCart className="w-3 h-3 text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Top Revenue Orders</span>
                </div>
                {revenueLeaders.map((item, i) => (
                  <div key={item.orderId} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-foreground truncate flex-1">
                      <span className="text-muted-foreground mr-1">#{i + 1}</span>
                      {item.orderId}
                    </span>
                    <span className="text-primary font-mono ml-2">{item.revenue.toLocaleString()}</span>
                  </div>
                ))}
                {revenueLeaders.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
              </div>

              {/* Top Materials */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Package className="w-3 h-3 text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Most Used Materials</span>
                </div>
                {topMaterials.map((item, i) => (
                  <div key={item.materialId} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-foreground truncate flex-1">
                      <span className="text-muted-foreground mr-1">#{i + 1}</span>
                      {item.materialId}
                    </span>
                    <span className="text-accent font-mono ml-2">{item.usage}×</span>
                  </div>
                ))}
                {topMaterials.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
              </div>

              {/* Orders by Items */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <BarChart3 className="w-3 h-3 text-primary" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Orders by Item Count</span>
                </div>
                {topOrders.map((item, i) => (
                  <div key={item.orderId} className="flex items-center justify-between py-1 text-xs">
                    <span className="text-foreground truncate flex-1">
                      <span className="text-muted-foreground mr-1">#{i + 1}</span>
                      {item.orderId}
                    </span>
                    <span className="text-muted-foreground font-mono ml-2">{item.totalItems} items</span>
                  </div>
                ))}
                {topOrders.length === 0 && <p className="text-xs text-muted-foreground">No data</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalyticsPanel;
