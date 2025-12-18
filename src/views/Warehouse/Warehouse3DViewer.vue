<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import {
  ElCard,
  ElButton,
  ElRadioGroup,
  ElRadioButton,
  ElSelect,
  ElOption,
  ElDivider,
  ElMessage,
  ElMessageBox,
  ElDialog
} from 'element-plus'
import { Icon } from '@/components/Icon'
import { Qrcode } from '@/components/Qrcode'
import { useRouter, useRoute } from 'vue-router'
import warehouseApi, {
  type Warehouse3DData,
  type ItemAllocation,
  type WarehouseListItem
} from '@/api/warehouse'
import inboundApi, {
  type InboundOptimizeLayoutView,
  type PreferredPalletLayout,
  type InboundApprovalView,
  type InboundApprovalItem,
  type ManualStackUnitRequest
} from '@/api/inbound'
import outboundApi, {
  type OutboundRequestDetail,
  type OutboundPalletPickViewModel,
  type OutboundPickingProgressItem
} from '@/api/outbound'
import { findPathToPallet, type PathPoint } from '@/utils/pathfinding'
import { useUserStore } from '@/store/modules/user'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

const { push } = useRouter()
const route = useRoute()
const loading = ref(true)
const warehouseData = ref<Warehouse3DData | null>(null)
const container = ref<HTMLDivElement>()
const userStore = useUserStore()
const warehousesFor3D = ref<WarehouseListItem[]>([])
const selectedWarehouseIdFor3D = ref<number | undefined>(undefined)
const loadingWarehousesFor3D = ref(false)

// Inbound approval (preview) mode
// Bật khi:
// - Route mới: WarehouseInbound3DApproval (/warehouse/:id/inbound-3d-approval/:receiptId/:zoneId)
// - Hoặc route cũ dùng query mode=inbound-approval
const inboundMode = computed(() => {
  if (route.name === 'WarehouseInbound3DApproval') return true
  return route.query.mode === 'inbound-approval'
})

// receiptId inbound ưu tiên lấy từ params, fallback query
const inboundReceiptId = computed(() => {
  const fromParams = route.params.receiptId
  if (fromParams != null) {
    const n = Array.isArray(fromParams) ? Number(fromParams[0]) : Number(fromParams)
    if (Number.isFinite(n) && n > 0) return n
  }

  const raw = route.query.receiptId
  if (!raw) return undefined
  const n2 = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  if (!Number.isFinite(n2) || n2 <= 0) return undefined
  return n2
})

// receiptId outbound lấy từ params hoặc query (route WarehouseOutbound3DApproval)
const outboundReceiptId = computed(() => {
  const fromParams = route.params.receiptId
  if (fromParams != null) {
    const n = Array.isArray(fromParams) ? Number(fromParams[0]) : Number(fromParams)
    if (Number.isFinite(n) && n > 0) return n
  }

  const raw = route.query.receiptId
  if (!raw) return undefined
  const n2 = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  if (!Number.isFinite(n2) || n2 <= 0) return undefined
  return n2
})

// receiptId outbound đang được sử dụng trong 3D (có thể khác route params nếu chọn phiếu khác trong panel)
const selectedOutboundReceiptId = ref<number | undefined>(undefined)
const effectiveOutboundReceiptId = computed<number | undefined>(() => {
  return selectedOutboundReceiptId.value ?? outboundReceiptId.value
})

const outboundPaths = ref<{ palletId: number; points: PathPoint[] }[]>([])
const outboundPickedPalletIds = ref<number[]>([])
const outboundTargetPallets = ref<
  {
    palletId: number
    barcode?: string | null
    items: any[]
    hasPhysicalPallet?: boolean
  }[]
>([])
const outboundPickingRequests = ref<OutboundPickingProgressItem[]>([])
const loadingOutboundPicking = ref(false)
const highlightedOutboundPalletId = ref<number | null>(null)
const hoveredOutboundPathPalletId = ref<number | null>(null)

const currentOutboundPalletItems = computed<any[]>(() => {
  if (!outbound3DMode.value) return []
  const pid = highlightedOutboundPalletId.value
  if (pid == null) return []
  const p = outboundTargetPallets.value.find((x) => x.palletId === pid)
  return (p?.items as any[]) || []
})

const getOutboundPalletRequestedQty = (p: { items?: any[] }) => {
  if (!p || !Array.isArray(p.items)) return 0
  return p.items.reduce((sum, it) => {
    const q = Number((it as any).quantity ?? 0)
    if (!Number.isFinite(q)) return sum
    return sum + q
  }, 0)
}
const inboundPreviewResult = ref<InboundOptimizeLayoutView | null>(null)

// Pallet inbound đang chờ duyệt (preview, chưa commit DB)
interface InboundPendingPallet {
  palletId: number
  zoneId: number
  shelfId?: number | null
  positionX: number
  positionY: number
  positionZ: number
  isGround: boolean
  rotationY?: number // góc xoay pallet (rad), chỉ dùng trên FE 3D
}

const inboundPendingPallets = ref<InboundPendingPallet[]>([])

// Trạng thái duyệt inbound từng pallet trên FE
const currentInboundIndex = ref<number | null>(null)
const confirmedInboundPalletIds = ref<number[]>([])

const currentInboundPallet = computed<InboundPendingPallet | undefined>(() => {
  if (currentInboundIndex.value == null) return undefined
  const idx = currentInboundIndex.value
  if (idx < 0 || idx >= inboundPendingPallets.value.length) return undefined
  return inboundPendingPallets.value[idx]
})

const allInboundPalletsConfirmed = computed(() => {
  if (!inboundPendingPallets.value.length) return false
  const ids = inboundPendingPallets.value.map((p) => p.palletId)
  return ids.every((id) => confirmedInboundPalletIds.value.includes(id))
})

// Thông tin chi tiết phiếu inbound & layout chi tiết (manual) để overlay hàng trên pallet inbound
const inboundApprovalView = ref<InboundApprovalView | null>(null)
const outboundDetail = ref<OutboundRequestDetail | null>(null)
const inboundManualLayouts = ref<Record<number, ManualStackUnitRequest[]> | null>(null)

const warehouseId = computed(() => Number(route.params.id))
const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const canCreateInbound = computed(() => userRole.value === 'customer')
const canViewInbound = computed(() =>
  ['customer', 'warehouse_owner', 'admin'].includes(userRole.value)
)
const outbound3DMode = computed(() => route.name === 'WarehouseOutbound3DApproval')
const canMarkOutboundPicked = computed(
  () => outbound3DMode.value && ['warehouse_owner', 'admin'].includes(userRole.value)
)

const loadWarehousesFor3D = async () => {
  loadingWarehousesFor3D.value = true
  try {
    const userInfo = userStore.getUserInfo
    if (!userInfo) return

    let res: any
    if (userRole.value === 'customer') {
      res = await (warehouseApi as any).getWarehousesByCustomer(userInfo.accountId!)
    } else if (userRole.value === 'warehouse_owner') {
      res = await warehouseApi.getWarehousesByOwner(userInfo.accountId!)
    } else {
      res = await warehouseApi.getAllWarehouses()
    }

    if (res && (res.statusCode === 200 || res.code === 0)) {
      let list = (res.data || []) as WarehouseListItem[]

      if (userRole.value === 'customer' || userRole.value === 'warehouse_owner') {
        const map = new Map<number, WarehouseListItem>()
        list.forEach((w) => {
          if (!map.has(w.warehouseId)) {
            map.set(w.warehouseId, w)
          }
        })
        list = Array.from(map.values())
      }

      warehousesFor3D.value = list

      if (!selectedWarehouseIdFor3D.value && list.length > 0) {
        const fromRouteId = warehouseId.value
        const matched = list.find((w) => w.warehouseId === fromRouteId)
        selectedWarehouseIdFor3D.value = matched?.warehouseId ?? list[0].warehouseId

        if (
          selectedWarehouseIdFor3D.value &&
          selectedWarehouseIdFor3D.value !== warehouseId.value &&
          outbound3DMode.value
        ) {
          push({
            name: 'WarehouseOutbound3DApproval',
            params: { id: selectedWarehouseIdFor3D.value }
          })
        }
      }
    }
  } catch {
    // ignore, vẫn có thể xem kho hiện tại
  } finally {
    loadingWarehousesFor3D.value = false
  }
}

const handleWarehouseChange3D = (val: number | undefined) => {
  const n = Number(val)
  if (!Number.isFinite(n) || n <= 0) return
  selectedWarehouseIdFor3D.value = n
  if (selectedWarehouseIdFor3D.value !== warehouseId.value) {
    push({
      name: 'WarehouseOutbound3DApproval',
      params: { id: selectedWarehouseIdFor3D.value }
    })
  }
}

const goToCreateInbound = () => {
  const query: Record<string, string> = {
    warehouseId: String(warehouseId.value)
  }

  const zoneId = getCurrentZoneIdForInbound()
  if (zoneId) {
    query.zoneId = String(zoneId)
  }

  push({
    path: '/warehouse/inbound-request/create',
    query
  })
}

// Helper tìm thông tin kệ/tầng theo shelfId để clamp pallet trên kệ
const findShelfById = (shelfId: number) => {
  if (!warehouseData.value?.racks) return null
  for (const rack of warehouseData.value.racks) {
    const shelves = (rack.shelves || []) as any[]
    const shelf = shelves.find((s: any) => s.shelfId === shelfId)
    if (shelf) return { rack, shelf }
  }
  return null
}

const rotateSelectedInboundPallet = () => {
  if (!inboundMode.value) return
  if (!warehouseData.value) return

  const info = getSelectedInboundPendingPallet()
  if (!info) {
    ElMessage.warning('Vui lòng chọn một pallet inbound đang chờ duyệt trong khu vực 3D')
    return
  }

  const idx = inboundPendingPallets.value.findIndex((p) => p.palletId === info.palletId)
  if (idx === -1) return

  const pending = inboundPendingPallets.value[idx]

  const size = getPalletSizeForPalletId(pending.palletId)
  if (!size) {
    ElMessage.warning('Không xác định được kích thước pallet để xoay')
    return
  }

  const length = size.length
  const width = size.width

  const currentRotation = pending.rotationY ?? 0
  const step = Math.PI / 2 // 90°
  let newRotation = currentRotation + step
  const twoPi = Math.PI * 2
  newRotation = ((newRotation % twoPi) + twoPi) % twoPi

  const zone = warehouseData.value.zones?.find((z) => z.zoneId === pending.zoneId)
  if (!zone) {
    ElMessage.warning('Không tìm thấy khu vực (zone) của pallet inbound')
    return
  }

  const baseX = pending.positionX
  const baseZ = pending.positionZ

  const aabb = getPalletAabb(baseX, baseZ, length, width, newRotation)
  const zoneMinX = zone.positionX
  const zoneMaxX = zone.positionX + zone.length
  const zoneMinZ = zone.positionZ
  const zoneMaxZ = zone.positionZ + zone.width

  if (
    aabb.minX < zoneMinX - 1e-6 ||
    aabb.maxX > zoneMaxX + 1e-6 ||
    aabb.minZ < zoneMinZ - 1e-6 ||
    aabb.maxZ > zoneMaxZ + 1e-6
  ) {
    ElMessage.warning('Không thể xoay pallet vì sẽ vượt ra ngoài khu vực hiện tại')
    return
  }

  const collided =
    pending.shelfId != null
      ? hasShelfCollision(
          pending.palletId,
          pending.zoneId,
          pending.shelfId,
          baseX,
          baseZ,
          length,
          width,
          newRotation
        )
      : hasGroundCollision(
          pending.palletId,
          pending.zoneId,
          baseX,
          baseZ,
          length,
          width,
          newRotation
        )

  if (collided) {
    ElMessage.warning('Không thể xoay pallet vì sẽ chạm vào pallet hoặc kệ khác')
    return
  }

  const updated = {
    ...pending,
    rotationY: newRotation
  }

  inboundPendingPallets.value.splice(idx, 1, updated)

  if (selectedObject.value && selectedObject.value.palletId === info.palletId) {
    selectedObject.value = {
      ...selectedObject.value,
      rotationY: newRotation
    }
  }

  renderWarehouse()
}

// Helper dựng pallet ảo cho inbound pending khi pallet chưa tồn tại trong warehouseData.pallets
const buildVirtualInboundPallet = (pending: InboundPendingPallet) => {
  if (!inboundApprovalView.value) return null
  const items = inboundApprovalView.value.items.filter((it) => it.palletId === pending.palletId)
  if (!items.length) return null

  const anyItem = items[0]

  return {
    palletId: pending.palletId,
    zoneId: pending.zoneId,
    shelfId: pending.shelfId ?? null,
    positionX: pending.positionX,
    positionY: pending.positionY,
    positionZ: pending.positionZ,
    palletLength: anyItem.palletLength,
    palletWidth: anyItem.palletWidth,
    palletHeight: anyItem.palletHeight,
    palletQrContent: null
  }
}

watch(
  () => route.params.id,
  () => {
    const raw = route.params.id
    const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
    selectedWarehouseIdFor3D.value = Number.isFinite(n) ? n : undefined
    if (selectedWarehouseIdFor3D.value) {
      void loadWarehouse3DData()
      if (outbound3DMode.value) {
        void loadOutboundPickingRequests()
      }
    }
  }
)

const getPalletSizeForPalletId = (palletId: number) => {
  if (!warehouseData.value) return null

  let palletLength: number | undefined
  let palletWidth: number | undefined

  const pallet = warehouseData.value.pallets?.find((p) => p.palletId === palletId)
  if (pallet) {
    palletLength = pallet.palletLength
    palletWidth = pallet.palletWidth
  } else if (inboundApprovalView.value) {
    const anyItem = inboundApprovalView.value.items.find((it) => it.palletId === palletId)
    if (anyItem) {
      palletLength = anyItem.palletLength
      palletWidth = anyItem.palletWidth
    }
  }

  const length = Number(palletLength || 0)
  const width = Number(palletWidth || 0)
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(width) || width <= 0) {
    return null
  }

  return { length, width }
}

const rectsOverlap = (
  aMinX: number,
  aMaxX: number,
  aMinZ: number,
  aMaxZ: number,
  bMinX: number,
  bMaxX: number,
  bMinZ: number,
  bMaxZ: number
) => {
  return aMinX < bMaxX && aMaxX > bMinX && aMinZ < bMaxZ && aMaxZ > bMinZ
}

const getPalletAabb = (
  baseX: number,
  baseZ: number,
  length: number,
  width: number,
  rotationY?: number
) => {
  const angle = rotationY ?? 0

  if (Math.abs(angle) < 1e-6) {
    return {
      minX: baseX,
      maxX: baseX + length,
      minZ: baseZ,
      maxZ: baseZ + width
    }
  }

  const cx = baseX + length / 2
  const cz = baseZ + width / 2
  const halfL = length / 2
  const halfW = width / 2

  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const extentX = Math.abs(halfL * cos) + Math.abs(halfW * sin)
  const extentZ = Math.abs(halfL * sin) + Math.abs(halfW * cos)

  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minZ: cz - extentZ,
    maxZ: cz + extentZ
  }
}

