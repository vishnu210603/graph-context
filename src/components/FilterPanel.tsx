import { useState, useEffect } from 'react';
import { Filter, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';

export interface GraphFilters {
  orderId: string | null;
  plantId: string | null;
  materialId: string | null;
  currency: string | null;
  nodeType: string | null;
  minRevenue: number;
  maxRevenue: number;
  minQty: number;
}

export const DEFAULT_FILTERS: GraphFilters = {
  orderId: null,
  plantId: null,
  materialId: null,
  currency: null,
  nodeType: null,
  minRevenue: 0,
  maxRevenue: 50000,
  minQty: 0,
};

interface FilterPanelProps {
  filters: GraphFilters;
  onChange: (filters: GraphFilters) => void;
  onApply: () => void;
}

const FilterPanel = ({ filters, onChange, onApply }: FilterPanelProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [plants, setPlants] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [sampleOrders, setSampleOrders] = useState<string[]>([]);
  const [sampleMaterials, setSampleMaterials] = useState<string[]>([]);
  const [nodeTypes, setNodeTypes] = useState<string[]>([]);

  useEffect(() => {
    const fetchDropdowns = async () => {
      try {
        const resp = await supabase.functions.invoke('graph-filters');
        if (resp.data) {
          setPlants(resp.data.plants || []);
          setCurrencies(resp.data.currencies || []);
          setSampleOrders(resp.data.orders || []);
          setSampleMaterials(resp.data.materials || []);
        }
      } catch (e) {
        console.error('Failed to load filter options:', e);
      }
    };
    fetchDropdowns();
  }, []);

  const update = (partial: Partial<GraphFilters>) => {
    onChange({ ...filters, ...partial });
  };

  const reset = () => {
    onChange({ ...DEFAULT_FILTERS });
    onApply();
  };

  return (
    <div className="absolute top-14 left-3 z-10 w-56">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary transition-colors w-full"
      >
        <Filter className="w-3.5 h-3.5 text-primary" />
        <span>Filters</span>
        {collapsed ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronUp className="w-3 h-3 ml-auto" />}
      </button>

      {!collapsed && (
        <div className="mt-1 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-3 space-y-3 max-h-[calc(100vh-120px)] overflow-y-auto">
          {/* Order */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Order</label>
            <select
              value={filters.orderId || ''}
              onChange={e => update({ orderId: e.target.value || null })}
              className="w-full mt-1 bg-secondary text-foreground text-xs rounded-md px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Orders</option>
              {sampleOrders.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          {/* Plant */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Plant</label>
            <select
              value={filters.plantId || ''}
              onChange={e => update({ plantId: e.target.value || null })}
              className="w-full mt-1 bg-secondary text-foreground text-xs rounded-md px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Plants</option>
              {plants.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          {/* Material */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Material</label>
            <select
              value={filters.materialId || ''}
              onChange={e => update({ materialId: e.target.value || null })}
              className="w-full mt-1 bg-secondary text-foreground text-xs rounded-md px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Materials</option>
              {sampleMaterials.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Currency */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Currency</label>
            <select
              value={filters.currency || ''}
              onChange={e => update({ currency: e.target.value || null })}
              className="w-full mt-1 bg-secondary text-foreground text-xs rounded-md px-2 py-1.5 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Currencies</option>
              {currencies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Revenue Range */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Revenue: {filters.minRevenue.toLocaleString()} – {filters.maxRevenue.toLocaleString()}
            </label>
            <div className="mt-2 px-1">
              <Slider
                min={0}
                max={50000}
                step={500}
                value={[filters.minRevenue, filters.maxRevenue]}
                onValueChange={([min, max]) => update({ minRevenue: min, maxRevenue: max })}
              />
            </div>
          </div>

          {/* Min Quantity */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Min Quantity: {filters.minQty}
            </label>
            <div className="mt-2 px-1">
              <Slider
                min={0}
                max={1000}
                step={10}
                value={[filters.minQty]}
                onValueChange={([val]) => update({ minQty: val })}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={onApply} className="flex-1 h-7 text-xs">
              Apply
            </Button>
            <Button size="sm" variant="outline" onClick={reset} className="h-7 text-xs">
              <RotateCcw className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilterPanel;
