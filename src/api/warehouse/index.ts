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
  },

  // Rack management by zone
  getZoneRacks: (zoneId: number) => {
    return request.get({ url: `/Warehouse/zones/${zoneId}/racks` })
  },
  createRack: (zoneId: number, data: CreateRackRequest) => {
    return request.post({ url: `/Warehouse/zones/${zoneId}/racks`, data })
  },
  updateRack: (zoneId: number, rackId: number, data: UpdateRackRequest) => {
    return request.put({ url: `/Warehouse/zones/${zoneId}/racks/${rackId}`, data })
  },
  bulkUpdateRackPositions: (zoneId: number, data: BulkUpdateRackPositionsRequest) => {
    return request.put({ url: `/Warehouse/zones/${zoneId}/racks/positions`, data })
  },
  deleteRack: (zoneId: number, rackId: number) => {
    return request.delete({ url: `/Warehouse/zones/${zoneId}/racks/${rackId}` })
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

export interface RackDto {
  rackId: number
  zoneId: number
  rackName?: string | null
  positionX: number
  positionY: number
  positionZ: number
  length: number
  width: number
  height: number
  maxShelves?: number | null
}

export interface CreateRackRequest {
  rackName?: string | null
  positionX: number
  positionZ: number
  length: number
  width: number
  height: number
  maxShelves?: number | null
}

export interface UpdateRackRequest {
  rackName?: string | null
  positionX: number
  positionZ: number
  height?: number | null
}

export interface RackPositionUpdateItem {
  rackId: number
  positionX: number
  positionZ: number
}

export interface BulkUpdateRackPositionsRequest {
  racks: RackPositionUpdateItem[]
}

export interface PalletLocation {
  locationId: number
  palletId: number
  barcode: string | null
  locationCode?: string | null
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
  palletType?: string | null
  maxWeight?: number | null
  maxStackHeight?: number | null
  palletQrContent?: string | null
}

export interface ItemStackUnit {
  unitIndex: number
  localX: number
  localY: number
  localZ: number
  length: number
  width: number
  height: number
  rotationY: number
}

export interface ItemAllocation {
  allocationId: number
  itemId: number
  qrCode: string | null
  itemName: string | null
  itemType: string | null

  // Product information
  productId: number
  productCode: string | null
  productName: string | null
  unit: string | null
  category: string | null
  standardLength?: number | null
  standardWidth?: number | null
  standardHeight?: number | null
  standardWeight?: number | null
  productDescription?: string | null
  storageConditions?: string | null

  // Customer information
  customerId: number
  customerName: string | null

  // Pallet / position information
  palletId: number
  positionX: number | null
  positionY: number | null
  positionZ: number | null

  // Item dimensions and properties (khối hàng trên pallet)
  length: number
  width: number
  height: number
  weight: number | null
  shape: string | null
  priorityLevel: number | null
  isHeavy: boolean | null
  isFragile: boolean | null

  // Batch and date information
  batchNumber?: string | null
  manufacturingDate?: string | null
  expiryDate?: string | null

  // Commercial information
  unitPrice?: number | null
  totalAmount?: number | null
  unitQuantity?: number | null
  stackUnits?: ItemStackUnit[] | null
}

export interface WarehouseGate {
  gateId: number
  warehouseId: number
  gateName: string | null
  positionX: number
  positionY: number
  positionZ: number
  length?: number | null
  width?: number | null
  height?: number | null
  gateType: string
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
  checkinPositionX?: number | null
  checkinPositionY?: number | null
  checkinPositionZ?: number | null
  checkinLength?: number | null
  checkinWidth?: number | null
  checkinHeight?: number | null
  zones: WarehouseZone[]
  racks: Rack[]
  pallets: PalletLocation[]
  items: ItemAllocation[]
  gates?: WarehouseGate[]
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
  zoneId?: number | null
  zoneName?: string | null
  zoneType?: string | null
}
