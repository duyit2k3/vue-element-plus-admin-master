import request from '@/axios'

export interface InboundItemRequest {
  palletId: number
  productId: number
  quantity: number
  manufacturingDate: string
  expiryDate?: string | null
  unitPrice: number
  totalAmount: number
  batchNumber?: string
  length?: number
  width?: number
  height?: number
}

export interface CreateInboundRequestRequest {
  warehouseId: number
  items: InboundItemRequest[]
  notes?: string
}

export interface CreateInboundResponse {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  customerId: number
  totalItems: number
  totalPallets: number
  status: string
  inboundDate: string
}

export interface InboundRequestListItem {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  warehouseName?: string | null
  customerId: number
  customerName?: string | null
  totalItems: number
  totalPallets: number
  inboundDate?: string | null
  status?: string | null
  notes?: string | null
  createdByName?: string | null
}

export interface InboundItemDetail {
  inboundItemId: number
  itemId: number
  qrCode: string
  itemName: string
  palletId: number
  palletBarcode: string
  productId: number
  productName: string
  productCode: string
  quantity: number
  manufacturingDate?: string | null
  expiryDate?: string | null
  batchNumber?: string | null
  unitPrice?: number | null
  totalAmount?: number | null
}

export interface InboundRequestDetail {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  warehouseName?: string | null
  customerId: number
  customerName?: string | null
  totalItems: number
  totalPallets: number
  inboundDate?: string | null
  status?: string | null
  notes?: string | null
  createdByName?: string | null
  items: InboundItemDetail[]
}

export interface InboundApprovalItem {
  inboundItemId: number
  itemId: number
  palletId: number
  palletBarcode: string
  productId: number
  productCode: string
  productName: string
  unit: string
  category?: string | null
  quantity: number
  unitLength?: number | null
  unitWidth?: number | null
  unitHeight?: number | null
  itemLength: number
  itemWidth: number
  itemHeight: number
  palletLength: number
  palletWidth: number
  palletHeight: number
  isBag: boolean
}

export interface InboundApprovalView {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  warehouseName?: string | null
  customerId: number
  customerName?: string | null
  status?: string | null
  notes?: string | null
  items: InboundApprovalItem[]
}

export interface PreferredPalletLayout {
  palletId: number
  priority?: number
  zoneId?: number
  shelfId?: number | null
  positionX?: number
  positionZ?: number
}

export interface ApproveInboundLayoutRequest {
  preferredLayouts?: PreferredPalletLayout[]
  forceUsePreferredLayout?: boolean
}

export interface InboundOptimizeLayoutItem {
  palletId: number
  zoneId: number
  shelfId?: number | null
  positionX: number
  positionY: number
  positionZ: number
  stackLevel: number
  stackedOnPalletId?: number | null
  isGround: boolean
}

export interface InboundOptimizeLayoutView {
  receiptId: number
  warehouseId: number
  customerId: number
  layouts: InboundOptimizeLayoutItem[]
}

export interface UpdateInboundStatusRequest {
  status: 'pending' | 'completed' | 'cancelled'
  notes?: string
}

const inboundApi = {
  createInboundRequest: (data: CreateInboundRequestRequest) => {
    return request.post<CreateInboundResponse>({ url: '/Inbound/create-request', data })
  },
  getInboundRequests: (params?: { warehouseId?: number; status?: string }) => {
    return request.get<InboundRequestListItem[]>({ url: '/Inbound/list', params })
  },
  getInboundRequestDetail: (receiptId: number) => {
    return request.get<InboundRequestDetail>({ url: `/Inbound/${receiptId}` })
  },
  getInboundApprovalView: (receiptId: number) => {
    return request.get<InboundApprovalView>({ url: `/Inbound/${receiptId}/approval-view` })
  },
  updateInboundRequestStatus: (receiptId: number, data: UpdateInboundStatusRequest) => {
    return request.put({ url: `/Inbound/${receiptId}/status`, data })
  },
  approveInboundRequest: (receiptId: number, data?: ApproveInboundLayoutRequest) => {
    return request.post({ url: `/Inbound/${receiptId}/approve`, data })
  },
  optimizeInboundLayout: (receiptId: number, data?: ApproveInboundLayoutRequest) => {
    return request.post<InboundOptimizeLayoutView>({
      url: `/Inbound/${receiptId}/optimize-layout`,
      data
    })
  }
}

export default inboundApi
