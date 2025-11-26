import request from '@/axios'

export interface PalletTemplate {
  templateId: number
  templateName: string
  palletType?: string
  length: number
  width: number
  height: number
  maxWeight: number
  maxStackHeight: number
  description?: string
  isActive: boolean
}

export interface CreatePalletRequest {
  barcode: string
  length: number
  width: number
  height?: number
  maxWeight?: number
  maxStackHeight?: number
  palletType?: string
}

export interface CreatePalletFromTemplateRequest {
  barcode: string
  palletType?: string
}

export interface PalletViewModel {
  palletId: number
  barcode: string
  length: number
  width: number
  height: number
  maxWeight: number
  maxStackHeight: number
  status: string
  palletType?: string
  createdAt: string
}

const palletApi = {
  getTemplates: () => {
    return request.get<PalletTemplate[]>({ url: '/Pallet/templates' })
  },
  createPallet: (data: CreatePalletRequest) => {
    return request.post<PalletViewModel>({ url: '/Pallet/create', data })
  },
  createPalletFromTemplate: (templateId: number, data: CreatePalletFromTemplateRequest) => {
    return request.post<PalletViewModel>({ url: `/Pallet/create-from-template/${templateId}`, data })
  }
}

export default palletApi