const hasGroundCollision = (
  palletId: number,
  zoneId: number,
  baseX: number,
  baseZ: number,
  length: number,
  width: number,
  rotationY?: number
) => {
  if (!warehouseData.value) return false

  const { minX, maxX, minZ, maxZ } = getPalletAabb(baseX, baseZ, length, width, rotationY)

  let collided = false

  // Va chạm với khung kệ (rack)
  warehouseData.value.racks?.forEach((rack) => {
    if (rack.zoneId !== zoneId) return
    const rMinX = rack.positionX
    const rMaxX = rack.positionX + rack.length
    const rMinZ = rack.positionZ
    const rMaxZ = rack.positionZ + rack.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, rMinX, rMaxX, rMinZ, rMaxZ)) {
      collided = true
    }
  })

  if (collided) return true

  // Va chạm với pallet đã tồn tại trên mặt đất (từ DB)
  warehouseData.value.pallets?.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    const isGroundP =
      p.isGround === true ||
      (p.shelfId == null && (p.positionY == null || Number(p.positionY) <= 0.001))
    if (!isGroundP) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const pMinX = p.positionX
    const pMaxX = p.positionX + size.length
    const pMinZ = p.positionZ
    const pMaxZ = p.positionZ + size.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, pMinX, pMaxX, pMinZ, pMaxZ)) {
      collided = true
    }
  })

  if (collided) return true

  // Va chạm với các pallet inbound khác đang ở mặt đất (preview)
  inboundPendingPallets.value.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    if (p.shelfId != null) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const other = getPalletAabb(p.positionX, p.positionZ, size.length, size.width, p.rotationY)
    if (rectsOverlap(minX, maxX, minZ, maxZ, other.minX, other.maxX, other.minZ, other.maxZ)) {
      collided = true
    }
  })

  return collided
}

const getStackHeightsForPalletId = (palletId: number) => {
  if (!inboundApprovalView.value) return null
  const item = inboundApprovalView.value.items.find((it) => it.palletId === palletId)
  if (!item) return null
  const palletHeight = Number(item.palletHeight || 0)
  const goodsHeight = Number(item.itemHeight || 0)
  if (!Number.isFinite(palletHeight) || palletHeight <= 0) return null
  if (!Number.isFinite(goodsHeight) || goodsHeight <= 0) return null
  return { palletHeight, goodsHeight }
}

const isBagPallet = (palletId: number) => {
  if (!inboundApprovalView.value) return false
  const item = inboundApprovalView.value.items.find((it) => it.palletId === palletId)
  return item?.isBag === true
}

const getShelfClearHeightFrontend = (rack: any, shelf: any) => {
  const shelves = ((rack.shelves || []) as any[]).slice().sort((a, b) => {
    const aLevel = Number(a.shelfLevel ?? 0)
    const bLevel = Number(b.shelfLevel ?? 0)
    return aLevel - bLevel
  })
  const index = shelves.findIndex((s) => s.shelfId === shelf.shelfId)
  if (index < 0) return Number(rack.height || 0) || 0
  if (index < shelves.length - 1) {
    const nextShelf = shelves[index + 1]
    return Number(nextShelf.positionY || 0) - Number(shelf.positionY || 0)
  }
  return Number(rack.height || 0) - Number(shelf.positionY || 0)
}

const hasShelfCollision = (
  palletId: number,
  zoneId: number,
  shelfId: number,
  baseX: number,
  baseZ: number,
  length: number,
  width: number,
  rotationY?: number
) => {
  if (!warehouseData.value) return false

  const { minX, maxX, minZ, maxZ } = getPalletAabb(baseX, baseZ, length, width, rotationY)

  let collided = false

  // Va chạm với pallet đã tồn tại trên cùng tầng kệ (từ DB)
  warehouseData.value.pallets?.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    if (p.shelfId !== shelfId) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const pMinX = p.positionX
    const pMaxX = p.positionX + size.length
    const pMinZ = p.positionZ
    const pMaxZ = p.positionZ + size.width
    if (rectsOverlap(minX, maxX, minZ, maxZ, pMinX, pMaxX, pMinZ, pMaxZ)) {
      collided = true
    }
  })

  if (collided) return true

  // Va chạm với các pallet inbound khác trên cùng tầng kệ (preview)
  inboundPendingPallets.value.forEach((p) => {
    if (p.palletId === palletId) return
    if (p.zoneId !== zoneId) return
    if (p.shelfId !== shelfId) return
    const size = getPalletSizeForPalletId(p.palletId)
    if (!size) return
    const other = getPalletAabb(p.positionX, p.positionZ, size.length, size.width, p.rotationY)
    if (rectsOverlap(minX, maxX, minZ, maxZ, other.minX, other.maxX, other.minZ, other.maxZ)) {
      collided = true
    }
  })

  return collided
}

const goToViewInbound = () => {
  push({
    path: '/warehouse/inbound-request',
    query: { warehouseId: String(warehouseId.value) }
  })
}

// Quay lại: nếu đang ở màn duyệt inbound 3D thì quay về màn duyệt yêu cầu nhập kho,
// nếu ở màn outbound 3D thì quay về chi tiết phiếu xuất,
// ngược lại quay về chi tiết kho như cũ
const goBackFrom3D = () => {
  if (inboundMode.value && inboundReceiptId.value) {
    push({ path: `/warehouse/inbound-request/${inboundReceiptId.value}/approval` })
  } else if (route.name === 'WarehouseOutbound3DApproval' && outboundReceiptId.value) {
    push({
      path: `/warehouse/outbound-request/${outboundReceiptId.value}/detail`,
      query: { warehouseId: String(warehouseId.value) }
    })
  } else {
    push(`/warehouse/${warehouseId.value}/detail`)
  }
}

// 3D Scene variables
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2

// Drag & drop pallet inbound (3D)
let draggingPallet: THREE.Object3D | null = null
let draggingPalletData: any | null = null
let dragPlane: THREE.Plane | null = null
const dragOffset = new THREE.Vector3()
let isDragging = false
const palletGridStep = 0.1

// UI State
const viewMode = ref<'zones' | 'items' | 'pallets' | 'racks' | ''>('')
const showGrid = ref(false)
const showLabels = ref(false)
const selectedObject = ref<any>(null)
const filterByCustomer = ref<number | undefined>(undefined)
const filterByZone = ref<number | undefined>(undefined)

const palletDetailVisible = ref(false)
const palletDetail = ref<any | null>(null)
const palletDetailItems = ref<any[]>([])
const showPalletQr = ref(false)
const palletQrText = ref('')
// Customer list
const customers = computed(() => {
  if (!warehouseData.value?.zones) return []
  const map = new Map()
  warehouseData.value.zones.forEach((z) => {
    if (z.customerId && z.customerName) {
      map.set(z.customerId, z.customerName)
    }
  })
  return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
})

// Helper đọc zoneId từ query/params ban đầu của route
const getZoneIdFromQuery = (): number | undefined => {
  // Ưu tiên params.zoneId (route mới inbound-3d-approval)
  const fromParams = route.params.zoneId
  if (fromParams != null) {
    const n = Array.isArray(fromParams) ? Number(fromParams[0]) : Number(fromParams)
    if (Number.isFinite(n) && n > 0) return n
  }

  const raw = route.query.zoneId
  if (!raw) return undefined
  const n2 = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  if (!Number.isFinite(n2) || n2 <= 0) return undefined
  return n2
}

const lockedZoneIdFromQuery = computed(() => getZoneIdFromQuery())
const isZoneLockedFromQuery = computed(() => !!lockedZoneIdFromQuery.value)

// Zone list for filter
const zonesForFilter = computed(() => {
  if (!warehouseData.value?.zones) return []
  const zones = warehouseData.value.zones
  const lockedId = lockedZoneIdFromQuery.value
  const visibleZones = lockedId ? zones.filter((z) => z.zoneId === lockedId) : zones
  return visibleZones.map((z) => ({
    id: z.zoneId,
    name: z.zoneName || `Zone #${z.zoneId}`
  }))
})

// Helper lấy zoneId cho màn tạo yêu cầu nhập kho
// Ưu tiên zone đang được filter trong 3D, nếu không có thì dùng zoneId từ query ban đầu.
function getCurrentZoneIdForInbound(): number | undefined {
  const v = filterByZone.value
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return v
  }
  return getZoneIdFromQuery()
}

const syncSelectedOutboundReceiptAfterPickingRequestsChange = async () => {
  if (!outbound3DMode.value) return

  const list = outboundPickingRequests.value || []
  const currentId = effectiveOutboundReceiptId.value

  const hasCurrent =
    typeof currentId === 'number' &&
    Number.isFinite(currentId) &&
    list.some((r) => r.receiptId === currentId)

  if (hasCurrent) {
    selectedOutboundReceiptId.value = currentId
    return
  }

  if (list.length) {
    const first = list[0]
    if (first && typeof first.receiptId === 'number' && Number.isFinite(first.receiptId)) {
      selectedOutboundReceiptId.value = first.receiptId
      await loadOutboundDataForReceipt(first.receiptId)
    }
  } else {
    selectedOutboundReceiptId.value = undefined
    outboundDetail.value = null
    outboundTargetPallets.value = []
    outboundPaths.value = []
    outboundPickedPalletIds.value = []
    highlightedOutboundPalletId.value = null
  }
}

const loadOutboundPickingRequests = async () => {
  if (!outbound3DMode.value) return
  loadingOutboundPicking.value = true
  try {
    const res = await outboundApi.getOutboundPickingRequests({ warehouseId: warehouseId.value })
    if (res.statusCode === 200 || res.code === 0) {
      outboundPickingRequests.value = (res.data || []) as OutboundPickingProgressItem[]
    } else {
      outboundPickingRequests.value = []
    }
  } catch {
    outboundPickingRequests.value = []
  } finally {
    loadingOutboundPicking.value = false
    await syncSelectedOutboundReceiptAfterPickingRequestsChange()
  }
}

// Load warehouse 3D data
const loadWarehouse3DData = async () => {
  loading.value = true
  try {
    outboundPaths.value = []
    outboundPickedPalletIds.value = []
    outboundTargetPallets.value = []

    const res = await warehouseApi.getWarehouse3DData(warehouseId.value)
    if (res.statusCode === 200 || res.code === 0) {
      warehouseData.value = res.data

      const initialZoneId = getZoneIdFromQuery()
      if (initialZoneId) {
        filterByZone.value = initialZoneId
      }

      // Nếu đang ở chế độ inbound-approval thì load preview inbound layout
      if (inboundMode.value && inboundReceiptId.value) {
        try {
          const previewRes = await inboundApi.previewApproveInboundLayout(inboundReceiptId.value, {
            forceUsePreferredLayout: true
          })
          if (previewRes.statusCode === 200 || previewRes.code === 0) {
            inboundPreviewResult.value = previewRes.data
            const layouts = previewRes.data?.layouts || []
            inboundPendingPallets.value = layouts.map((l) => ({
              palletId: l.palletId,
              zoneId: l.zoneId,
              shelfId: l.shelfId ?? null,
              positionX: l.positionX,
              positionY: l.positionY,
              positionZ: l.positionZ,
              isGround: l.isGround,
              rotationY: 0
            }))

            // Reset trạng thái duyệt từng pallet
            confirmedInboundPalletIds.value = []
            currentInboundIndex.value = inboundPendingPallets.value.length ? 0 : null

            // Nếu chưa có filterByZone thì set theo zone của layout đầu tiên
            if (!filterByZone.value && layouts.length) {
              filterByZone.value = layouts[0].zoneId
            }

            // Lấy lại layout chi tiết manual (nếu có) từ sessionStorage để overlay hàng inbound theo stackUnits
            if (typeof window !== 'undefined') {
              const key = `inboundManualLayouts:${inboundReceiptId.value}`
              const raw = window.sessionStorage.getItem(key)
              if (raw) {
                try {
                  inboundManualLayouts.value = JSON.parse(raw)
                } catch {
                  inboundManualLayouts.value = null
                }
              }
            }

            // Lấy metadata hàng hóa inbound để dựng box trên pallet inbound
            try {
              const approvalRes = await inboundApi.getInboundApprovalView(inboundReceiptId.value)
              if (approvalRes.statusCode === 200 || approvalRes.code === 0) {
                const view = approvalRes.data

                // Đảm bảo receiptId thuộc đúng warehouse/id và (nếu có) đúng zoneId
                const currentWarehouseId = warehouseId.value
                const currentZoneId = getZoneIdFromQuery()

                if (view.warehouseId !== currentWarehouseId) {
                  ElMessage.error('Phiếu inbound không thuộc kho hiện tại')
                  goBackFrom3D()
                  return
                }

                if (currentZoneId && view.zoneId && view.zoneId !== currentZoneId) {
                  ElMessage.error('Phiếu inbound không thuộc khu vực hiện tại')
                  goBackFrom3D()
                  return
                }

                inboundApprovalView.value = view
              }
            } catch (error) {
              console.error('[Warehouse3D] load inbound approval view failed', error)
            }
          } else {
            ElMessage.error(previewRes.message || 'Không thể tải layout inbound để xem 3D')
          }
        } catch (error) {
          console.error('[Warehouse3D] load inbound preview failed', error)
          ElMessage.error('Lỗi khi tải layout inbound để xem 3D')
        }
      }

      // Nếu đang ở màn 3D outbound approval thì luôn load danh sách phiếu xuất đang lấy hàng,
      // và nếu đã có receiptId cụ thể thì tính đường đi từ bàn checkin đến các pallet thuộc phiếu outbound đó
      if (outbound3DMode.value) {
        await loadOutboundPickingRequests()
        if (effectiveOutboundReceiptId.value) {
          await loadOutboundDataForReceipt(effectiveOutboundReceiptId.value)
        }
      }

      initThreeJS()
      ElMessage.success('Tải dữ liệu kho thành công')
    } else {
      ElMessage.error(res.message || 'Không thể tải dữ liệu kho')
    }
  } catch (error) {
    // Log ngắn gọn để debug khi cần, không ảnh hưởng người dùng
    console.error('[Warehouse3D] loadWarehouse3DData failed', error)
    ElMessage.error('Lỗi khi tải dữ liệu kho')
  } finally {
    loading.value = false
  }
}

const loadOutboundDataForReceipt = async (receiptId: number) => {
  if (!warehouseData.value) return

  try {
    const outRes = await outboundApi.getOutboundRequestDetail(receiptId)
    if (outRes.statusCode === 200 || outRes.code === 0) {
      outboundDetail.value = outRes.data as OutboundRequestDetail

      const data = warehouseData.value
      const detail = outboundDetail.value
      if (data && detail && Array.isArray(data.items) && Array.isArray(data.pallets)) {
        const allItems = data.items as ItemAllocation[]
        const palletIdFromItems = new Set<number>()

        // Pallet có hàng cho phiếu này theo dữ liệu 3D hiện tại (còn tồn vật lý)
        detail.items.forEach((it) => {
          const alloc = allItems.find((a) => a.itemId === it.itemId)
          if (alloc && typeof alloc.palletId === 'number') {
            palletIdFromItems.add(alloc.palletId)
          }
        })

        // Load danh sách pallet đã được đánh dấu "Đã lấy" cho phiếu này
        try {
          const picksRes = await outboundApi.getOutboundPalletPicks(receiptId)
          if (picksRes.statusCode === 200 || picksRes.code === 0) {
            const picks = (picksRes.data as OutboundPalletPickViewModel[]) || []
            outboundPickedPalletIds.value = picks.map((p) => p.palletId)
          } else {
            outboundPickedPalletIds.value = []
          }
        } catch {
          outboundPickedPalletIds.value = []
        }

        // Hợp nhất pallet từ hàng hóa trong kho (còn tồn) và pallet đã được pick (lịch sử)
        const unionPalletIdSet = new Set<number>()
        palletIdFromItems.forEach((id) => unionPalletIdSet.add(id))
        outboundPickedPalletIds.value.forEach((id) => {
          if (typeof id === 'number' && Number.isFinite(id)) {
            unionPalletIdSet.add(id)
          }
        })

        const allPalletIds = Array.from(unionPalletIdSet)

        const palletsInfo = allPalletIds.map((pid) => {
          const palletLoc: any = data.pallets.find((p) => p.palletId === pid) || null
          const barcode = palletLoc?.barcode ?? null
          const palletItems = detail.items.filter((it) => {
            const alloc = allItems.find((a) => a.itemId === it.itemId)
            return alloc && alloc.palletId === pid
          })
          const hasPhysicalPallet = !!palletLoc
          return { palletId: pid, barcode, items: palletItems as any[], hasPhysicalPallet }
        })

        // outboundTargetPallets bây giờ bao gồm cả pallet đã lấy (chỉ có trong OutboundPalletPicks)
        outboundTargetPallets.value = palletsInfo

        const paths: { palletId: number; points: PathPoint[] }[] = []

        // Chỉ tính đường đi cho các pallet còn hàng (theo 3D data) và chưa được pick
        palletIdFromItems.forEach((pid) => {
          if (outboundPickedPalletIds.value.includes(pid)) return

          const path = findPathToPallet(data, pid, null, {
            cellSize: 0.3,
            safetyMargin: 0.75,
            maxIterations: 300000
          })

          if (path.success && path.points.length >= 2) {
            paths.push({ palletId: pid, points: path.points })
          }
        })

        outboundPaths.value = paths

        // Chỉ cảnh báo khi còn pallet chưa pick nhưng không tìm được đường
        if (!paths.length && palletIdFromItems.size > 0) {
          ElMessage.warning('Không tìm được đường đi rộng ≥ 1.5m để đến pallet cho phiếu xuất này')
        }
      }
    }
  } catch (error) {
    console.error('[Warehouse3D] loadOutboundDataForReceipt failed', {
      receiptId,
      error
    })
  }

  selectedOutboundReceiptId.value = receiptId
  renderWarehouse()
}

