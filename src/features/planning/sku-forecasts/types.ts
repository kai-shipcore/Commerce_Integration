export interface SelectedSkuSummary {
  masterSku: string;
  productName: string;
  category: string;
  onHand: number;
  dailyAverage: number;
  daysOfSupply: number;
  projectedStockoutDate: string | null;
  preorderQty: number;
}
