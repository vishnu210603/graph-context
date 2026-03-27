export interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  color?: string;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface FilterState {
  orderId: string;
  plantId: string;
  materialId: string;
  currency: string;
  nodeType: string;
  minQty: number;
  minRevenue: number;
  maxRevenue: number;
}

export interface LookupData {
  orders: string[];
  plants: string[];
  materials: string[];
  currencies: string[];
  nodeTypes: string[];
}

export const DEFAULT_FILTERS: FilterState = {
  orderId: '',
  plantId: '',
  materialId: '',
  currency: '',
  nodeType: '',
  minQty: 0,
  minRevenue: 0,
  maxRevenue: 50000,
};

export const NODE_COLORS: Record<string, string> = {
  SalesOrder: '#22c55e',
  SalesOrderItem: '#34d399',
  DeliveryDocument: '#38bdf8',
  BillingDocument: '#f59e0b',
  BillingDocumentItem: '#fbbf24',
  JournalEntry: '#a78bfa',
  JournalEntryItem: '#c4b5fd',
  Customer: '#f472b6',
  BusinessPartner: '#ec4899',
  Material: '#4ade80',
  Plant: '#fb923c',
  default: '#94a3b8',
};

export function getNodeColor(type: string): string {
  return NODE_COLORS[type] || NODE_COLORS.default;
}

export function getNodeSize(type: string): number {
  const sizes: Record<string, number> = {
    SalesOrder: 7,
    BillingDocument: 6,
    DeliveryDocument: 6,
    JournalEntry: 5,
    Material: 5,
    Plant: 6,
    Customer: 6,
    BusinessPartner: 6,
  };
  return sizes[type] || 5;
}