const reloadOutbound3DForCurrentReceipt = async () => {
  const receiptId = effectiveOutboundReceiptId.value
  if (!outbound3DMode.value || !receiptId) return

  try {
    const res = await warehouseApi.getWarehouse3DData(warehouseId.value)
    if (res.statusCode === 200 || res.code === 0) {
      warehouseData.value = res.data
      await loadOutboundDataForReceipt(receiptId)
    }
  } catch (error) {
    console.error('[Warehouse3D] reloadOutbound3DForCurrentReceipt failed', {
      warehouseId: warehouseId.value,
      receiptId,
      error
    })
    ElMessage.error('Không thể tải lại dữ liệu kho sau khi lấy pallet')
  }
}

// Initialize Three.js scene
const initThreeJS = () => {
  if (!container.value || !warehouseData.value) return

  // Clear previous scene
  if (renderer) {
    container.value.removeChild(renderer.domElement)
  }

  // Scene setup
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)

  // Camera setup
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)

  // Position camera to view the warehouse from a good angle
  const wh = warehouseData.value
  camera.position.set(wh.length * 0.8, wh.height * 1.5, wh.width * 1.2)
  camera.lookAt(wh.length / 2, 0, wh.width / 2)

  // Renderer setup
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.value.appendChild(renderer.domElement)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.target.set(wh.length / 2, 0, wh.width / 2)

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(wh.length, wh.height * 2, wh.width)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  directionalLight.shadow.camera.far = 500
  scene.add(directionalLight)

  // Grid
  if (showGrid.value) {
    const gridSize = Math.max(wh.length, wh.width)
    const gridHelper = new THREE.GridHelper(gridSize, 50, 0x888888, 0xcccccc)
    gridHelper.name = 'gridHelper'
    scene.add(gridHelper)
  }

  // Ground
  const groundGeo = new THREE.PlaneGeometry(wh.length, wh.width)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, side: THREE.DoubleSide })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(wh.length / 2, 0, wh.width / 2)
  ground.receiveShadow = true
  ground.name = 'ground'
  scene.add(ground)

  renderCheckinAndGates()

  // Raycaster
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // Event listeners
  window.addEventListener('resize', onWindowResize)
  renderer.domElement.addEventListener('click', onCanvasClick)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerUp)

  // Render warehouse objects
  renderWarehouse()

  // Start animation loop
  animate()
}

// Render warehouse objects
const renderWarehouse = () => {
  if (!warehouseData.value) return
  // Nếu scene chưa được khởi tạo (chưa chạy initThreeJS) thì không render để tránh lỗi
  if (!scene) return

  // Xoá các object động (zone, rack, shelf, pallet, item, đường đi outbound, khung kho) nhưng giữ lại nền, lưới, cổng, bàn checkin
  const dynamicTypes = ['zone', 'pallet', 'item', 'outboundPath']
  const objectsToRemove: THREE.Object3D[] = []

  scene.children.forEach((child) => {
    const userData: any = (child as any).userData || {}
    const type = userData.type as string | undefined
    const name = child.name || ''

    if (type && dynamicTypes.includes(type)) {
      objectsToRemove.push(child)
    } else if (name === 'warehouseBoundary') {
      objectsToRemove.push(child)
    } else if (name.startsWith('rack_') || name.startsWith('shelf_')) {
      objectsToRemove.push(child)
    }
  })

  objectsToRemove.forEach((obj) => scene.remove(obj))

  // Render warehouse boundary
  renderWarehouseBoundary()

  // Render zones
  warehouseData.value.zones?.forEach((zone) => {
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return
    renderZone(zone)
  })

  // Render racks
  renderRacks()

  // Render pallets
  warehouseData.value.pallets?.forEach((pallet) => {
    // Ở chế độ inbound-approval, nếu pallet này đang nằm trong danh sách inboundPendingPallets
    // thì không render version trong DB nữa, chỉ render version preview inbound bên dưới
    if (
      inboundMode.value &&
      inboundPendingPallets.value.some((ip) => ip.palletId === pallet.palletId)
    ) {
      return
    }

    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
    if (!zone) return
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return
    renderPallet(pallet, false)
  })

  // Render inbound pending pallets (preview, chưa commit DB)
  if (inboundMode.value && inboundPendingPallets.value.length && warehouseData.value) {
    inboundPendingPallets.value.forEach((p, idx) => {
      const zone = warehouseData.value!.zones?.find((z) => z.zoneId === p.zoneId)
      if (!zone) return
      if (filterByZone.value && zone.zoneId !== filterByZone.value) return
      if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return

      const basePallet = warehouseData.value!.pallets?.find((bp) => bp.palletId === p.palletId)
      const sourcePallet = basePallet || buildVirtualInboundPallet(p)
      if (!sourcePallet) return

      const virtualPallet = {
        ...sourcePallet,
        zoneId: p.zoneId,
        shelfId: p.shelfId ?? null,
        positionX: p.positionX,
        positionY: p.positionY,
        positionZ: p.positionZ,
        rotationY: p.rotationY ?? 0
      }

      const isCurrentInbound =
        currentInboundIndex.value != null && currentInboundIndex.value === idx

      renderPallet(virtualPallet, true, isCurrentInbound)

      // Overlay hàng inbound trên pallet inbound (sử dụng metadata từ approval-view + layout chi tiết từ DB nếu có)
      if (inboundApprovalView.value) {
        const itemsForPallet: InboundApprovalItem[] = inboundApprovalView.value.items.filter(
          (it) => it.palletId === p.palletId
        )

        itemsForPallet.forEach((it) => {
          const virtualItem: any = {
            itemId: it.itemId,
            itemName: it.productName,
            productCode: it.productCode,
            itemType: it.isBag ? 'bag' : 'box',
            shape: it.isBag ? 'bag' : 'box',
            palletId: it.palletId,
            length: it.itemLength,
            width: it.itemWidth,
            height: it.itemHeight,
            unitQuantity: it.quantity
          }

          // Ưu tiên dùng layout chi tiết từ BE (StackUnits trong InboundApprovalView)
          if (Array.isArray(it.stackUnits) && it.stackUnits.length > 0) {
            virtualItem.stackUnits = it.stackUnits
          } else {
            // Fallback: dùng layout đã lưu tạm ở sessionStorage (inboundManualLayouts)
            const layoutMap = inboundManualLayouts.value
            if (layoutMap && layoutMap[it.inboundItemId]) {
              virtualItem.stackUnits = layoutMap[it.inboundItemId]
            }
          }

          renderItem(virtualItem, virtualPallet, true, isCurrentInbound)
        })
      }
    })
  }

  // Render items
  warehouseData.value.items?.forEach((item) => {
    const pallet = warehouseData.value!.pallets?.find((p) => p.palletId === item.palletId)
    if (!pallet) return

    // Ở chế độ inbound-approval, nếu pallet này đang nằm trong inboundPendingPallets
    // thì bỏ qua version hàng trong DB, chỉ render overlay inbound bên trên
    if (
      inboundMode.value &&
      inboundPendingPallets.value.some((ip) => ip.palletId === item.palletId)
    ) {
      return
    }

    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
    if (!zone) return
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return
    renderItem(item, pallet)
  })

  // Render outbound paths (đường đi từ bàn checkin đến các pallet trong phiếu outbound)
  if (route.name === 'WarehouseOutbound3DApproval' && outboundPaths.value.length) {
    renderOutboundPaths()
  }
}

const renderOutboundPaths = () => {
  if (!warehouseData.value || !outboundPaths.value.length) return

  const y = 0.05
  const stripHeight = 0.06
  const stripHalfHeight = stripHeight / 2
  const stripWidth = 0.5

  const baseColor = 0x00c853

  outboundPaths.value.forEach((p) => {
    if (outboundPickedPalletIds.value.includes(p.palletId)) return
    const pts = p.points
    if (pts.length < 2) return

    let lastSegmentDir: THREE.Vector3 | null = null
    let lastEnd: THREE.Vector3 | null = null

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]

      const start = new THREE.Vector3(a.x, y, a.z)
      const end = new THREE.Vector3(b.x, y, b.z)

      const dir = new THREE.Vector3().subVectors(end, start)
      const length = dir.length()
      if (length <= 0.01) continue
      dir.normalize()

      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
      const geometry = new THREE.BoxGeometry(stripWidth, stripHeight, length)
      const material = new THREE.MeshPhongMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false
      })
      const strip = new THREE.Mesh(geometry, material)
      strip.position.set(mid.x, y + stripHalfHeight, mid.z)
      strip.rotation.y = Math.atan2(dir.x, dir.z)
      strip.userData = { type: 'outboundPath', palletId: p.palletId }
      scene.add(strip)

      lastSegmentDir = dir
      lastEnd = end
    }

    if (lastSegmentDir && lastEnd) {
      const arrowOrigin = lastEnd.clone()
      arrowOrigin.y += 0.15
      const arrow = new THREE.ArrowHelper(lastSegmentDir, arrowOrigin, 0.9, 0xff5722, 0.35, 0.22)
      arrow.userData = { type: 'outboundPath', palletId: p.palletId }

      const lineMat = arrow.line.material as THREE.Material
      const coneMat = arrow.cone.material as THREE.Material
      ;[lineMat, coneMat].forEach((m) => {
        if (!m) return
        ;(m as any).depthTest = false
        ;(m as any).depthWrite = false
        ;(m as any).transparent = true
      })

      scene.add(arrow)
    }
  })

  updateOutboundPathHighlight()
}

const updateOutboundPathHighlight = () => {
  const baseColor = 0x00c853
  const selectedColor = 0xffc107
  const hoverColor = 0x40c4ff
  const hoverSelectedColor = 0xffeb3b

  scene.children.forEach((child) => {
    const userData: any = (child as any).userData
    if (!userData || userData.type !== 'outboundPath') return

    const pid = Number(userData.palletId)
    if (!Number.isFinite(pid)) return

    const isSelected =
      highlightedOutboundPalletId.value != null && highlightedOutboundPalletId.value === pid
    const isHovered =
      hoveredOutboundPathPalletId.value != null && hoveredOutboundPathPalletId.value === pid

    let color = baseColor
    let renderOrder = 1
    let opacity = 0.9
    if (isSelected && isHovered) {
      color = hoverSelectedColor
      renderOrder = 3
      opacity = 1
    } else if (isSelected) {
      color = selectedColor
      renderOrder = 3
      opacity = 1
    } else if (isHovered) {
      color = hoverColor
      renderOrder = 2
      opacity = 0.95
    }

    if ((child as any).isMesh) {
      const mesh = child as THREE.Mesh
      mesh.renderOrder = renderOrder
      const mat = mesh.material
      if (Array.isArray(mat)) {
        mat.forEach((m) => {
          const typed = m as any
          if (typed && typed.color) {
            typed.color.setHex(color)
            if (typed.transparent) typed.opacity = opacity
          }
        })
      } else {
        const typed = mat as any
        if (typed && typed.color) {
          typed.color.setHex(color)
          if (typed.transparent) typed.opacity = opacity
        }
      }
    } else if ((child as any).isArrowHelper) {
      const arrow = child as THREE.ArrowHelper
      arrow.renderOrder = renderOrder
      const lineMat = arrow.line.material as any
      const coneMat = arrow.cone.material as any
      if (lineMat && lineMat.color) {
        lineMat.color.setHex(color)
        if (lineMat.transparent) lineMat.opacity = opacity
      }
      if (coneMat && coneMat.color) {
        coneMat.color.setHex(color)
        if (coneMat.transparent) coneMat.opacity = opacity
      }
    }
  })
}

const renderCheckinAndGates = () => {
  if (!warehouseData.value) return

  const wh = warehouseData.value

  if (
    wh.checkinPositionX !== null &&
    wh.checkinPositionX !== undefined &&
    wh.checkinPositionZ !== null &&
    wh.checkinPositionZ !== undefined
  ) {
    const deskLength = wh.checkinLength ?? 1.5
    const deskWidth = wh.checkinWidth ?? 0.8
    const deskHeight = wh.checkinHeight ?? 1.0

    // Bàn (khối đặc từ nền lên đến mặt bàn)
    const deskGeo = new THREE.BoxGeometry(deskLength, deskHeight, deskWidth)
    const deskMat = new THREE.MeshPhongMaterial({ color: 0xdcdcdc })
    const desk = new THREE.Mesh(deskGeo, deskMat)
    desk.position.set(wh.checkinPositionX, deskHeight / 2, wh.checkinPositionZ)
    desk.castShadow = true
    desk.receiveShadow = true
    desk.name = 'checkin_desk'
    scene.add(desk)

    // Màn hình máy tính
    const screenGeo = new THREE.BoxGeometry(0.7, 0.45, 0.03)
    const screenMat = new THREE.MeshPhongMaterial({ color: 0x2c3e50 })
    const screen = new THREE.Mesh(screenGeo, screenMat)
    screen.position.set(
      wh.checkinPositionX,
      deskHeight + 0.35,
      wh.checkinPositionZ - deskWidth / 2 + 0.05
    )
    screen.castShadow = true
    screen.name = 'checkin_monitor'
    scene.add(screen)

    // Chân màn hình
    const standGeo = new THREE.BoxGeometry(0.1, 0.25, 0.08)
    const standMat = new THREE.MeshPhongMaterial({ color: 0x34495e })
    const stand = new THREE.Mesh(standGeo, standMat)
    stand.position.set(
      wh.checkinPositionX,
      deskHeight + 0.15,
      wh.checkinPositionZ - deskWidth / 2 + 0.1
    )
    stand.castShadow = true
    scene.add(stand)
  }

  // Cổng kho hiển thị như 1 khung cửa mở
  wh.gates?.forEach((gate) => {
    const doorWidth = Number(gate.length ?? 2)
    const doorHeight = Number(gate.height ?? 2.2)
    const frameThickness = Number(gate.width ?? 0.3)
    const color = gate.gateType === 'exit' ? 0xe74c3c : 0x3498db
    const frameMat = new THREE.MeshPhongMaterial({ color })

    const group = new THREE.Group()

    // Hai trụ đứng
    const verticalGeo = new THREE.BoxGeometry(frameThickness, doorHeight, frameThickness)
    const left = new THREE.Mesh(verticalGeo, frameMat)
    left.position.set(-doorWidth / 2, doorHeight / 2, 0)
    left.castShadow = true
    const right = left.clone()
    right.position.x = doorWidth / 2

    // Thanh ngang trên
    const topGeo = new THREE.BoxGeometry(doorWidth, frameThickness, frameThickness)
    const top = new THREE.Mesh(topGeo, frameMat)
    top.position.set(0, doorHeight - frameThickness / 2, 0)
    top.castShadow = true

    group.add(left)
    group.add(right)
    group.add(top)

    group.position.set(gate.positionX, 0, gate.positionZ)
    group.name = `gate_${gate.gateId}`
    scene.add(group)
  })
}

