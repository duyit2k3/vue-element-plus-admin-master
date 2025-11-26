import request from '@/axios'

export interface ProductViewModel {
  productId: number
  productCode: string
  productName: string
  description?: string
  unit: string
  category?: string
  standardLength?: number
  standardWidth?: number
  standardHeight?: number
  standardWeight?: number
  isFragile?: boolean
  isHazardous?: boolean
  storageConditions?: string
  createUser?: number
  status?: string
}

export interface CreateProductRequest {
  productCode: string
  productName: string
  description?: string
  unit: string
  category?: string
  standardLength?: number
  standardWidth?: number
  standardHeight?: number
  standardWeight?: number
  isFragile?: boolean
  isHazardous?: boolean
  storageConditions?: string
}

const productApi = {
  getAvailableProducts: () => {
    return request.get<ProductViewModel[]>({ url: '/Product/available' })
  },
  createProduct: (data: CreateProductRequest) => {
    return request.post<ProductViewModel>({ url: '/Product/create', data })
  }
}

export default productApi
