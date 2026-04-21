/**
 * Code Guide:
 * Shared TypeScript type definitions.
 * These types describe the app's common data contracts so pages, components, and APIs agree on payload shape.
 */

// SKU Types
export interface SKU {
  id: string
  skuCode: string
  name: string
  description?: string | null
  category?: string | null
  currentStock: number
  inventory?: {
    onHand: number
    reserved: number
    allocated: number
    backorder: number
    inbound: number
    available: number
  }
  reorderPoint?: number | null
  isCustomVariant: boolean
  parentSKUId?: string | null
  imageUrl?: string | null
  tags: string[]
  unitCost?: number | null
  retailPrice?: number | null
  shopifyProductId?: string | null
  amazonASIN?: string | null
  walmartItemId?: string | null
  ebayItemId?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface SKUWithRelations extends SKU {
  parentSKU?: SKU | null
  customVariants?: SKU[]
  salesRecords?: SalesRecord[]
}

// Sales Types
export interface SalesRecord {
  id: string
  skuId: string
  platform: 'shopify' | 'walmart' | 'ebay' | 'manual'
  orderId: string
  orderType: 'actual_sale' | 'pre_order'
  saleDate: Date
  quantity: number
  unitPrice: number
  totalAmount: number
  fulfilled: boolean
  fulfilledDate?: Date | null
  createdAt: Date
}

// Collection Types
export interface SKUCollection {
  id: string
  name: string
  description?: string | null
  colorCode?: string | null
  isPinned: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface SKUCollectionWithMembers extends SKUCollection {
  members: {
    id: string
    skuId: string
    sortOrder: number
    addedAt: Date
    sku: SKU
  }[]
}

// Purchase Order Types
export interface PurchaseOrder {
  id: string
  poNumber: string
  supplier?: string | null
  orderDate: Date
  expectedDeliveryDate?: Date | null
  actualDeliveryDate?: Date | null
  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled'
  totalAmount?: number | null
  notes?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface POItem {
  id: string
  poId: string
  skuId: string
  quantity: number
  unitCost?: number | null
  totalCost?: number | null
}

// Container Types
export interface Container {
  id: string
  containerNumber: string
  poId?: string | null
  bookingDate?: Date | null
  departureDate?: Date | null
  estimatedArrivalDate?: Date | null
  actualArrivalDate?: Date | null
  estimatedReleaseDate?: Date | null
  actualReleaseDate?: Date | null
  carrier?: string | null
  vesselName?: string | null
  portOfLoading?: string | null
  portOfDischarge?: string | null
  status: 'booked' | 'in_transit' | 'arrived' | 'released'
  trackingUrl?: string | null
  createdAt: Date
  updatedAt: Date
}

// Trend Data Types
export interface TrendData {
  id: string
  skuId: string
  researchDate: Date
  validUntil: Date
  googleTrendsChange?: number | null
  googleTrendsConfidence?: number | null
  competitorStockChange?: number | null
  competitorPriceChange?: number | null
  competitorConfidence?: number | null
  amazonBSRChange?: number | null
  amazonReviewVelocity?: number | null
  amazonConfidence?: number | null
  socialMentionsChange?: number | null
  socialConfidence?: number | null
  aiTrendDirection?: 'up' | 'down' | 'stable' | null
  aiConfidence?: number | null
  aiSuggestedAdjustment?: number | null
  aiReasoning?: string | null
  combinedSignal?: number | null
  combinedConfidence?: number | null
  createdAt: Date
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// Dashboard Stats Types
export interface DashboardStats {
  totalSKUs: number
  activeSKUs: number
  lowStockSKUs: number
  outOfStockSKUs: number
  totalSalesLast30Days: number
  totalRevenueLast30Days: number
  activeIntegrations: number
  pendingOrders: number
}