// Render warehouse boundary (wireframe)
const renderWarehouseBoundary = () => {
  if (!warehouseData.value) return
  const { length, width, height } = warehouseData.value

  const geometry = new THREE.BoxGeometry(length, height, width)
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 })
  )
  line.position.set(length / 2, height / 2, width / 2)
  line.name = 'warehouseBoundary'
  scene.add(line)
}

// Render zone (semi-transparent colored box)
const renderZone = (zone: any) => {
  const geometry = new THREE.BoxGeometry(zone.length, zone.height, zone.width)

  // Generate unique color per customer
  let color = 0x3498db
  if (zone.customerId) {
    const hue = (zone.customerId * 137.508) % 360
    color = new THREE.Color(`hsl(${hue}, 70%, 60%)`).getHex()
  }

  const material = new THREE.MeshPhongMaterial({
    color: color,
    transparent: true,
    opacity: 0.15,
    side: THREE.DoubleSide
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    zone.positionX + zone.length / 2,
    zone.positionY + zone.height / 2,
    zone.positionZ + zone.width / 2
  )
  mesh.userData = { type: 'zone', data: zone }
  mesh.name = `zone_${zone.zoneId}`

  // Add edges for better visibility
  const edges = new THREE.EdgesGeometry(geometry)
  const lineColor = new THREE.Color(color).multiplyScalar(0.7)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: lineColor.getHex(), linewidth: 2 })
  )
  line.position.copy(mesh.position)
  line.userData = mesh.userData

  scene.add(mesh)
  scene.add(line)
}

// Render racks and shelves
const renderRacks = () => {
  if (!warehouseData.value?.racks) return

  warehouseData.value.racks.forEach((rack) => {
    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === rack.zoneId)
    if (!zone) return
    if (filterByZone.value && zone.zoneId !== filterByZone.value) return
    if (filterByCustomer.value && zone.customerId !== filterByCustomer.value) return

    const frameGeometry = new THREE.BoxGeometry(rack.length, rack.height, rack.width)
    const frameEdges = new THREE.EdgesGeometry(frameGeometry)
    const frameLines = new THREE.LineSegments(
      frameEdges,
      new THREE.LineBasicMaterial({ color: 0x1f4e79 })
    )
    frameLines.position.set(
      rack.positionX + rack.length / 2,
      rack.positionY + rack.height / 2,
      rack.positionZ + rack.width / 2
    )
    frameLines.name = `rack_${rack.rackId}_frame`
    frameLines.userData = { type: 'rack', data: rack }
    scene.add(frameLines)

    if (rack.shelves) {
      rack.shelves.forEach((shelf: any) => {
        const shelfGeometry = new THREE.BoxGeometry(shelf.length, 0.05, shelf.width)
        const shelfMaterial = new THREE.MeshPhongMaterial({ color: 0xf5f5f5 })
        const shelfMesh = new THREE.Mesh(shelfGeometry, shelfMaterial)
        shelfMesh.position.set(
          rack.positionX + shelf.length / 2,
          shelf.positionY,
          rack.positionZ + shelf.width / 2
        )
        shelfMesh.castShadow = true
        shelfMesh.receiveShadow = true
        shelfMesh.name = `shelf_${shelf.shelfId}`
        shelfMesh.userData = { type: 'shelf', data: shelf }
        scene.add(shelfMesh)
      })
    }
  })
}

const renderPallet = (pallet: any, pendingInbound = false, isCurrentInbound = false) => {
  const geometry = new THREE.BoxGeometry(
    pallet.palletLength,
    pallet.palletHeight,
    pallet.palletWidth
  )

  // Check if pallet has items
  const hasItems = warehouseData.value!.items?.some((i) => i.palletId === pallet.palletId)
  let color = hasItems ? 0xe67e22 : 0xbdc3c7
  if (pendingInbound) {
    color = 0x2ecc71
  }
  // Pallet inbound đang được duyệt: tô màu nổi bật hơn
  if (pendingInbound && isCurrentInbound) {
    color = 0xf1c40f
  }

  // Pallet outbound đang được chọn từ panel bên trái: highlight khác màu
  if (
    !pendingInbound &&
    outbound3DMode.value &&
    highlightedOutboundPalletId.value === pallet.palletId
  ) {
    color = 0x1abc9c
  }

  const material = new THREE.MeshPhongMaterial({ color: color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    pallet.positionX + pallet.palletLength / 2,
    pallet.positionY + pallet.palletHeight / 2,
    pallet.positionZ + pallet.palletWidth / 2
  )
  if (typeof pallet.rotationY === 'number') {
    mesh.rotation.y = pallet.rotationY
  } else if (typeof pallet.rotationY === 'string') {
    const ry = Number(pallet.rotationY)
    if (Number.isFinite(ry)) mesh.rotation.y = ry
  }
  mesh.userData = { type: 'pallet', data: pallet, pendingInbound }
  mesh.name = `pallet_${pallet.palletId}`
  mesh.castShadow = true
  mesh.receiveShadow = true

  // Thêm viền để dễ quan sát biên pallet trong 3D
  const edgeGeo = new THREE.EdgesGeometry(geometry)
  let edgeColor = pendingInbound && isCurrentInbound ? 0xff0000 : 0x000000
  if (
    !pendingInbound &&
    outbound3DMode.value &&
    highlightedOutboundPalletId.value === pallet.palletId
  ) {
    edgeColor = 0x1abc9c
  }
  const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor })
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat)
  edgeLines.position.copy(mesh.position)
  edgeLines.rotation.copy(mesh.rotation)
  edgeLines.userData = mesh.userData
  edgeLines.name = `${mesh.name}_outline`

  scene.add(mesh)
  scene.add(edgeLines)
}

// Render item (box on pallet)
const renderItem = (item: any, pallet: any, pendingInbound = false, isCurrentInbound = false) => {
  const itemType = typeof item.itemType === 'string' ? item.itemType.toLowerCase() : ''
  const shape = typeof item.shape === 'string' ? item.shape.toLowerCase() : ''
  // ... rest of the code remains the same ...
  const isBox = itemType === 'box'
  const isBag = itemType === 'bag' || shape === 'bag' || shape === 'sack' || shape === 'bao'

  // Color based on properties (ưu tiên loại hàng)
  let color = 0x3498db // default khác
  if (isBag) {
    color = 0x27ae60 // bag: xanh lá
  } else if (isBox) {
    color = 0xe67e22 // box: cam
  }

  // Override theo thuộc tính đặc biệt
  if (item.isFragile) {
    color = 0xe74c3c // Red for fragile
  } else if (item.isHeavy) {
    color = 0x8e44ad // Purple for heavy
  } else if (item.priorityLevel && item.priorityLevel <= 3) {
    color = 0xf39c12 // Orange for high priority
  }

  // Nếu backend đã có layout chi tiết (manual hoặc auto) thì ưu tiên vẽ theo stackUnits
  if (Array.isArray(item.stackUnits) && item.stackUnits.length > 0) {
    renderItemFromStackUnits(item, pallet, color, pendingInbound, isCurrentInbound)
    return
  }

  if (isBox || isBag) {
    renderBoxItemAsCartons(item, pallet, color, pendingInbound, isCurrentInbound)
    return
  }

  const geometry = new THREE.BoxGeometry(item.length, item.height, item.width)
  const material = new THREE.MeshPhongMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)

  // Position relative to pallet (stack khối đơn giản nếu không có layout chi tiết)
  mesh.position.set(
    pallet.positionX + (item.positionX || 0) + item.length / 2,
    pallet.positionY + pallet.palletHeight + (item.positionY || 0) + item.height / 2,
    pallet.positionZ + (item.positionZ || 0) + item.width / 2
  )
  mesh.userData = { type: 'item', data: item, pendingInbound }
  mesh.name = `item_${item.itemId}`
  mesh.castShadow = true

  // Add edges for better visibility
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }))
  line.position.copy(mesh.position)
  line.userData = mesh.userData

  scene.add(mesh)
  scene.add(line)
}

// Render từ stackUnits (layout chi tiết từ InboundItemStackUnits)
// Lưu ý: số lượng khối được vẽ sẽ không vượt quá item.unitQuantity (tồn còn lại trên pallet).
const renderItemFromStackUnits = (
  item: any,
  pallet: any,
  color: number,
  pendingInbound = false,
  isCurrentInbound = false
) => {
  const allUnits = (item.stackUnits || []) as any[]
  if (!allUnits.length) return

  // Sử dụng unitQuantity (tồn còn lại) nếu có, ngược lại fallback = tổng số đơn vị layout
  let qty = Number(item.unitQuantity ?? 0) || 1

  const maxUnits = Math.min(allUnits.length, Math.max(0, Math.floor(qty)))
  if (maxUnits <= 0) return

  const units = allUnits.slice(0, maxUnits)

  // Trong layout inbound, localX/Z được tính tương đối so với tâm pallet, mặt đất = 0
  const palletCenterX = pallet.positionX + pallet.palletLength / 2
  const palletBaseY = pallet.positionY
  const palletCenterZ = pallet.positionZ + pallet.palletWidth / 2

  const palletRot = typeof pallet.rotationY === 'number' ? pallet.rotationY : 0
  const cos = Math.cos(palletRot)
  const sin = Math.sin(palletRot)

  const material = new THREE.MeshPhongMaterial({
    color,
    opacity: 0.95,
    transparent: true
  })
  const edgeColor = pendingInbound && isCurrentInbound ? 0xff0000 : 0x000000
  const edgeMaterial = new THREE.LineBasicMaterial({ color: edgeColor })

  units.forEach((u) => {
    const length = Number(u.length) || 0
    const width = Number(u.width) || 0
    const height = Number(u.height) || 0
    if (length <= 0 || width <= 0 || height <= 0) return

    const geometry = new THREE.BoxGeometry(length, height, width)
    const mesh = new THREE.Mesh(geometry, material)

    const localX = Number(u.localX || 0)
    const localZ = Number(u.localZ || 0)
    const rotatedX = localX * cos - localZ * sin
    const rotatedZ = localX * sin + localZ * cos

    mesh.position.set(
      palletCenterX + rotatedX,
      palletBaseY + Number(u.localY || 0),
      palletCenterZ + rotatedZ
    )
    const unitRot = Number(u.rotationY || 0)
    mesh.rotation.y = palletRot + unitRot
    mesh.userData = { type: 'item', data: item, pendingInbound }
    mesh.name = `item_${item.itemId}_unit_${u.unitIndex ?? 0}`
    mesh.castShadow = true

    const edgeGeo = new THREE.EdgesGeometry(geometry)
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMaterial)
    edgeLines.position.copy(mesh.position)
    edgeLines.rotation.copy(mesh.rotation)
    edgeLines.userData = mesh.userData
    edgeLines.name = `${mesh.name}_outline`

    scene.add(mesh)
    scene.add(edgeLines)
  })
}

const renderBoxItemAsCartons = (
  item: any,
  pallet: any,
  color: number,
  pendingInbound = false,
  isCurrentInbound = false
) => {
  const rawStackL = Number(item.length) || 0
  const rawStackW = Number(item.width) || 0
  const rawStackH = Number(item.height) || 0

  if (rawStackL <= 0 || rawStackW <= 0 || rawStackH <= 0) {
    return
  }

  const quantity = Math.max(1, Number(item.unitQuantity ?? 0) || 1)

  // Kích thước khối tổng của hàng trên pallet (đã được inbound/approval tính sẵn)
  const stackLength = rawStackL
  const stackWidth = rawStackW
  const stackHeight = rawStackH

  // Kích thước chuẩn 1 đơn vị (nếu có) từ product
  const stdL = (item.standardLength ?? null) as number | null
  const stdW = (item.standardWidth ?? null) as number | null

  // Bước 1: ước lượng kích thước 1 đơn vị trên mặt phẳng (L/W)
  let unitL = stdL && stdL > 0 ? stdL : 0
  let unitW = stdW && stdW > 0 ? stdW : 0

  // Nếu không có kích thước chuẩn, hoặc kích thước chuẩn gần bằng cả khối (khiến chỉ được 1 đơn vị/chiều)
  // thì suy ra kích thước đơn vị từ diện tích khối tổng và số lượng.
  if (!unitL || !unitW || unitL >= stackLength || unitW >= stackWidth) {
    const effectiveQty = Math.max(1, quantity)
    const area = Math.max(0.0001, stackLength * stackWidth)
    const unitArea = area / effectiveQty
    const aspect = stackLength > 0 && stackWidth > 0 ? stackLength / stackWidth : 1

    // Ước lượng L/W sao cho L*W ≈ unitArea và giữ tỉ lệ gần với tỉ lệ cạnh của pallet
    unitL = Math.sqrt(unitArea * aspect)
    unitW = Math.sqrt(unitArea / aspect)
  }

  // Bước 2: Tính số đơn vị tối đa trên 1 lớp theo 2 chiều
  const maxPerRow = Math.max(1, Math.floor(stackLength / unitL))
  const maxPerCol = Math.max(1, Math.floor(stackWidth / unitW))
  let perLayer = Math.max(1, maxPerRow * maxPerCol)

  // Nếu perLayer vẫn < 1 (do số liệu quá nhỏ) thì fallback tối thiểu 1
  if (perLayer < 1) perLayer = 1

  // Bước 3: Tính số tầng
  const layers = Math.max(1, Math.ceil(quantity / perLayer))

  // Kích thước thực tế của 1 thùng trên 3D (chia đều theo grid)
  const boxLength = stackLength / Math.max(1, maxPerRow)
  const boxWidth = stackWidth / Math.max(1, maxPerCol)
  const boxHeight = stackHeight / layers

  const geometry = new THREE.BoxGeometry(boxLength, boxHeight, boxWidth)
  const material = new THREE.MeshPhongMaterial({ color, flatShading: true })
  const edgesGeometry = new THREE.EdgesGeometry(geometry)
  const edgeColor = pendingInbound && isCurrentInbound ? 0xff0000 : 0x000000
  const edgeMaterial = new THREE.LineBasicMaterial({ color: edgeColor })

  const palletCenterX = pallet.positionX + pallet.palletLength / 2
  const palletCenterZ = pallet.positionZ + pallet.palletWidth / 2
  const baseY = pallet.positionY + pallet.palletHeight + (item.positionY || 0)

  const palletRot = typeof pallet.rotationY === 'number' ? pallet.rotationY : 0
  const cos = Math.cos(palletRot)
  const sin = Math.sin(palletRot)

  for (let idx = 0; idx < quantity; idx++) {
    const layer = Math.floor(idx / perLayer)
    const posInLayer = idx % perLayer
    const row = Math.floor(posInLayer / maxPerRow)
    const col = posInLayer % maxPerRow

    const mesh = new THREE.Mesh(geometry, material)

    const localBaseX = Number(item.positionX || 0)
    const localBaseZ = Number(item.positionZ || 0)

    const localX0 = localBaseX + boxLength * (col + 0.5) - pallet.palletLength / 2
    const localZ0 = localBaseZ + boxWidth * (row + 0.5) - pallet.palletWidth / 2

    const rotatedX = localX0 * cos - localZ0 * sin
    const rotatedZ = localX0 * sin + localZ0 * cos

    mesh.position.set(
      palletCenterX + rotatedX,
      baseY + boxHeight * (layer + 0.5),
      palletCenterZ + rotatedZ
    )
    mesh.userData = { type: 'item', data: item, pendingInbound }
    mesh.name = `item_${item.itemId}_carton`
    mesh.castShadow = true

    const edgeLines = new THREE.LineSegments(edgesGeometry, edgeMaterial)
    edgeLines.position.copy(mesh.position)
    edgeLines.userData = mesh.userData
    edgeLines.name = `${mesh.name}_outline`

    scene.add(mesh)
    scene.add(edgeLines)
  }
}

