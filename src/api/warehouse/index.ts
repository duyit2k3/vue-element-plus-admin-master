import request from '@/axios'

// API endpoints
const warehouseApi = {
  getWarehouse3DData: (warehouseId: number) => {
    return request.get({ url: `/Warehouse/${warehouseId}/3d-data` })
  },
  getAllWarehouses: () => {
    return request.get({ url: '/Warehouse/all' })
  },
  getWarehousesByOwner: (ownerId: number) => {
    return request.get({ url: `/Warehouse/owner/${ownerId}` })
  },
  getWarehousesByCustomer: (customerId: number) => {
    return request.get({ url: `/Warehouse/customer/${customerId}` })
  }
}

export default warehouseApi

// Types
export interface WarehouseZone {
  zoneId: number
  zoneName: string | null
  customerId: number | null
  customerName: string | null
  positionX: number
  positionY: number
  positionZ: number
  length: number
  width: number
  height: number
  zoneType: string
}

export interface Shelf {
  shelfId: number
  rackId: number
  shelfLevel: number
  positionY: number
  length: number
  width: number
  maxWeight: number | null
}

export interface Rack {
  rackId: number
  zoneId: number
  rackName: string | null
  positionX: number
  positionY: number
  positionZ: number
  length: number
  width: number
  height: number
  maxShelves: number | null
  shelves: Shelf[]
}

export interface PalletLocation {
  locationId: number
  palletId: number
  barcode: string | null
  zoneId: number
  shelfId: number | null
  positionX: number
  positionY: number
  positionZ: number
  isGround: boolean | null
  stackLevel: number | null
  stackedOnPallet: number | null
  palletLength: number
  palletWidth: number
  palletHeight: number
}

export interface ItemAllocation {
  allocationId: number
  itemId: number
  qrCode: string | null
  itemName: string | null
  itemType: string | null
  customerId: number
  customerName: string | null
  palletId: number
  positionX: number | null
  positionY: number | null
  positionZ: number | null
  length: number
  width: number
  height: number
  weight: number | null
  shape: string | null
  priorityLevel: number | null
  isHeavy: boolean | null
  isFragile: boolean | null
}

export interface Warehouse3DData {
  warehouseId: number
  warehouseName: string | null
  ownerId: number
  ownerName: string | null
  length: number
  width: number
  height: number
  warehouseType: string | null
  allowedItemTypes: string | null
  status: string | null
  zones: WarehouseZone[]
  racks: Rack[]
  pallets: PalletLocation[]
  items: ItemAllocation[]
}

export interface WarehouseListItem {
  warehouseId: number
  warehouseName: string | null
  ownerId: number
  ownerName: string | null
  length: number
  width: number
  height: number
  warehouseType: string | null
  status: string | null
  createdAt: string | null
}
