import request from '@/axios'

export interface OutboundAvailablePallet {
  palletId: number
  barcode?: string | null

  warehouseId: number
  zoneId: number
  zoneName?: string | null
  shelfId?: number | null
  isGround: boolean
  positionX: number
  positionY: number
  positionZ: number

  itemId: number
  itemName?: string | null
  productCode?: string | null
  productName?: string | null
  unit?: string | null

  firstInboundDate?: string | null
  manufacturingDate?: string | null
  expiryDate?: string | null
  totalQuantity: number
}

export interface OutboundItemRequest {
  itemId: number
  quantity: number
}

export interface CreateOutboundRequestRequest {
  warehouseId: number
  customerId?: number
  items: OutboundItemRequest[]
  notes?: string
}

export interface CreateOutboundResponse {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  customerId: number
  totalItems: number
  status: string
  outboundDate?: string | null
}

export interface OutboundRequestListItem {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  warehouseName?: string | null
  customerId: number
  customerName?: string | null
  totalItems: number
  createdAt?: string | null
  outboundDate?: string | null
  status?: string | null
  notes?: string | null
  createdByName?: string | null
}

export interface OutboundPickingProgressItem {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  warehouseName?: string | null
  customerId: number
  customerName?: string | null
  totalItems: number
  createdAt?: string | null
  outboundDate?: string | null
  status?: string | null
  notes?: string | null
  createdByName?: string | null
  totalPallets: number
  pickedPallets: number
}

export interface OutboundItemDetail {
  outboundItemId: number
  itemId: number
  qrCode: string
  itemName: string
  productId: number
  productName: string
  productCode: string
  quantity: number
  manufacturingDate?: string | null
  expiryDate?: string | null
  batchNumber?: string | null
  unit?: string | null
}

export interface OutboundRequestDetail {
  receiptId: number
  receiptNumber: string
  warehouseId: number
  warehouseName?: string | null
  customerId: number
  customerName?: string | null
  totalItems: number
  createdAt?: string | null
  outboundDate?: string | null
  status?: string | null
  notes?: string | null
  createdByName?: string | null
  items: OutboundItemDetail[]
}

export interface UpdateOutboundStatusRequest {
  status: 'pending' | 'completed' | 'cancelled'
  notes?: string
}

export interface OutboundPalletPickViewModel {
  palletId: number
  pickedAt?: string | null
  pickedBy: number
  pickedByName: string
}

export interface OutboundPalletPickRequest {
  palletId: number
  notes?: string
}

const outboundApi = {
  getAvailablePallets: (params: { warehouseId: number; customerId?: number }) => {
    return request.get<OutboundAvailablePallet[]>({
      url: '/Outbound/available-pallets',
      params
    })
  },
  createOutboundRequest: (data: CreateOutboundRequestRequest) => {
    return request.post<CreateOutboundResponse>({ url: '/Outbound/create-request', data })
  },
  getOutboundRequests: (params?: { warehouseId?: number }) => {
    return request.get<OutboundRequestListItem[]>({ url: '/Outbound/list', params })
  },
  getOutboundPickingRequests: (params?: { warehouseId?: number }) => {
    return request.get<OutboundPickingProgressItem[]>({
      url: '/Outbound/picking-requests',
      params
    })
  },
  getOutboundRequestDetail: (receiptId: number) => {
    return request.get<OutboundRequestDetail>({ url: `/Outbound/${receiptId}` })
  },
  updateOutboundRequestStatus: (receiptId: number, data: UpdateOutboundStatusRequest) => {
    return request.put({ url: `/Outbound/${receiptId}/status`, data })
  },
  getOutboundPalletPicks: (receiptId: number) => {
    return request.get<OutboundPalletPickViewModel[]>({
      url: `/Outbound/${receiptId}/pallet-picks`
    })
  },
  markPalletPicked: (receiptId: number, data: OutboundPalletPickRequest) => {
    return request.post({ url: `/Outbound/${receiptId}/pallet-picks`, data })
  },
  exportOutboundReceiptPdf: (receiptId: number) => {
    // Trả về AxiosResponse<Blob> do interceptor sẽ bypass unwrap với responseType = 'blob'
    return request.get<any>({
      url: `/Outbound/${receiptId}/export-pdf`,
      responseType: 'blob'
    })
  }
}

export default outboundApi