// Animation loop
const animate = () => {
  requestAnimationFrame(animate)

  // Hiệu ứng nhấp nháy rõ hơn cho pallet/hàng inbound đang chờ duyệt
  const time = performance.now() * 0.004
  const wave = 0.5 + 0.5 * Math.sin(time * 2.0)
  const blink = 0.4 + 0.6 * wave

  scene.traverse((obj) => {
    const ud: any = (obj as any).userData
    if (!ud || !ud.pendingInbound) return

    const mat = (obj as any).material as THREE.Material | THREE.Material[] | undefined
    if (!mat) return

    if (Array.isArray(mat)) {
      mat.forEach((m) => {
        if ((m as any).color) {
          const mm = m as any
          if (!mm.userData) mm.userData = {}
          if (mm.userData.__baseColor == null) {
            mm.userData.__baseColor = mm.color.clone()
          }
          const baseColor: THREE.Color = mm.userData.__baseColor
          mm.color.copy(baseColor).offsetHSL(0, 0, (blink - 1) * 0.35)
        }
        if ((m as any).transparent) {
          ;(m as any).opacity = blink
        }
      })
    } else {
      const m: any = mat
      if (m.color) {
        if (!m.userData) m.userData = {}
        if (m.userData.__baseColor == null) {
          m.userData.__baseColor = m.color.clone()
        }
        const baseColor: THREE.Color = m.userData.__baseColor
        m.color.copy(baseColor).offsetHSL(0, 0, (blink - 1) * 0.35)
      }
      if (m.transparent) {
        m.opacity = blink
      }
    }
  })

  controls.update()
  renderer.render(scene, camera)
}

// Drag & drop pallet inbound
const pickDraggablePallet = (event: PointerEvent): THREE.Object3D | null => {
  if (!container.value || !inboundMode.value) return null

  // Chỉ cho phép kéo pallet inbound hiện tại (pallet đang được duyệt)
  const current = currentInboundPallet.value
  if (!current) return null
  const currentId = Number(current.palletId)
  if (!Number.isFinite(currentId)) return null

  const rect = container.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(scene.children, true)
  if (!intersects.length) return null

  const hit = intersects.find((i) => {
    const ud: any = i.object.userData || {}
    if (ud.type !== 'pallet' || ud.pendingInbound !== true) return false
    const data = ud.data || {}
    const pid = Number(data.palletId)
    return Number.isFinite(pid) && pid === currentId
  })

  return hit ? hit.object : null
}

const onPointerDown = (event: PointerEvent) => {
  if (!inboundMode.value || !warehouseData.value) return

  const obj = pickDraggablePallet(event)
  if (!obj) return

  draggingPallet = obj
  draggingPalletData = obj.userData?.data
  isDragging = true

  const data = draggingPalletData

  // Xác định mặt phẳng kéo: nếu pallet đang ở trên tầng kệ thì kéo theo mặt phẳng tầng đó,
  // ngược lại kéo trên mặt đất (Y = 0).
  let planeY = 0
  if (data && data.shelfId != null) {
    const found = findShelfById(data.shelfId)
    if (found) {
      planeY = Number(found.shelf.positionY || 0)
    }
  }

  dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)

  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, camera)

  const planeIntersect = new THREE.Vector3()
  if (dragPlane && raycaster.ray.intersectPlane(dragPlane, planeIntersect)) {
    dragOffset.copy(planeIntersect).sub(draggingPallet.position)
  } else {
    dragOffset.set(0, 0, 0)
  }

  // Tạm thởi vô hiệu hóa điều khiển camera khi drag
  if (controls) {
    controls.enableRotate = false
    controls.enablePan = false
  }
}

const onPointerMove = (event: PointerEvent) => {
  if (!renderer || !container.value) return

  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)

  const intersects = raycaster.intersectObjects(scene.children, true)
  let hoverId: number | null = null
  for (const hit of intersects) {
    const ud: any = hit.object.userData
    if (ud && ud.type === 'outboundPath' && typeof ud.palletId === 'number') {
      hoverId = ud.palletId
      break
    }
  }
  if (hoverId !== hoveredOutboundPathPalletId.value) {
    hoveredOutboundPathPalletId.value = hoverId
    updateOutboundPathHighlight()
  }

  if (!isDragging || !draggingPallet || !dragPlane || !warehouseData.value) return

  const intersection = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3())

  if (!intersection) return

  if (!warehouseData.value) return

  const data = draggingPalletData
  if (!data) return

  const point = intersection.clone().sub(dragOffset)

  // Clamp trong phạm vi zone hoặc rack/tầng tương ứng
  const zone = warehouseData.value.zones?.find((z) => z.zoneId === data.zoneId)
  if (!zone) return

  let areaMinX = zone.positionX
  let areaMaxX = zone.positionX + zone.length
  let areaMinZ = zone.positionZ
  let areaMaxZ = zone.positionZ + zone.width

  // Nếu pallet đang ở trên tầng kệ thì giới hạn trong phạm vi rack chứa tầng đó
  if (data.shelfId != null) {
    const foundShelf = findShelfById(data.shelfId)
    if (foundShelf) {
      const rack = foundShelf.rack
      areaMinX = rack.positionX
      areaMaxX = rack.positionX + rack.length
      areaMinZ = rack.positionZ
      areaMaxZ = rack.positionZ + rack.width
    }
  }

  let targetX = point.x
  let targetZ = point.z

  // Snap theo grid
  if (palletGridStep > 0) {
    targetX = Math.round(targetX / palletGridStep) * palletGridStep
    targetZ = Math.round(targetZ / palletGridStep) * palletGridStep
  }

  // Tâm pallet và nửa kích thước
  const halfL = data.palletLength / 2
  const halfW = data.palletWidth / 2

  const minX = areaMinX + halfL
  const maxX = areaMaxX - halfL
  const minZ = areaMinZ + halfW
  const maxZ = areaMaxZ - halfW

  const clampedX = THREE.MathUtils.clamp(targetX, minX, maxX)
  const clampedZ = THREE.MathUtils.clamp(targetZ, minZ, maxZ)
  let finalX = clampedX
  let finalZ = clampedZ

  // Ngăn không cho pallet inbound chèn vào kệ / pallet khác
  const palletId = Number(data.palletId)
  if (Number.isFinite(palletId)) {
    const baseX = finalX - halfL
    const baseZ = finalZ - halfW
    const rotationY = typeof data.rotationY === 'number' ? data.rotationY : 0

    const collided =
      data.shelfId != null
        ? hasShelfCollision(
            palletId,
            data.zoneId,
            Number(data.shelfId),
            baseX,
            baseZ,
            data.palletLength,
            data.palletWidth,
            rotationY
          )
        : hasGroundCollision(
            palletId,
            data.zoneId,
            baseX,
            baseZ,
            data.palletLength,
            data.palletWidth,
            rotationY
          )

    if (collided) {
      return
    }
  }

  draggingPallet.position.set(finalX, draggingPallet.position.y, finalZ)
}

const onPointerUp = () => {
  if (!isDragging) return

  // Cập nhật lại inboundPendingPallets theo vị trí mới
  if (draggingPallet && draggingPalletData && inboundPendingPallets.value.length) {
    const centerX = draggingPallet.position.x
    const centerZ = draggingPallet.position.z

    const palletId = draggingPalletData.palletId as number

    inboundPendingPallets.value = inboundPendingPallets.value.map((p) => {
      if (p.palletId !== palletId) return p
      return {
        ...p,
        positionX: centerX - draggingPalletData.palletLength / 2,
        positionZ: centerZ - draggingPalletData.palletWidth / 2
      }
    })
  }

  draggingPallet = null
  draggingPalletData = null
  dragPlane = null
  isDragging = false

  if (controls) {
    controls.enableRotate = true
    controls.enablePan = true
  }

  // Re-render lại kho để pallet inbound và hàng hóa overlay được vẽ đúng theo vị trí mới
  renderWarehouse()
}

