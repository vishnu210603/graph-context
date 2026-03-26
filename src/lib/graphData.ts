// Types for graph data
export interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, any>;
  color?: string;
  val?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const NODE_COLORS: Record<string, string> = {
  SalesOrder: '#22c55e',
  PurchaseOrder: '#22c55e',
  Order: '#22c55e',
  Delivery: '#3b82f6',
  Invoice: '#f59e0b',
  BillingDocument: '#f59e0b',
  Payment: '#a855f7',
  JournalEntry: '#a855f7',
  Customer: '#ec4899',
  Product: '#16a34a',
  Material: '#16a34a',
  Plant: '#64748b',
  Address: '#eab308',
};

export function getNodeColor(type: string): string {
  return NODE_COLORS[type] || '#64748b';
}

export function getNodeSize(type: string): number {
  const sizes: Record<string, number> = {
    SalesOrder: 8,
    PurchaseOrder: 8,
    Customer: 10,
    Delivery: 6,
    BillingDocument: 6,
    Invoice: 6,
    Payment: 5,
    JournalEntry: 5,
    Material: 4,
    Product: 4,
    Plant: 4,
    Address: 3,
  };
  return sizes[type] || 5;
}
