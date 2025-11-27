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
  updateInboundRequestStatus: (receiptId: number, data: UpdateInboundStatusRequest) => {
    return request.put({ url: `/Inbound/${receiptId}/status`, data })
  }
}

export default inboundApi