// Window resize handler
const onWindowResize = () => {
  if (!container.value) return
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

// Canvas click handler
const onCanvasClick = (event: MouseEvent) => {
  if (!container.value) return

  const mode = viewMode.value
  if (mode !== 'zones' && mode !== 'items' && mode !== 'pallets' && mode !== 'racks') {
    // Chỉ cho phép xem chi tiết khi người dùng đã chọn rõ chế độ xem
    return
  }

  const rect = container.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(scene.children, true)

  if (!intersects.length) return

  let typePriority: string[] = []
  if (mode === 'zones') {
    typePriority = ['zone']
  } else if (mode === 'items') {
    typePriority = ['item']
  } else if (mode === 'pallets') {
    // Ưu tiên hit pallet, nhưng nếu click trúng hàng trên pallet thì vẫn xử lý được
    typePriority = ['pallet', 'item']
  } else if (mode === 'racks') {
    typePriority = ['rack', 'shelf']
  }

  let targetUserData: any = null

  for (const t of typePriority) {
    const hit = intersects.find((i) => i.object.userData?.type === t)
    if (hit) {
      targetUserData = hit.object.userData
      break
    }
  }

  if (!targetUserData) return

  handleObjectClick(targetUserData)
}

// Handle object click
const handleObjectClick = (userData: any) => {
  selectedObject.value = userData.data

  if (userData.type === 'zone') {
    showZoneDetails(userData.data)
  } else if (userData.type === 'pallet') {
    const pallet = userData.data
    const palletId = Number(pallet?.palletId)

    // Nếu đây là pallet inbound đang chờ duyệt (preview), đồng bộ làm pallet đang duyệt
    if (
      inboundMode.value &&
      userData.pendingInbound === true &&
      Number.isFinite(palletId) &&
      inboundPendingPallets.value.length
    ) {
      const idx = inboundPendingPallets.value.findIndex((p) => p.palletId === palletId)
      // Không cho phép chọn lại pallet đã duyệt làm pallet đang thao tác
      if (idx !== -1 && !confirmedInboundPalletIds.value.includes(palletId)) {
        currentInboundIndex.value = idx
      }
    }

    // Ở chế độ outbound 3D, khi click pallet trong scene thì đồng bộ pallet đang chọn
    if (outbound3DMode.value && Number.isFinite(palletId)) {
      highlightedOutboundPalletId.value = palletId
      renderWarehouse()
    }

    showPalletDetails(userData.data)
  } else if (userData.type === 'rack') {
    showRackDetails(userData.data)
  } else if (userData.type === 'shelf') {
    const shelf = userData.data
    const rack = warehouseData.value?.racks?.find((r) => r.rackId === shelf.rackId)
    if (rack) {
      showRackDetails(rack)
    }
  } else if (userData.type === 'item') {
    // Ở chế độ xem pallet, click vào hàng cũng xem chi tiết pallet
    if (viewMode.value === 'pallets' && warehouseData.value) {
      const item = userData.data
      const pallet = warehouseData.value.pallets?.find((p) => p.palletId === item.palletId)
      if (pallet) {
        showPalletDetails(pallet)
        return
      }
    }

    showItemDetails(userData.data)
  }
}

const showZoneDetails = (zone: any) => {
  const zoneId = Number(zone.zoneId)
  if (Number.isFinite(zoneId) && zoneId > 0) {
    filterByZone.value = zoneId
    applyFilter()
  }

  const itemCount =
    warehouseData.value?.items?.filter((i) => {
      const pallet = warehouseData.value!.pallets?.find((p) => p.palletId === i.palletId)
      return pallet?.zoneId === zone.zoneId
    }).length || 0

  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Tên khu vực:</strong> ${zone.zoneName || `Zone ${zone.zoneId}`}</p>
      <p><strong>Loại:</strong> ${zone.zoneType}</p>
      <p><strong>Khách hàng:</strong> ${zone.customerName || 'Chưa phân bổ'}</p>
      <p><strong>Kích thước:</strong> ${zone.length}m × ${zone.width}m × ${zone.height}m</p>
      <p><strong>Vị trí:</strong> (${zone.positionX}, ${zone.positionY}, ${zone.positionZ})</p>
      <p><strong>Dung tích:</strong> ${(zone.length * zone.width * zone.height).toFixed(2)} m³</p>
      <p><strong>Số hàng hóa:</strong> ${itemCount} items</p>
    </div>
    `,
    `🏢 Chi tiết khu vực`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

const showRackDetails = (rack: any) => {
  const shelves = (rack.shelves || []) as any[]
  const totalLevels = shelves.length

  let spacingHtml = ''

  if (totalLevels > 0) {
    const sorted = [...shelves].sort((a, b) => {
      if (a.shelfLevel != null && b.shelfLevel != null) {
        return a.shelfLevel - b.shelfLevel
      }
      return Number(a.positionY || 0) - Number(b.positionY || 0)
    })

    const baseY = Number(rack.positionY || 0)
    spacingHtml += '<ul>'

    const first = sorted[0]
    const firstY = Number(first.positionY || 0)
    const gapBase = firstY - baseY
    if (!Number.isNaN(gapBase) && gapBase > 0) {
      spacingHtml += `<li>Từ nền kệ đến Tầng ${first.shelfLevel ?? 1}: ${gapBase.toFixed(2)} m</li>`
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]
      const next = sorted[i + 1]
      const y1 = Number(current.positionY || 0)
      const y2 = Number(next.positionY || 0)
      const gap = y2 - y1
      if (!Number.isNaN(gap) && gap > 0) {
        const level1 = current.shelfLevel ?? i + 1
        const level2 = next.shelfLevel ?? i + 2
        spacingHtml += `<li>Tầng ${level1} – Tầng ${level2}: ${gap.toFixed(2)} m</li>`
      }
    }

    const topRackY = baseY + Number(rack.height || 0)
    const last = sorted[sorted.length - 1]
    const lastY = Number(last.positionY || 0)
    const gapTop = topRackY - lastY
    if (!Number.isNaN(gapTop) && gapTop > 0) {
      const lastLevel = last.shelfLevel ?? totalLevels
      spacingHtml += `<li>Tầng ${lastLevel} – Đỉnh kệ: ${gapTop.toFixed(2)} m</li>`
    }

    spacingHtml += '</ul>'
  } else {
    spacingHtml = '<p>Chưa cấu hình tầng kệ.</p>'
  }

  const zone = warehouseData.value?.zones?.find((z) => z.zoneId === rack.zoneId)

  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Tên kệ:</strong> ${rack.rackName || `Kệ #${rack.rackId}`}</p>
      <p><strong>Khách hàng:</strong> ${zone?.customerName || 'Chưa phân bổ'}</p>
      <p><strong>Kích thước kệ:</strong> ${rack.length}m × ${rack.width}m × ${rack.height}m</p>
      <p><strong>Vị trí gốc (X, Y, Z):</strong> (${rack.positionX}, ${rack.positionY}, ${rack.positionZ})</p>
      <p><strong>Số tầng kệ:</strong> ${totalLevels}</p>
      <p><strong>Khoảng cách các tầng (theo chiều cao Y):</strong></p>
      ${spacingHtml}
    </div>
    `,
    `🗄️ Chi tiết Kệ`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

const showPalletDetails = (pallet: any) => {
  const items = warehouseData.value?.items?.filter((i) => i.palletId === pallet.palletId) || []

  palletDetail.value = pallet
  palletDetailItems.value = items
  showPalletQr.value = false

  if (pallet.palletQrContent && typeof pallet.palletQrContent === 'string') {
    palletQrText.value = pallet.palletQrContent
  } else {
    const qrLines: string[] = []
    qrLines.push(`Vị trí: (${pallet.positionX}, ${pallet.positionY}, ${pallet.positionZ})`)
    qrLines.push(
      `Kích thước pallet: ${pallet.palletLength}m × ${pallet.palletWidth}m × ${pallet.palletHeight}m`
    )
    qrLines.push('------------------')
    qrLines.push('Danh sách hàng trên pallet:')

    items.forEach((i) => {
      const unitSize =
        i.standardLength && i.standardWidth && i.standardHeight
          ? `${i.standardLength}m × ${i.standardWidth}m × ${i.standardHeight}m`
          : 'N/A'
      const stackSize = `${i.length}m × ${i.width}m × ${i.height}m`
      const qty = i.unitQuantity ?? null
      const qtyText = qty != null ? (i.unit ? `${qty} ${i.unit}` : `${qty}`) : 'N/A'
      const mfg = i.manufacturingDate || 'N/A'
      const exp = i.expiryDate || 'N/A'

      let weightText = ''
      const hasStdWeight = typeof i.standardWeight === 'number' && !Number.isNaN(i.standardWeight)
      const hasQty = typeof qty === 'number' && !Number.isNaN(qty)

      if (hasStdWeight && hasQty) {
        const totalWeight = Number(i.standardWeight) * Number(qty)
        if (Number.isFinite(totalWeight)) {
          weightText = `Trọng lượng: ${totalWeight} kg / Chuẩn: ${i.standardWeight} kg`
        }
      } else if (i.weight || i.standardWeight) {
        const parts: string[] = []
        if (i.weight != null) parts.push(`${i.weight} kg`)
        if (i.standardWeight != null) parts.push(`Chuẩn: ${i.standardWeight} kg`)
        weightText = `Trọng lượng: ${parts.join(' / ')}`
      }

      qrLines.push(`${i.productName || i.itemName || i.qrCode || 'Hàng hóa'}`)
      if (i.productCode) {
        qrLines.push(`Mã SP: ${i.productCode}`)
      }
      if (i.customerName) {
        qrLines.push(`Khách hàng: ${i.customerName}`)
      }
      qrLines.push(`Kích thước thùng (1 đơn vị): ${unitSize}`)
      qrLines.push(`Kích thước khối hàng trên pallet: ${stackSize}`)
      qrLines.push(`Số lượng đơn vị trên pallet: ${qtyText}`)
      if (weightText) {
        qrLines.push(weightText)
      }
      qrLines.push(`Ngày sản xuất: ${mfg}`)
      qrLines.push(`Hạn sử dụng: ${exp}`)
      if (i.productDescription) {
        qrLines.push(`Mô tả sản phẩm: ${i.productDescription}`)
      }
      if (i.storageConditions) {
        qrLines.push(`Lưu ý bảo quản: ${i.storageConditions}`)
      }
      if (i.unitPrice || i.totalAmount) {
        const unitPriceText = i.unitPrice != null ? i.unitPrice.toLocaleString() : ''
        const totalAmountText = i.totalAmount != null ? i.totalAmount.toLocaleString() : ''
        if (unitPriceText && totalAmountText) {
          qrLines.push(`Giá: ${unitPriceText} / đơn vị – Thành tiền: ${totalAmountText}`)
        } else if (unitPriceText) {
          qrLines.push(`Giá: ${unitPriceText} / đơn vị`)
        } else if (totalAmountText) {
          qrLines.push(`Thành tiền: ${totalAmountText}`)
        }
      }
      if (i.isFragile) {
        qrLines.push('⚠ Dễ vỡ')
      }
      if (i.isHeavy) {
        qrLines.push('⚠ Hàng nặng')
      }
      qrLines.push('')
    })

    palletQrText.value = qrLines.join('\n')
  }

  palletDetailVisible.value = true
}
const handleMarkOutboundPalletPickedFromList = async (palletId: number) => {
  if (!outbound3DMode.value) return
  if (!effectiveOutboundReceiptId.value) return
  if (!Number.isFinite(palletId)) return
  if (outboundPickedPalletIds.value.includes(palletId)) return

  try {
    await ElMessageBox.confirm(
      'Xác nhận pallet này đã được lấy ra khỏi kho?',
      'Xác nhận Đã lấy pallet',
      { type: 'warning' }
    )
  } catch {
    return
  }

  try {
    const res = await outboundApi.markPalletPicked(effectiveOutboundReceiptId.value, {
      palletId
    })
    if (res.statusCode === 200 || res.code === 0) {
      await reloadOutbound3DForCurrentReceipt()
      await loadOutboundPickingRequests()
      ElMessage.success('Đã đánh dấu pallet này là "Đã lấy" và tải lại dữ liệu 3D')
    } else {
      ElMessage.error(res.message || 'Không thể đánh dấu pallet đã lấy')
    }
  } catch {
    ElMessage.error('Lỗi khi đánh dấu pallet đã lấy')
  }
}

const focusCameraOnPallet = (palletId: number) => {
  if (!warehouseData.value || !camera || !controls) return

  const pallet = warehouseData.value.pallets?.find((p) => p.palletId === palletId)
  if (!pallet) return

  const centerX = pallet.positionX + pallet.palletLength / 2
  const centerY = pallet.positionY + pallet.palletHeight
  const centerZ = pallet.positionZ + pallet.palletWidth / 2

  const currentTarget = controls.target.clone()
  const offset = new THREE.Vector3().subVectors(camera.position, currentTarget)
  let distance = offset.length()
  if (!Number.isFinite(distance) || distance <= 0) {
    distance = Math.max(warehouseData.value.length, warehouseData.value.width) * 0.8
  }
  offset.normalize()

  camera.position.set(
    centerX + offset.x * distance,
    centerY + Math.abs(offset.y * distance),
    centerZ + offset.z * distance
  )
  controls.target.set(centerX, centerY, centerZ)
  controls.update()

  highlightedOutboundPalletId.value = palletId
  renderWarehouse()
}

const handleClickOutboundPalletRow = (p: { palletId: number }) => {
  if (!warehouseData.value) return
  const pallet = warehouseData.value.pallets?.find((pl) => pl.palletId === p.palletId)
  if (!pallet) return
  focusCameraOnPallet(p.palletId)
}

const showItemDetails = (item: any) => {
  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Tên hàng:</strong> ${item.itemName || 'N/A'}</p>
      <p><strong>QR Code:</strong> ${item.qrCode}</p>
      <p><strong>Loại:</strong> ${item.itemType}</p>
      <p><strong>Khách hàng:</strong> ${item.customerName}</p>
      <p><strong>Kích thước:</strong> ${item.length}m × ${item.width}m × ${item.height}m</p>
      <p><strong>Trọng lượng:</strong> ${item.weight} kg</p>
      <p><strong>Hình dạng:</strong> ${item.shape}</p>
      <p><strong>Mức ưu tiên:</strong> ${item.priorityLevel || 'N/A'}</p>
      ${item.isFragile ? '<p style="color: red;"><strong>⚠️ DỄ VỠ</strong></p>' : ''}
      ${item.isHeavy ? '<p style="color: purple;"><strong>⚠️ NẶNG</strong></p>' : ''}
    </div>
    `,
    `📦 Chi tiết Hàng Hóa`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

// UI controls
const changeViewMode = () => {
  renderWarehouse()
}

const resetViewMode = () => {
  viewMode.value = ''
  filterByCustomer.value = undefined
  showLabels.value = false
  const lockedId = lockedZoneIdFromQuery.value
  filterByZone.value = lockedId || undefined
  renderWarehouse()
}

const resetCamera = () => {
  if (!warehouseData.value) return
  const wh = warehouseData.value
  camera.position.set(wh.length * 0.8, wh.height * 1.5, wh.width * 1.2)
  controls.target.set(wh.length / 2, 0, wh.width / 2)
  controls.update()
}

const applyFilter = () => {
  renderWarehouse()
}

const getSelectedInboundPendingPallet = () => {
  if (!inboundMode.value) return null

  // Chỉ định rõ pallet đang được duyệt là pallet có thể thao tác
  const current = currentInboundPallet.value
  if (!current) return null

  const palletId = Number(current.palletId)
  if (!Number.isFinite(palletId)) return null

  return { pending: current, palletId }
}

const moveSelectedInboundPalletToGround = () => {
  if (!inboundMode.value) return
  if (!warehouseData.value) return

  const info = getSelectedInboundPendingPallet()
  if (!info) {
    ElMessage.warning('Vui lòng chọn một pallet inbound đang chờ duyệt trong khu vực 3D')
    return
  }

  const idx = inboundPendingPallets.value.findIndex((p) => p.palletId === info.palletId)
  if (idx === -1) return

  const pending = inboundPendingPallets.value[idx]

  if (!isBagPallet(pending.palletId)) {
    ElMessage.warning('Hàng thùng không được phép đặt dưới đất. Vui lòng đưa pallet lên kệ.')
    return
  }

  // Tìm vị trí đất gần nhất trong cùng zone mà không bị vướng bởi kệ/pallet khác
  const size = getPalletSizeForPalletId(pending.palletId)
  if (!size) {
    ElMessage.warning('Không xác định được kích thước pallet để đưa xuống đất')
    return
  }

  const zone = warehouseData.value.zones?.find((z) => z.zoneId === pending.zoneId)
  if (!zone) {
    ElMessage.warning('Không tìm thấy khu vực (zone) của pallet inbound')
    return
  }

  const length = size.length
  const width = size.width
  const halfL = length / 2
  const halfW = width / 2

  const rotationY = typeof pending.rotationY === 'number' ? pending.rotationY : 0

  const zoneMinX = zone.positionX
  const zoneMaxX = zone.positionX + zone.length
  const zoneMinZ = zone.positionZ
  const zoneMaxZ = zone.positionZ + zone.width

  const minBaseX = zoneMinX
  const maxBaseX = zoneMaxX - length
  const minBaseZ = zoneMinZ
  const maxBaseZ = zoneMaxZ - width

  if (maxBaseX < minBaseX || maxBaseZ < minBaseZ) {
    ElMessage.warning('Khu vực này không đủ diện tích để đặt pallet xuống đất')
    return
  }

  // Tâm pallet hiện tại (hoặc trên kệ) làm mốc để tìm vị trí đất gần nhất
  const currentCenterX = pending.positionX + halfL
  const currentCenterZ = pending.positionZ + halfW

  // Duyệt qua các "ô" mặt đất khả dụng trong zone, bước bằng kích thước pallet,
  // chọn ô gần nhất (theo khoảng cách từ tâm hiện tại) mà không va chạm với kệ/pallet khác.
  const stepX = length
  const stepZ = width

  let bestBaseX: number | null = null
  let bestBaseZ: number | null = null
  let bestDist2 = Number.POSITIVE_INFINITY

  for (let bx = minBaseX; bx <= maxBaseX + 1e-6; bx += stepX) {
    for (let bz = minBaseZ; bz <= maxBaseZ + 1e-6; bz += stepZ) {
      const centerX = bx + halfL
      const centerZ = bz + halfW
      const dx = centerX - currentCenterX
      const dz = centerZ - currentCenterZ
      const dist2 = dx * dx + dz * dz

      const collided = hasGroundCollision(
        pending.palletId,
        pending.zoneId,
        bx,
        bz,
        length,
        width,
        rotationY
      )

      if (!collided && dist2 < bestDist2 - 1e-9) {
        bestDist2 = dist2
        bestBaseX = bx
        bestBaseZ = bz
      }
    }
  }

  if (bestBaseX == null || bestBaseZ == null) {
    ElMessage.warning('Không còn vị trí đất trống phù hợp trong khu vực này')
    return
  }

  const updated = {
    ...pending,
    positionX: bestBaseX,
    positionY: 0,
    positionZ: bestBaseZ,
    isGround: true,
    shelfId: null
  }

  inboundPendingPallets.value.splice(idx, 1, updated)

  if (selectedObject.value && selectedObject.value.palletId === info.palletId) {
    selectedObject.value = {
      ...selectedObject.value,
      positionY: updated.positionY,
      shelfId: updated.shelfId,
      isGround: updated.isGround
    }
  }

  renderWarehouse()
}

const moveInboundPalletToNearestShelf = (preferHigher: boolean) => {
  if (!inboundMode.value) return
  if (!warehouseData.value) return

  const info = getSelectedInboundPendingPallet()
  if (!info) {
    ElMessage.warning('Vui lòng chọn một pallet inbound đang chờ duyệt trong khu vực 3D')
    return
  }

  const idx = inboundPendingPallets.value.findIndex((p) => p.palletId === info.palletId)
  if (idx === -1) return

  const pending = inboundPendingPallets.value[idx]

  const rotationY = typeof pending.rotationY === 'number' ? pending.rotationY : 0

  // Lấy kích thước pallet để kiểm tra phù hợp với chiều dài tầng kệ
  const size = getPalletSizeForPalletId(pending.palletId)
  if (!size) {
    ElMessage.warning('Không xác định được kích thước pallet để đưa lên/xuống tầng kệ')
    return
  }

  const length = size.length
  const width = size.width
  const halfL = length / 2
  const halfW = width / 2

  const stackHeights = getStackHeightsForPalletId(pending.palletId)
  const palletHeight = stackHeights ? stackHeights.palletHeight : 0
  const goodsHeight = stackHeights ? stackHeights.goodsHeight : 0

  const currentY = Number(pending.positionY || 0)

  const racksInZone = (warehouseData.value.racks || []).filter(
    (rack) => rack.zoneId === pending.zoneId
  )

  if (!racksInZone.length) {
    ElMessage.warning('Không tìm thấy kệ nào trong khu vực này')
    return
  }

  // Helper: kiểm tra chiều dài tầng/kệ có chứa được pallet không
  const canFitOnShelf = (rack: any, shelf: any) => {
    const usableLength = Number((shelf && (shelf as any).length) ?? rack.length ?? 0)
    if (!Number.isFinite(usableLength) || usableLength <= 0) {
      return false
    }
    if (length > usableLength) {
      return false
    }
    const clearHeight = getShelfClearHeightFrontend(rack, shelf)
    if ((palletHeight > 0 || goodsHeight > 0) && clearHeight > 0) {
      const totalHeight = palletHeight + goodsHeight
      if (totalHeight > clearHeight) {
        return false
      }
    }
    return true
  }

  // Tọa độ tâm pallet hiện tại (theo XZ) để đo khoảng cách đến các kệ
  const palletCenterX = pending.positionX + halfL
  const palletCenterZ = pending.positionZ + halfW

  const getRackDistance = (rack: any) => {
    const rackCenterX = Number(rack.positionX || 0) + Number(rack.length || 0) / 2
    const rackCenterZ = Number(rack.positionZ || 0) + Number(rack.width || 0) / 2
    const dx = rackCenterX - palletCenterX
    const dz = rackCenterZ - palletCenterZ
    return Math.sqrt(dx * dx + dz * dz)
  }

  type ShelfCandidate = {
    rack: any
    shelf: any
    shelfY: number
    deltaY: number
    distance: number
  }

  const sameRackCandidates: ShelfCandidate[] = []
  const edgeRackCandidates: ShelfCandidate[] = []

  // Xác định kệ hiện tại: nếu pallet đang ở trên kệ, dùng rack của kệ đó;
  // nếu pallet đang ở mặt đất thì chọn kệ gần nhất theo khoảng cách.
  let currentRack: any | null = null
  if (pending.shelfId != null) {
    const currentShelf = findShelfById(pending.shelfId)
    if (currentShelf) {
      currentRack = (warehouseData.value.racks || []).find(
        (r: any) => r.rackId === (currentShelf as any).rackId
      )
    }
  }

  if (!currentRack && racksInZone.length) {
    currentRack = racksInZone.reduce((best: any | null, rack: any) => {
      if (!best) return rack
      return getRackDistance(rack) < getRackDistance(best) ? rack : best
    }, null as any)
  }

  racksInZone.forEach((rack) => {
    const rawShelves = (rack.shelves || []) as any[]
    if (!rawShelves.length) return

    const shelves = rawShelves.filter((shelf) => {
      const shelfY = Number(shelf.positionY || 0)
      if (!Number.isFinite(shelfY)) return false
      if (!canFitOnShelf(rack, shelf)) return false
      // Nếu pallet đang ở sẵn trên một tầng kệ, không đưa chính tầng đó vào candidate
      if (pending.shelfId != null && shelf.shelfId === pending.shelfId) return false
      return true
    })

    if (!shelves.length) return

    const dist = getRackDistance(rack)
    const isCurrentRack = currentRack && rack.rackId === currentRack.rackId

    if (isCurrentRack) {
      // Bước 1: Ưu tiên tầng cao hơn/thấp hơn gần nhất trên chính kệ hiện tại
      shelves.forEach((shelf) => {
        const shelfY = Number(shelf.positionY || 0)
        const rawDeltaY = shelfY - currentY

        if (preferHigher && rawDeltaY > 0) {
          // Tầng cao hơn currentY trên cùng kệ
          sameRackCandidates.push({
            rack,
            shelf,
            shelfY,
            deltaY: rawDeltaY,
            distance: dist
          })
        } else if (!preferHigher && rawDeltaY < 0) {
          // Tầng thấp hơn currentY trên cùng kệ
          sameRackCandidates.push({
            rack,
            shelf,
            shelfY,
            deltaY: Math.abs(rawDeltaY),
            distance: dist
          })
        }
      })
    } else {
      // Bước 2: Fallback – nếu không tìm được trên kệ hiện tại thì xét
      //   - tầng cao nhất ở các kệ khác (khi đưa lên)
      //   - tầng thấp nhất ở các kệ khác (khi đưa xuống)
      let edgeShelf: any | null = null

      if (preferHigher) {
        // Tầng cao nhất
        edgeShelf = shelves.reduce((best: any | null, shelf: any) => {
          if (!best) return shelf
          const by = Number(best.positionY || 0)
          const sy = Number(shelf.positionY || 0)
          return sy > by ? shelf : best
        }, null as any)
      } else {
        // Tầng thấp nhất
        edgeShelf = shelves.reduce((best: any | null, shelf: any) => {
          if (!best) return shelf
          const by = Number(best.positionY || 0)
          const sy = Number(shelf.positionY || 0)
          return sy < by ? shelf : best
        }, null as any)
      }

      if (edgeShelf) {
        const shelfY = Number(edgeShelf.positionY || 0)
        const deltaY = Math.abs(shelfY - currentY)
        edgeRackCandidates.push({
          rack,
          shelf: edgeShelf,
          shelfY,
          deltaY,
          distance: dist
        })
      }
    }
  })

  // Sắp xếp theo |deltaY| tăng dần, sau đó theo khoảng cách trong mặt phẳng XZ
  const sortByHeightAndDistance = (a: ShelfCandidate, b: ShelfCandidate) => {
    const dy = a.deltaY - b.deltaY
    if (Math.abs(dy) > 1e-6) return dy
    return a.distance - b.distance
  }

  sameRackCandidates.sort(sortByHeightAndDistance)
  edgeRackCandidates.sort(sortByHeightAndDistance)

  if (!sameRackCandidates.length && !edgeRackCandidates.length) {
    ElMessage.warning('Không còn tầng kệ nào phù hợp (theo chiều dài) trong khu vực này')
    return
  }

  // Tìm vị trí trống trên từng tầng ứng viên (theo thứ tự ưu tiên), bắt đầu từ vị trí gần hiện tại nhất
  const findFreeSlotOnShelf = (cand: ShelfCandidate) => {
    const rack = cand.rack
    const shelf = cand.shelf

    const rackMinX = Number(rack.positionX || 0)
    const rackMaxX = rackMinX + Number(rack.length || 0)
    const rackMinZ = Number(rack.positionZ || 0)
    const rackMaxZ = rackMinZ + Number(rack.width || 0)

    if (!(rackMaxX > rackMinX && rackMaxZ > rackMinZ)) {
      return null
    }

    // Tâm pallet mong muốn trong rack, clamp để không vượt ra ngoài rack
    let centerX = palletCenterX
    let centerZ = palletCenterZ
    centerX = THREE.MathUtils.clamp(centerX, rackMinX + halfL, rackMaxX - halfL)
    centerZ = THREE.MathUtils.clamp(centerZ, rackMinZ + halfW, rackMaxZ - halfW)

    const shelfY = Number(shelf.positionY || 0)

    const scanStep = length > 0 ? length : palletGridStep || 0.1
    const minBaseX = rackMinX
    const maxBaseX = rackMaxX - length
    if (maxBaseX < minBaseX) {
      return null
    }

    const startBaseX = THREE.MathUtils.clamp(centerX - halfL, minBaseX, maxBaseX)
    const baseZ = centerZ - halfW

    const candidateBaseXs: number[] = []
    candidateBaseXs.push(startBaseX)

    // Quét sang trái/phải theo bước bằng chiều dài pallet để tìm ô trống
    for (let i = 1; i < 50; i++) {
      let added = false
      const left = startBaseX - i * scanStep
      if (left >= minBaseX - 1e-6) {
        candidateBaseXs.push(left)
        added = true
      }
      const right = startBaseX + i * scanStep
      if (right <= maxBaseX + 1e-6) {
        candidateBaseXs.push(right)
        added = true
      }
      if (!added) break
    }

    for (const baseX of candidateBaseXs) {
      const collided = hasShelfCollision(
        pending.palletId,
        pending.zoneId,
        shelf.shelfId,
        baseX,
        baseZ,
        length,
        width,
        rotationY
      )
      if (!collided) {
        return { baseX, baseZ, shelfY, shelf }
      }
    }

    return null
  }

  let chosen: {
    baseX: number
    baseZ: number
    shelfY: number
    shelf: any
  } | null = null

  // Bước 1: thử tất cả candidate trên cùng kệ hiện tại (nếu có)
  for (const cand of sameRackCandidates) {
    const pos = findFreeSlotOnShelf(cand)
    if (pos) {
      chosen = pos
      break
    }
  }

  // Bước 2: nếu không tìm được ô trống trên kệ hiện tại, thử các kệ khác (tầng cao nhất/thấp nhất)
  if (!chosen) {
    for (const cand of edgeRackCandidates) {
      const pos = findFreeSlotOnShelf(cand)
      if (pos) {
        chosen = pos
        break
      }
    }
  }

  if (!chosen) {
    ElMessage.warning('Không còn vị trí trống phù hợp trên các tầng kệ trong khu vực này')
    return
  }

  const updated = {
    ...pending,
    positionX: chosen.baseX,
    positionY: chosen.shelfY,
    positionZ: chosen.baseZ,
    isGround: false,
    shelfId: chosen.shelf.shelfId
  }

  inboundPendingPallets.value.splice(idx, 1, updated)

  if (selectedObject.value && selectedObject.value.palletId === info.palletId) {
    selectedObject.value = {
      ...selectedObject.value,
      positionX: updated.positionX,
      positionY: updated.positionY,
      positionZ: updated.positionZ,
      shelfId: updated.shelfId,
      isGround: updated.isGround
    }
  }

  renderWarehouse()
}

const moveSelectedInboundPalletToNearestShelf = () => {
  moveInboundPalletToNearestShelf(true)
}

const moveSelectedInboundPalletToNearestLowerShelf = () => {
  moveInboundPalletToNearestShelf(false)
}

const confirmCurrentInboundPalletAndNext = () => {
  if (!inboundMode.value || !inboundReceiptId.value) return

  if (!inboundPendingPallets.value.length) {
    ElMessage.error('Không có pallet inbound nào để duyệt')
    return
  }

  if (
    currentInboundIndex.value == null ||
    currentInboundIndex.value < 0 ||
    currentInboundIndex.value >= inboundPendingPallets.value.length
  ) {
    currentInboundIndex.value = 0
  }

  const current = currentInboundPallet.value
  if (!current) {
    ElMessage.warning('Không tìm thấy pallet đang duyệt')
    return
  }

  const id = current.palletId
  if (!confirmedInboundPalletIds.value.includes(id)) {
    confirmedInboundPalletIds.value.push(id)
  }

  const confirmedIds = confirmedInboundPalletIds.value
  const startIndex = currentInboundIndex.value ?? 0

  // Tìm pallet tiếp theo chưa được duyệt sau current index
  let nextIndex = inboundPendingPallets.value.findIndex(
    (p, idx) => idx > startIndex && !confirmedIds.includes(p.palletId)
  )

  // Nếu không còn pallet phía sau, thử tìm từ đầu danh sách
  if (nextIndex === -1) {
    nextIndex = inboundPendingPallets.value.findIndex((p) => !confirmedIds.includes(p.palletId))
  }

  if (nextIndex !== -1) {
    currentInboundIndex.value = nextIndex
  } else {
    // Không còn pallet nào chưa duyệt: bỏ chọn pallet hiện tại để ngăn thao tác tiếp
    currentInboundIndex.value = null
    ElMessage.success(
      'Đã duyệt qua tất cả pallet inbound. Bạn có thể bấm "Duyệt inbound tại zone" để hoàn tất.'
    )
  }

  // Cập nhật lại 3D ngay lập tức để viền đỏ và pallet đang thao tác chuyển sang pallet kế tiếp
  renderWarehouse()
}

const handleApproveInboundFrom3D = async () => {
  if (!inboundMode.value || !inboundReceiptId.value) return

  if (!inboundPendingPallets.value.length) {
    ElMessage.error('Không có pallet inbound nào để duyệt')
    return
  }

  if (!allInboundPalletsConfirmed.value) {
    ElMessage.warning(
      'Bạn cần duyệt từng pallet inbound (nhấn "Duyệt pallet hiện tại & sang pallet tiếp theo") trước khi hoàn tất.'
    )
    return
  }

  const layouts: PreferredPalletLayout[] = inboundPendingPallets.value.map((p) => ({
    palletId: p.palletId,
    zoneId: p.zoneId,
    shelfId: p.shelfId ?? undefined,
    positionX: p.positionX,
    positionZ: p.positionZ,
    rotationY: typeof p.rotationY === 'number' ? p.rotationY : 0
  }))

  const payload = {
    preferredLayouts: layouts,
    forceUsePreferredLayout: true
  }

  try {
    const res = await inboundApi.approveInboundRequest(inboundReceiptId.value, payload)
    if (res.statusCode === 200 || res.code === 0) {
      ElMessage.success('Duyệt yêu cầu nhập kho thành công')
      inboundPendingPallets.value = []
      push({ path: `/warehouse/${warehouseId.value}/3d-view` })
    } else {
      ElMessage.error(res.message || 'Không thể duyệt yêu cầu nhập kho từ 3D')
    }
  } catch (e) {
    ElMessage.error('Lỗi khi duyệt yêu cầu nhập kho từ 3D')
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'r' && event.key !== 'R') return
  const target = event.target as HTMLElement | null
  let isFormElement = false
  if (target) {
    const tag = target.tagName.toLowerCase()
    isFormElement =
      tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
  }

  // Chỉ áp dụng khi đang ở chế độ inbound 3D approval
  if (!inboundMode.value) return

  // Bỏ qua nếu đang gõ trong input/textarea/select hoặc contenteditable
  if (isFormElement) return

  event.preventDefault()
  rotateSelectedInboundPallet()
}

onMounted(async () => {
  if (outbound3DMode.value) {
    await loadWarehousesFor3D()
  }

  await loadWarehouse3DData()

  if (outbound3DMode.value) {
    await loadOutboundPickingRequests()
  }

  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', handleKeydown)
  if (renderer) {
    renderer.domElement.removeEventListener('click', onCanvasClick)
    if (container.value?.contains(renderer.domElement)) {
      container.value.removeChild(renderer.domElement)
    }
    renderer.dispose()
  }
})
</script>

<template>
  <ContentWrap :title="`Xem Kho 3D - ${warehouseData?.warehouseName || 'Loading...'}`">
    <template #header>
      <template v-if="inboundMode">
        <ElButton type="primary" @click="goBackFrom3D">
          <Icon icon="vi-ant-design:arrow-left-outlined" />
          Quay Lại
        </ElButton>
        <ElButton v-if="canViewInbound" @click="goToViewInbound">
          <Icon icon="vi-ant-design:unordered-list-outlined" />
          Xem Yêu Cầu Nhập Kho
        </ElButton>
      </template>
      <template v-else>
        <ElButton type="primary" @click="goBackFrom3D">
          <Icon icon="vi-ant-design:arrow-left-outlined" />
          Quay Lại
        </ElButton>
        <ElButton type="info" @click="push(`/warehouse/${warehouseId}/items`)">
          <Icon icon="vi-ant-design:inbox-outlined" />
          Hàng Hóa
        </ElButton>
        <ElButton type="warning" @click="push(`/warehouse/${warehouseId}/zones`)">
          <Icon icon="vi-ant-design:layout-outlined" />
          Khu Vực
        </ElButton>
        <ElButton v-if="canCreateInbound" type="primary" @click="goToCreateInbound">
          <Icon icon="vi-ant-design:plus-square-outlined" />
          Thêm Yêu Cầu Nhập Kho
        </ElButton>
        <ElButton v-if="canViewInbound" @click="goToViewInbound">
          <Icon icon="vi-ant-design:unordered-list-outlined" />
          Xem Yêu Cầu Nhập Kho
        </ElButton>
      </template>
    </template>

    <div class="warehouse-3d-viewer">
      <!-- Main Content -->
      <div class="main-content">
        <!-- Control Panel -->
        <ElCard class="control-panel" shadow="hover">
          <template #header>
            <span class="font-bold">Điều Khiển</span>
          </template>

          <div class="control-section">
            <h4>Chế độ xem</h4>
            <ElRadioGroup v-model="viewMode" size="small" @change="changeViewMode">
              <ElRadioButton value="zones">Khu vực</ElRadioButton>
              <ElRadioButton value="items">Hàng hóa</ElRadioButton>
              <ElRadioButton value="pallets">Pallet</ElRadioButton>
              <ElRadioButton value="racks">Kệ</ElRadioButton>
            </ElRadioGroup>
            <ElButton size="small" style="width: 100%; margin-top: 10px" @click="resetViewMode">
              <Icon icon="vi-ep:refresh-left" />
              Reset chế độ xem
            </ElButton>
          </div>

          <ElDivider />

          <div v-if="!outbound3DMode" class="control-section">
            <h4>Lọc khách hàng</h4>
            <ElSelect
              v-model="filterByCustomer"
              placeholder="Tất cả"
              size="small"
              clearable
              @change="applyFilter"
            >
              <ElOption
                v-for="customer in customers"
                :key="customer.id"
                :label="customer.name"
                :value="customer.id"
              />
            </ElSelect>
          </div>

          <div v-if="!outbound3DMode" class="control-section">
            <h4>Lọc theo khu vực (zone)</h4>
            <ElSelect
              v-model="filterByZone"
              placeholder="Tất cả khu vực"
              size="small"
              :clearable="!isZoneLockedFromQuery"
              @change="applyFilter"
            >
              <ElOption
                v-for="zone in zonesForFilter"
                :key="zone.id"
                :label="zone.name"
                :value="zone.id"
              />
            </ElSelect>
          </div>
          <ElDivider />

          <template v-if="outbound3DMode">
            <div class="control-section">
              <h4>Kho</h4>
              <ElSelect
                v-model="selectedWarehouseIdFor3D"
                placeholder="Chọn kho"
                size="small"
                style="width: 100%"
                :loading="loadingWarehousesFor3D"
                @change="handleWarehouseChange3D"
              >
                <ElOption
                  v-for="w in warehousesFor3D"
                  :key="w.warehouseId"
                  :label="w.warehouseName || `Kho #${w.warehouseId}`"
                  :value="w.warehouseId"
                />
              </ElSelect>
            </div>

            <ElDivider />

            <div class="control-section">
              <h4>Phiếu xuất đang lấy hàng</h4>
              <div v-if="!outboundPickingRequests.length" style="font-size: 13px; color: #909399">
                Không có phiếu xuất nào đang lấy hàng.
              </div>
              <ElSelect
                v-else
                v-model="selectedOutboundReceiptId"
                placeholder="Chọn phiếu xuất"
                size="small"
                style="width: 100%"
                @change="(val) => val && loadOutboundDataForReceipt(val)"
              >
                <ElOption
                  v-for="r in outboundPickingRequests"
                  :key="r.receiptId"
                  :label="r.receiptNumber"
                  :value="r.receiptId"
                />
              </ElSelect>
            </div>

            <template v-if="outboundDetail">
              <ElDivider />
              <div class="control-section">
                <h4>Pallet cần lấy trong phiếu xuất</h4>
                <div v-if="!outboundTargetPallets.length" style="font-size: 13px; color: #909399">
                  Không có pallet nào cần lấy.
                </div>
                <div v-else>
                  <div
                    v-for="p in outboundTargetPallets"
                    :key="p.palletId"
                    style="display: flex; gap: 6px; margin-bottom: 6px"
                  >
                    <ElButton
                      size="small"
                      class="no-margin-left-btn"
                      :type="
                        highlightedOutboundPalletId === p.palletId
                          ? 'primary'
                          : outboundPickedPalletIds.includes(p.palletId)
                            ? 'success'
                            : 'default'
                      "
                      :plain="!(highlightedOutboundPalletId === p.palletId)"
                      style="flex: 1; text-align: left"
                      @click="handleClickOutboundPalletRow(p)"
                    >
                      <span style="font-size: 13px">
                        <strong>Pallet #{{ p.palletId }}</strong>
                        <template v-if="p.hasPhysicalPallet">
                          -
                          <span
                            v-if="outboundPickedPalletIds.includes(p.palletId)"
                            class="status-picked"
                          >
                            Đã lấy
                          </span>
                          <span v-else class="status-pending">Chưa lấy</span>
                          -
                          {{ getOutboundPalletRequestedQty(p) }}
                        </template>
                        <template v-else>
                          -
                          <span class="status-picked">Đã hết</span>
                        </template>
                      </span>
                    </ElButton>
                  </div>
                </div>
              </div>
            </template>
          </template>

          <div class="control-section">
            <ElButton
              size="small"
              class="no-margin-left-btn"
              style="width: 100%; margin-top: 10px"
              @click="resetCamera"
            >
              <Icon icon="vi-ep:view" />
              Reset Camera
            </ElButton>
            <ElButton
              size="small"
              class="no-margin-left-btn"
              style="width: 100%; margin-top: 10px"
              type="primary"
              @click="loadWarehouse3DData"
              :loading="loading"
            >
              <Icon icon="vi-ep:refresh" />
              Làm mới
            </ElButton>
          </div>

          <ElDivider />

          <!-- Legend -->
          <div class="control-section">
            <h4>Chú thích màu sắc</h4>
            <div class="legend">
              <div class="legend-item">
                <div class="color-box" style="background: #e67e22"></div>
                <span>Pallet có hàng</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #bdc3c7"></div>
                <span>Pallet trống</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #e74c3c"></div>
                <span>Hàng dễ vỡ / Cổng ra (marker đỏ)</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #8e44ad"></div>
                <span>Hàng nặng</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #f39c12"></div>
                <span>Ưu tiên cao</span>
              </div>
              <div class="legend-item">
                <div class="color-box" style="background: #27ae60"></div>
                <span>Hàng bao / Vị trí checkin kho (marker xanh lá)</span>
              </div>
            </div>
          </div>
        </ElCard>

        <!-- 3D Canvas -->
        <div class="canvas-wrapper">
          <div v-loading="loading" ref="container" class="canvas-container"></div>

          <div
            v-if="outbound3DMode && canMarkOutboundPicked && highlightedOutboundPalletId !== null"
            class="outbound-actions-overlay"
          >
            <div class="outbound-status">
              Pallet đang chọn:
              <strong>#{{ highlightedOutboundPalletId }}</strong>
            </div>
            <div
              v-if="currentOutboundPalletItems.length"
              style=" margin: 6px 0 8px;font-size: 12px"
            >
              <div
                v-for="it in currentOutboundPalletItems"
                :key="it.outboundItemId || it.itemId"
                class="outbound-pallet-product"
              >
                <div>
                  <strong>
                    <span v-if="it.productCode">[{{ it.productCode }}] </span>
                    {{ it.productName || it.itemName || 'Hàng hóa' }}
                  </strong>
                </div>
                <div>
                  Số lượng yêu cầu:
                  <span v-if="it.quantity != null">{{ it.quantity }}</span>
                  <span v-if="it.unit"> {{ it.unit }}</span>
                </div>
              </div>
            </div>
            <ElButton
              size="small"
              type="success"
              class="no-margin-left-btn"
              style="width: 100%"
              :disabled="outboundPickedPalletIds.includes(highlightedOutboundPalletId as any)"
              @click="handleMarkOutboundPalletPickedFromList(highlightedOutboundPalletId as any)"
            >
              <Icon icon="vi-ant-design:check-circle-outlined" />
              Đã lấy hàng
            </ElButton>
          </div>

          <!-- Inbound actions inside 3D frame -->
          <div v-if="inboundMode" class="inbound-actions-overlay">
            <div class="inbound-status" style="margin-bottom: 8px; font-size: 12px">
              <div v-if="inboundPendingPallets.length">
                Pallet đang duyệt:
                <strong v-if="currentInboundPallet">#{{ currentInboundPallet.palletId }}</strong>
                <span v-else>Chưa bắt đầu</span>
              </div>
              <div v-if="inboundPendingPallets.length">
                Đã duyệt {{ confirmedInboundPalletIds.length }}/{{ inboundPendingPallets.length }}
                pallet
              </div>
            </div>
            <ElButton
              size="small"
              type="primary"
              class="no-margin-left-btn"
              style="width: 100%; margin-bottom: 8px"
              @click="confirmCurrentInboundPalletAndNext"
            >
              <Icon icon="vi-ant-design:step-forward-outlined" />
              Duyệt pallet hiện tại &amp; sang pallet tiếp theo
            </ElButton>
            <ElButton
              size="small"
              type="success"
              class="no-margin-left-btn"
              style="width: 100%; margin-bottom: 8px"
              :disabled="!allInboundPalletsConfirmed"
              @click="handleApproveInboundFrom3D"
            >
              <Icon icon="vi-ant-design:check-circle-outlined" />
              Duyệt inbound tại zone
            </ElButton>
            <ElButton
              size="small"
              type="primary"
              class="no-margin-left-btn"
              style="width: 100%; margin-bottom: 8px"
              @click="moveSelectedInboundPalletToGround"
            >
              <Icon icon="vi-ant-design:arrow-down-outlined" />
              Đưa pallet xuống đất
            </ElButton>
            <ElButton
              size="small"
              type="primary"
              plain
              class="no-margin-left-btn"
              style="width: 100%"
              @click="moveSelectedInboundPalletToNearestShelf"
            >
              <Icon icon="vi-ant-design:arrow-up-outlined" />
              Đưa pallet lên tầng gần nhất
            </ElButton>
            <ElButton
              size="small"
              type="primary"
              plain
              class="no-margin-left-btn"
              style="width: 100%; margin-top: 8px"
              @click="moveSelectedInboundPalletToNearestLowerShelf"
            >
              <Icon icon="vi-ant-design:arrow-down-outlined" />
              Đưa pallet xuống tầng gần nhất
            </ElButton>
          </div>

          <!-- Help Text -->
          <div class="help-text">
            <p>💡 <strong>Hướng dẫn:</strong></p>
            <p>• Click chuột trái để chọn đối tượng</p>
            <p>• Giữ chuột trái + kéo để xoay camera</p>
            <p>• Cuộn chuột để zoom in/out</p>
            <p>• Giữ chuột phải + kéo để di chuyển</p>
            <p>• Nhấn R để xoay pallet</p>
          </div>
        </div>
      </div>
    </div>

    <ElDialog
      v-model="palletDetailVisible"
      :title="palletDetail ? '📦 Chi tiết Pallet' : 'Chi tiết Pallet'"
      width="720px"
    >
      <div v-if="palletDetail" class="pallet-detail-dialog">
        <div class="pallet-detail-layout">
          <div class="pallet-detail-left">
            <div class="pallet-header">
              <div>
                <p>
                  <strong>Mã pallet:</strong>
                  {{ palletDetail.barcode || '#' + palletDetail.palletId }}
                </p>
                <p>
                  <strong>Vị trí:</strong>
                  ({{ palletDetail.positionX }}, {{ palletDetail.positionY }},
                  {{ palletDetail.positionZ }})
                </p>
                <p>
                  <strong>Kích thước pallet:</strong>
                  {{ palletDetail.palletLength }}m × {{ palletDetail.palletWidth }}m ×
                  {{ palletDetail.palletHeight }}m
                </p>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end">
                <ElButton
                  size="small"
                  type="primary"
                  plain
                  class="qr-toggle-btn"
                  @click="showPalletQr = !showPalletQr"
                >
                  <Icon
                    :icon="
                      showPalletQr ? 'vi-tdesign:chevron-left-s' : 'vi-tdesign:chevron-right-s'
                    "
                  />
                  <span class="qr-toggle-label">QR pallet</span>
                </ElButton>
              </div>
            </div>

            <ElDivider />

            <div v-if="palletDetailItems.length" class="pallet-items">
              <p><strong>Danh sách hàng trên pallet:</strong></p>
              <ul>
                <li v-for="item in palletDetailItems" :key="item.allocationId" class="pallet-item">
                  <strong>
                    {{ item.productName || item.itemName || item.qrCode || 'Hàng hóa' }}
                  </strong>
                  <div v-if="item.productCode">Mã SP: {{ item.productCode }}</div>
                  <div v-if="item.customerName">Khách hàng: {{ item.customerName }}</div>
                  <div>
                    Kích thước thùng (1 đơn vị):
                    <span v-if="item.standardLength && item.standardWidth && item.standardHeight">
                      {{ item.standardLength }}m × {{ item.standardWidth }}m ×
                      {{ item.standardHeight }}m
                    </span>
                    <span v-else>N/A</span>
                  </div>
                  <div>
                    Kích thước khối hàng trên pallet:
                    {{ item.length }}m × {{ item.width }}m × {{ item.height }}m
                  </div>
                  <div>
                    Số lượng đơn vị trên pallet:
                    <span v-if="item.unitQuantity != null">
                      {{ item.unitQuantity }}
                      <span v-if="item.unit">{{ item.unit }}</span>
                    </span>
                    <span v-else>N/A</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <transition name="fade">
            <div v-if="showPalletQr && palletQrText" class="pallet-detail-right">
              <p class="qr-panel-title"><strong>Mã QR pallet</strong></p>
              <div class="pallet-qr-code">
                <Qrcode :text="palletQrText" :width="200" />
              </div>
              <p class="qr-panel-hint">Quét mã để xem nhanh thông tin pallet.</p>
            </div>
          </transition>
        </div>
      </div>
    </ElDialog>
  </ContentWrap>
</template>

<style scoped lang="less">
.warehouse-3d-viewer {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 200px);
  min-height: 600px;
}

.main-content {
  flex: 1;
  display: flex;
  gap: 15px;
  overflow: hidden;
}

.no-margin-left-btn {
  margin-left: 0 !important;
}

.rotate-btn {
  font-weight: 600;
}

.control-panel {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;

  .control-section {
    margin-bottom: 12px;

    h4 {
      margin: 0 0 10px;
      font-size: 13px;
      font-weight: 600;
      color: #606266;
    }

    .el-radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;

      .el-radio-button {
        width: 100%;
      }
    }

    .el-checkbox {
      display: block;
      margin: 8px 0;
    }
  }

  .legend {
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 8px 0;
      font-size: 13px;

      .color-box {
        width: 24px;
        height: 24px;
        border: 1px solid #dcdfe6;
        border-radius: 4px;
        flex-shrink: 0;
      }
    }
  }
}

