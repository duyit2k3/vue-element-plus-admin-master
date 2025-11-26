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

const inboundApi = {
  createInboundRequest: (data: CreateInboundRequestRequest) => {
    return request.post<CreateInboundResponse>({ url: '/Inbound/create-request', data })
  }
}

export default inboundApi