.canvas-wrapper {
  position: relative;
  overflow: hidden;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 10%);
  flex: 1;
}

.canvas-container {
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.outbound-actions-overlay {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 12;
  display: flex;
  max-width: 260px;
  min-width: 220px;
  padding: 8px 10px;
  background: rgb(255 255 255 / 96%);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgb(0 0 0 / 15%);
  flex-direction: column;
  gap: 6px;

  .outbound-status {
    font-size: 12px;
  }
}

.inbound-actions-overlay {
  position: absolute;
  bottom: 130px; // nằm ngay phía trên khối hướng dẫn (help-text)
  left: 20px;
  z-index: 12;
  display: flex;
  max-width: 260px;
  min-width: 220px;
  padding: 10px 12px;
  background: rgb(255 255 255 / 96%);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgb(0 0 0 / 15%);
  flex-direction: column;
  gap: 8px;
}

.pallet-detail-dialog {
  .pallet-detail-layout {
    display: flex;
    gap: 16px;
  }

  .pallet-detail-left {
    flex: 1 1 auto;
    min-width: 0;
  }

  .pallet-detail-right {
    display: flex;
    padding-left: 16px;
    border-left: 1px solid #ebeef5;
    flex: 0 0 240px;
    flex-direction: column;
    align-items: center;
  }

  .pallet-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }

  .qr-toggle-btn {
    display: inline-flex;
    align-items: center;
  }

  .qr-toggle-label {
    margin-left: 4px;
  }

  .pallet-items {
    max-height: 220px;
    overflow-y: auto;

    .pallet-item {
      margin-bottom: 8px;
    }
  }

  .pallet-qr-code {
    display: flex;
    margin-top: 8px;
    margin-bottom: 8px;
    justify-content: center;
  }

  .qr-panel-hint {
    font-size: 12px;
    color: #909399;
    text-align: center;
  }
}

.info-overlay {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 10;
  width: 320px;

  .info-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .info-content {
    p {
      margin: 6px 0;
      font-size: 14px;
      line-height: 1.6;
    }
  }
}

.help-text {
  position: absolute;
  bottom: 20px;
  left: 20px;
  max-width: 300px;
  padding: 15px 20px;
  font-size: 13px;
  background: rgb(255 255 255 / 95%);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgb(0 0 0 / 15%);

  p {
    margin: 5px 0;
    color: #606266;

    &:first-child {
      font-size: 14px;
      color: #409eff;
    }
  }
}

.font-bold {
  font-weight: bold;
}
</style>
