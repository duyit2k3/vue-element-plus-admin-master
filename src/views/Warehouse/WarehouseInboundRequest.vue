<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import {
  ElCard,
  ElRow,
  ElCol,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElTabs,
  ElTabPane,
  ElInput,
  ElInputNumber,
  ElDatePicker,
  ElTable,
  ElTableColumn,
  ElButton,
  ElMessage,
  ElRadioGroup,
  ElRadioButton,
  ElDialog
} from 'element-plus'
import { Icon } from '@/components/Icon'
import warehouseApi, { type WarehouseListItem, type WarehouseZone } from '@/api/warehouse'
import palletApi, {
  type PalletTemplate,
  type PalletViewModel,
  type CreatePalletRequest,
  type CreatePalletFromTemplateRequest
} from '@/api/pallet'
import productApi, { type ProductViewModel, type CreateProductRequest } from '@/api/product'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import inboundApi, {
  type InboundItemRequest,
  type CreateInboundRequestRequest,
  type InboundRequestListItem
} from '@/api/inbound'
import { useUserStore } from '@/store/modules/user'
import { useRoute } from 'vue-router'

const userStore = useUserStore()
const route = useRoute()

const queryWarehouseId = computed(() => {
  const raw = route.query.warehouseId
  if (!raw) return undefined
  const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
})

const queryZoneId = computed(() => {
  const raw = route.query.zoneId
  if (!raw) return undefined
  const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
})

const isZoneLockedFromQuery = computed(() => !!queryZoneId.value)

// Warehouse
const warehouses = ref<WarehouseListItem[]>([])
const selectedWarehouseId = ref<number | undefined>(undefined)
const selectedZoneId = ref<number | undefined>(undefined)
const selectedWarehouseKey = ref<string | undefined>(undefined)
const loadingWarehouses = ref(false)
const inboundRequests = ref<InboundRequestListItem[]>([])
const loadingInboundRequests = ref(false)
const customerZones = ref<WarehouseZone[]>([])

const loadWarehouses = async () => {
  loadingWarehouses.value = true
  try {
    const userInfo = userStore.getUserInfo
    if (!userInfo) {
      return
    }
    let res: any
    if (userInfo.role === 'customer') {
      res = await (warehouseApi as any).getWarehousesByCustomer(userInfo.accountId!)
    } else if (userInfo.role === 'warehouse_owner') {
      res = await warehouseApi.getWarehousesByOwner(userInfo.accountId!)
    } else {
      res = await warehouseApi.getAllWarehouses()
    }
    if (res && (res.statusCode === 200 || res.code === 0)) {
      warehouses.value = (res.data || []) as WarehouseListItem[]

      if (!selectedWarehouseKey.value && warehouses.value.length > 0) {
        const qWarehouseId = queryWarehouseId.value
        const qZoneId = queryZoneId.value

        let first: WarehouseListItem | undefined

        if (qWarehouseId && Number.isFinite(qWarehouseId)) {
          const byWarehouse = warehouses.value.filter((w) => w.warehouseId === qWarehouseId)
          if (byWarehouse.length > 0) {
            if (qZoneId && Number.isFinite(qZoneId)) {
              first =
                byWarehouse.find((w) => w.zoneId != null && w.zoneId === qZoneId) || byWarehouse[0]
            } else {
              first = byWarehouse[0]
            }
          }
        }

        if (!first) {
          first = warehouses.value[0]
        }

        selectedWarehouseKey.value = `${first.warehouseId}:${first.zoneId ?? 0}`
      }
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách kho')
  } finally {
    loadingWarehouses.value = false
  }
}

const visibleWarehouses = computed(() => {
  const list = warehouses.value
  const zid = queryZoneId.value
  const wid = queryWarehouseId.value

  if (zid) {
    const filtered = list.filter((w) => {
      if (w.zoneId == null) return false
      if (w.zoneId !== zid) return false
      if (wid && w.warehouseId !== wid) return false
      return true
    })

    if (filtered.length > 0) {
      return filtered
    }
  }

  return list
})

const loadInboundRequests = async () => {
  loadingInboundRequests.value = true
  try {
    const params: { warehouseId?: number; zoneId?: number } = {}
    if (selectedWarehouseId.value) {
      params.warehouseId = selectedWarehouseId.value
    }
    if (selectedZoneId.value) {
      params.zoneId = selectedZoneId.value
    }
    const res = await inboundApi.getInboundRequests(params)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      inboundRequests.value = (res.data || []) as InboundRequestListItem[]
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách yêu cầu nhập kho')
  } finally {
    loadingInboundRequests.value = false
  }
}

const loadCustomerZonesForSelectedWarehouse = async () => {
  customerZones.value = []
  if (!selectedWarehouseId.value) return
  const userInfo = userStore.getUserInfo
  if (!userInfo) return
  try {
    const res: any = await warehouseApi.getWarehouse3DData(selectedWarehouseId.value)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      const data = res.data as { zones?: WarehouseZone[] }
      const zones = data?.zones || []
      // 1 customer có thể có nhiều khu vực trong 1 kho, chỉ lấy các zone thuộc customer hiện tại
      customerZones.value = zones.filter((z) => z.customerId === userInfo.accountId)
    }
  } catch {
    // Nếu không tải được zones thì giữ nguyên danh sách sản phẩm (không filter cứng)
  }
}

// Pallet
const palletTab = ref<'template' | 'custom'>('template')
const palletTemplates = ref<PalletTemplate[]>([])
const createdPallets = ref<PalletViewModel[]>([])
const selectedPalletId = ref<number | undefined>(undefined)
const loadingPalletTemplates = ref(false)

const palletFromTemplateForm = reactive<{
  templateId: number | undefined
  barcode: string
  palletType: string
}>({
  templateId: undefined,
  barcode: '',
  palletType: ''
})

const customPalletForm = reactive<CreatePalletRequest>({
  barcode: '',
  length: 1,
  width: 1,
  height: 0.15,
  maxWeight: 1000,
  maxStackHeight: 1.5,
  palletType: ''
})

const loadPalletTemplates = async () => {
  loadingPalletTemplates.value = true
  try {
    const res = await palletApi.getTemplates()
    if (res && (res.statusCode === 200 || res.code === 0)) {
      palletTemplates.value = (res.data || []) as PalletTemplate[]
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách pallet template')
  } finally {
    loadingPalletTemplates.value = false
  }
}

const handleSelectPalletTemplate = (templateId: number) => {
  const tpl = palletTemplates.value.find((t) => t.templateId === templateId)
  if (tpl) {
    palletFromTemplateForm.palletType = tpl.palletType || ''
  }
}

const addCreatedPallet = (pallet: PalletViewModel) => {
  createdPallets.value.push(pallet)
  selectedPalletId.value = pallet.palletId
  ElMessage.success('Tạo pallet thành công')
}

const createPalletFromTemplate = async () => {
  if (!palletFromTemplateForm.templateId) {
    ElMessage.error('Vui lòng chọn template pallet')
    return
  }
  if (!palletFromTemplateForm.barcode) {
    ElMessage.error('Vui lòng nhập barcode pallet')
    return
  }
  const payload: CreatePalletFromTemplateRequest = {
    barcode: palletFromTemplateForm.barcode,
    palletType: palletFromTemplateForm.palletType || undefined
  }
  try {
    const res = await palletApi.createPalletFromTemplate(palletFromTemplateForm.templateId, payload)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      addCreatedPallet(res.data as PalletViewModel)
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo pallet từ template')
  }
}

const createCustomPallet = async () => {
  if (!customPalletForm.barcode) {
    ElMessage.error('Vui lòng nhập barcode pallet')
    return
  }
  if (!customPalletForm.length || !customPalletForm.width) {
    ElMessage.error('Chiều dài và chiều rộng pallet là bắt buộc')
    return
  }
  try {
    const res = await palletApi.createPallet(customPalletForm)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      addCreatedPallet(res.data as PalletViewModel)
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo pallet tùy chỉnh')
  }
}

// Product
const products = ref<ProductViewModel[]>([])
const selectedProductId = ref<number | undefined>(undefined)
const currentProductId = ref<number | undefined>(undefined)
const loadingProducts = ref(false)

const productForm = reactive<CreateProductRequest>({
  productCode: '',
  productName: '',
  description: '',
  unit: '',
  category: '',
  standardLength: undefined,
  standardWidth: undefined,
  standardHeight: undefined,
  standardWeight: undefined,
  isFragile: false,
  isHazardous: false,
  storageConditions: ''
})

const loadProducts = async () => {
  loadingProducts.value = true
  try {
    const res = await productApi.getAvailableProducts()
    if (res && (res.statusCode === 200 || res.code === 0)) {
      products.value = (res.data || []) as ProductViewModel[]
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách sản phẩm')
  } finally {
    loadingProducts.value = false
  }
}

const effectiveZones = computed(() => {
  if (selectedZoneId.value) {
    return customerZones.value.filter((z) => z.zoneId === selectedZoneId.value)
  }
  return customerZones.value
})

const hasAnyZone = computed(() => effectiveZones.value.length > 0)
const hasRackZone = computed(() =>
  effectiveZones.value.some((z) => (z.zoneType || '').toLowerCase() === 'rack')
)

const canStoreBag = computed(() => hasAnyZone.value)
const canStoreBox = computed(() => hasRackZone.value)

const getProductItemType = (p: ProductViewModel) => {
  const unitLower = (p.unit || '').toLowerCase()
  const categoryLower = (p.category || '').toLowerCase()
  const isBag = unitLower.includes('bao') || (!!categoryLower && categoryLower.includes('bao'))
  return isBag ? 'bag' : 'box'
}

const filteredProducts = computed(() => {
  // Nếu chưa có thông tin zone, tạm thời trả về toàn bộ products
  if (!hasAnyZone.value) {
    return products.value
  }

  return products.value.filter((p) => {
    const type = getProductItemType(p)
    if (type === 'box' && !canStoreBox.value) {
      return false
    }
    if (type === 'bag' && !canStoreBag.value) {
      return false
    }
    return true
  })
})

const handleSelectProduct = (productId: number) => {
  const p = products.value.find((x) => x.productId === productId)
  if (!p) return
  selectedProductId.value = productId
  currentProductId.value = productId
  productForm.productCode = p.productCode
  productForm.productName = p.productName
  productForm.description = p.description || ''
  productForm.unit = p.unit
  productForm.category = p.category || ''
  productForm.standardLength = p.standardLength || undefined
  productForm.standardWidth = p.standardWidth || undefined
  productForm.standardHeight = p.standardHeight || undefined
  productForm.standardWeight = p.standardWeight || undefined
  productForm.isFragile = p.isFragile ?? false
  productForm.isHazardous = p.isHazardous ?? false
  productForm.storageConditions = p.storageConditions || ''
}

const saveProductAsNew = async () => {
  if (!productForm.productCode || !productForm.productName || !productForm.unit) {
    ElMessage.error('Mã sản phẩm, tên và đơn vị là bắt buộc')
    return
  }
  try {
    const payload: CreateProductRequest = { ...productForm }
    const res = await productApi.createProduct(payload)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      const newProd = res.data as ProductViewModel
      products.value.push(newProd)
      selectedProductId.value = newProd.productId
      currentProductId.value = newProd.productId
      ElMessage.success('Tạo sản phẩm mới thành công')
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo sản phẩm mới')
  }
}

// Inbound items
type InboundItemWithDimensions = InboundItemRequest & {
  length?: number
  width?: number
  height?: number
}

const items = ref<InboundItemWithDimensions[]>([])

const stackMode = ref<'auto' | 'manual'>('auto')

type AutoStackTemplate = {
  id: string
  title: string
  subtitle: string
  description: string
}

const autoStackTemplates: AutoStackTemplate[] = [
  {
    id: 'straight',
    title: 'Mẫu gợi ý 1',
    subtitle: 'Cách xếp hệ thống đề xuất',
    description: 'Bố trí tự động phù hợp cho phần lớn hàng hóa.'
  },
  {
    id: 'brick',
    title: 'Mẫu gợi ý 2',
    subtitle: 'Biến thể tăng ổn định',
    description:
      'Một biến thể bố trí giúp tăng độ ổn định cho pallet khi xếp cao, phù hợp nhiều loại hàng.'
  },
  {
    id: 'cross',
    title: 'Mẫu gợi ý 3',
    subtitle: 'Biến thể khác',
    description: 'Một bố trí khác giúp tận dụng diện tích pallet trong một số trường hợp đặc thù.'
  }
]
const showAutoLayoutDialog = ref(false)
const selectedAutoLayoutId = ref<string | null>(autoStackTemplates[0]?.id ?? null)

const itemForm = reactive<{
  palletId: number | undefined
  quantity: number
  manufacturingDate: string
  expiryDate: string | undefined
  unitPrice: number
  totalAmount: number
  batchNumber: string
  length: number | undefined
  width: number | undefined
  height: number | undefined
}>({
  palletId: undefined,
  quantity: 1,
  manufacturingDate: '',
  expiryDate: undefined,
  unitPrice: 0,
  totalAmount: 0,
  batchNumber: '',
  length: undefined,
  width: undefined,
  height: undefined
})

watch(
  () => [itemForm.quantity, itemForm.unitPrice],
  () => {
    if (itemForm.quantity > 0 && itemForm.unitPrice > 0) {
      itemForm.totalAmount = Number((itemForm.quantity * itemForm.unitPrice).toFixed(2))
    }
  }
)

const syncSelectedWarehouse = () => {
  if (!selectedWarehouseKey.value) {
    selectedWarehouseId.value = undefined
    selectedZoneId.value = undefined
    return
  }

  const [widStr, zidStr] = selectedWarehouseKey.value.split(':')
  const wid = Number(widStr)
  const zid = Number(zidStr)

  selectedWarehouseId.value = Number.isFinite(wid) ? wid : undefined
  selectedZoneId.value = Number.isFinite(zid) && zid > 0 ? zid : undefined
}

watch(
  () => selectedWarehouseKey.value,
  () => {
    syncSelectedWarehouse()
    loadInboundRequests()
    loadCustomerZonesForSelectedWarehouse()
  }
)

type AutoPreviewContext = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
}

type BlockDims = {
  length: number
  width: number
  height: number
}

const autoPreviewContainers = ref<Record<string, HTMLDivElement | null>>({})
const autoPreviewContexts: Record<string, AutoPreviewContext | undefined> = {}
const autoPreviewBlockDims = ref<Record<string, BlockDims>>({})
let autoPreviewAnimationId: number | null = null

const setAutoPreviewContainer = (id: string, el: unknown) => {
  autoPreviewContainers.value[id] = (
    el instanceof HTMLDivElement ? el : null
  ) as HTMLDivElement | null
}

const initAutoPreviewScenes = () => {
  const previewItem = items.value[0]
  if (!previewItem) return

  const pallet = createdPallets.value.find((p) => p.palletId === previewItem.palletId)
  const product = products.value.find((p) => p.productId === previewItem.productId)
  if (!pallet || !product) return

  const itemType = getProductItemType(product)
  const isBag = itemType === 'bag'

  const palletLength = pallet.length
  const palletWidth = pallet.width
  const palletHeight = pallet.height
  const qty = Math.max(1, previewItem.quantity)

  autoPreviewBlockDims.value = {}

  autoStackTemplates.forEach((tpl) => {
    const container = autoPreviewContainers.value[tpl.id]
    if (!container) return

    const width = container.clientWidth || 260
    const height = container.clientHeight || 200

    const existing = autoPreviewContexts[tpl.id]
    if (existing) {
      existing.renderer.dispose()
      container.innerHTML = ''
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf0f0f0)

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(2, 2, 2)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    container.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05

    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(5, 10, 5)
    scene.add(dir)

    const grid = new THREE.GridHelper(5, 20, 0x888888, 0xcccccc)
    scene.add(grid)

    const palletGeo = new THREE.BoxGeometry(palletLength, palletHeight, palletWidth)
    const palletMat = new THREE.MeshStandardMaterial({ color: 0xf39c12 })
    const palletMesh = new THREE.Mesh(palletGeo, palletMat)
    palletMesh.position.set(0, palletHeight / 2, 0)
    palletMesh.receiveShadow = true
    palletMesh.castShadow = true
    scene.add(palletMesh)

    // Viền pallet
    const palletEdgeGeo = new THREE.EdgesGeometry(palletGeo)
    const palletEdgeMat = new THREE.LineBasicMaterial({ color: 0x000000 })
    const palletEdges = new THREE.LineSegments(palletEdgeGeo, palletEdgeMat)
    palletEdges.position.copy(palletMesh.position)
    scene.add(palletEdges)

    const baseL = product.standardLength || 1
    const baseW = product.standardWidth || 1
    const baseH = product.standardHeight || 1
    const gapRatio = 0.96

    const unitL = baseL
    const unitW = baseW
    const unitH = isBag ? baseH * 0.6 : baseH

    const unitGeo = new THREE.BoxGeometry(unitL * gapRatio, unitH, unitW * gapRatio)
    const unitMat = new THREE.MeshStandardMaterial({
      color: isBag ? 0x27ae60 : 0xe67e22,
      opacity: 0.95,
      transparent: true
    })

    const maxPerRow = Math.max(1, Math.floor(palletLength / unitL))
    const maxPerCol = Math.max(1, Math.floor(palletWidth / unitW))
    const perLayer = Math.max(1, maxPerRow * maxPerCol)

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let maxTop = Number.NEGATIVE_INFINITY

    const pattern = tpl.id

    for (let idx = 0; idx < qty; idx++) {
      const layer = Math.floor(idx / perLayer)
      const posInLayer = idx % perLayer
      const row = Math.floor(posInLayer / maxPerRow)
      const col = posInLayer % maxPerRow

      let dx = 0
      let rotY = 0

      if (pattern === 'brick') {
        dx = layer % 2 === 1 ? unitL / 2 : 0
      } else if (pattern === 'cross') {
        if ((row + col) % 2 === 1) {
          rotY = Math.PI / 2
        }
      }

      const xStart = -palletLength / 2 + unitL / 2
      const zStart = -palletWidth / 2 + unitW / 2

      let x = xStart + col * unitL + dx
      const z = zStart + row * unitW
      const y = palletHeight + unitH / 2 + layer * unitH

      const halfPalL = palletLength / 2
      const halfPalW = palletWidth / 2
      const halfL = unitL / 2
      const halfW = unitW / 2
      x = Math.min(halfPalL - halfL, Math.max(-halfPalL + halfL, x))
      const clampedZ = Math.min(halfPalW - halfW, Math.max(-halfPalW + halfW, z))

      const minUx = x - halfL
      const maxUx = x + halfL
      const minUz = clampedZ - halfW
      const maxUz = clampedZ + halfW

      if (minUx < minX) minX = minUx
      if (maxUx > maxX) maxX = maxUx
      if (minUz < minZ) minZ = minUz
      if (maxUz > maxZ) maxZ = maxUz

      const top = y + unitH / 2
      if (top > maxTop) maxTop = top

      const mesh = new THREE.Mesh(unitGeo, unitMat)
      mesh.position.set(x, y, clampedZ)
      mesh.rotation.y = rotY
      scene.add(mesh)

      const edgeGeo = new THREE.EdgesGeometry(unitGeo)
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000 })
      const edges = new THREE.LineSegments(edgeGeo, edgeMat)
      edges.position.copy(mesh.position)
      edges.rotation.copy(mesh.rotation)
      scene.add(edges)
    }

    camera.position.set(2, 2, 2)
    camera.lookAt(0, palletHeight, 0)

    autoPreviewContexts[tpl.id] = { scene, camera, renderer, controls }

    const blockLength =
      Number.isFinite(maxX) && Number.isFinite(minX) && maxX > minX ? maxX - minX : baseL
    const blockWidth =
      Number.isFinite(maxZ) && Number.isFinite(minZ) && maxZ > minZ ? maxZ - minZ : baseW
    const blockHeight =
      Number.isFinite(maxTop) && maxTop > palletHeight ? maxTop - palletHeight : baseH

    autoPreviewBlockDims.value[tpl.id] = {
      length: blockLength,
      width: blockWidth,
      height: blockHeight
    }
  })

  if (autoPreviewAnimationId === null) {
    animateAutoPreviews()
  }
}

const animateAutoPreviews = () => {
  const contexts = Object.values(autoPreviewContexts)
  if (!contexts.length) return
  autoPreviewAnimationId = requestAnimationFrame(animateAutoPreviews)
  contexts.forEach((ctx) => {
    if (!ctx) return
    if (ctx.controls) ctx.controls.update()
    ctx.renderer.render(ctx.scene, ctx.camera)
  })
}

const openAutoLayoutPreview = async () => {
  if (!items.value.length) {
    ElMessage.error('Chưa có hàng nào trong yêu cầu để xem bố trí trên pallet')
    return
  }
  showAutoLayoutDialog.value = true
  await nextTick()
  initAutoPreviewScenes()
}

const handleSelectAutoTemplate = (id: string) => {
  selectedAutoLayoutId.value = id
}

onBeforeUnmount(() => {
  if (autoPreviewAnimationId !== null) {
    cancelAnimationFrame(autoPreviewAnimationId)
    autoPreviewAnimationId = null
  }
  Object.values(autoPreviewContexts).forEach((ctx) => {
    if (!ctx) return
    if (ctx.controls) ctx.controls.dispose()
    ctx.renderer.dispose()
  })
})

const productNameMap = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  products.value.forEach((p) => {
    map[p.productId] = p.productName
  })
  return map
})

const currentPallet = computed<PalletViewModel | undefined>(() => {
  return createdPallets.value.find((p) => p.palletId === selectedPalletId.value)
})

const quantityLabel = computed(() => {
  return productForm.unit ? `Số lượng (${productForm.unit})` : 'Số lượng'
})

const addItemToList = () => {
  if (!selectedWarehouseId.value) {
    ElMessage.error('Vui lòng chọn kho')
    return
  }
  const palletId = selectedPalletId.value
  if (!palletId) {
    ElMessage.error('Vui lòng tạo và chọn pallet')
    return
  }
  if (!currentProductId.value) {
    ElMessage.error('Vui lòng chọn hoặc tạo sản phẩm')
    return
  }
  if (!itemForm.manufacturingDate) {
    ElMessage.error('Vui lòng chọn ngày sản xuất')
    return
  }
  if (itemForm.quantity <= 0 || itemForm.unitPrice <= 0 || itemForm.totalAmount <= 0) {
    ElMessage.error('Số lượng, đơn giá và thành tiền phải lớn hơn 0')
    return
  }

  if (items.value.some((it) => it.palletId === palletId)) {
    ElMessage.error('Mỗi pallet chỉ được thêm một hàng hóa trong một yêu cầu')
    return
  }

  const payload: InboundItemWithDimensions = {
    palletId,
    productId: currentProductId.value,
    quantity: itemForm.quantity,
    manufacturingDate: itemForm.manufacturingDate,
    expiryDate: itemForm.expiryDate || undefined,
    unitPrice: itemForm.unitPrice,
    totalAmount: itemForm.totalAmount,
    batchNumber: itemForm.batchNumber || undefined,
    length: itemForm.length,
    width: itemForm.width,
    height: itemForm.height
  }

  items.value.push(payload)

  // Reset một phần form cho lần nhập tiếp theo
  itemForm.quantity = 1
  itemForm.manufacturingDate = ''
  itemForm.expiryDate = undefined
  itemForm.unitPrice = 0
  itemForm.totalAmount = 0
  itemForm.batchNumber = ''
}

const removeItem = (index: number) => {
  items.value.splice(index, 1)
}

// Submit inbound request
const notes = ref('')
const submitting = ref(false)

const submitRequest = async () => {
  if (!selectedWarehouseId.value) {
    ElMessage.error('Vui lòng chọn kho')
    return
  }
  if (items.value.length === 0) {
    ElMessage.error('Vui lòng thêm ít nhất một hàng hóa')
    return
  }
  const payload: CreateInboundRequestRequest = {
    warehouseId: selectedWarehouseId.value,
    zoneId: selectedZoneId.value,
    items: items.value,
    notes: notes.value || undefined,
    stackMode: stackMode.value,
    autoStackTemplate:
      stackMode.value === 'auto'
        ? (selectedAutoLayoutId.value as 'straight' | 'brick' | 'cross' | null)
        : undefined
  }
  submitting.value = true
  try {
    const res = await inboundApi.createInboundRequest(payload)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      const data: any = res.data || {}
      ElMessage.success(
        `Tạo yêu cầu nhập kho thành công. Mã phiếu: ${data.receiptNumber || data.ReceiptNumber || ''}`
      )
      items.value = []
      notes.value = ''
      selectedPalletId.value = undefined
      createdPallets.value = []
      palletFromTemplateForm.templateId = undefined
      palletFromTemplateForm.barcode = ''
      palletFromTemplateForm.palletType = ''
      customPalletForm.barcode = ''
      customPalletForm.length = 1
      customPalletForm.width = 1
      customPalletForm.height = 0.15
      customPalletForm.maxWeight = 1000
      customPalletForm.maxStackHeight = 1.5
      customPalletForm.palletType = ''
      showAutoLayoutDialog.value = false
      selectedAutoLayoutId.value = null
      // Reload danh sách yêu cầu nhập kho phía dưới
      await loadInboundRequests()
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo yêu cầu nhập kho')
  } finally {
    submitting.value = false
  }
}

const handleSubmitClick = async () => {
  if (!selectedWarehouseId.value) {
    ElMessage.error('Vui lòng chọn kho')
    return
  }
  if (items.value.length === 0) {
    ElMessage.error('Vui lòng thêm ít nhất một hàng hóa')
    return
  }

  if (stackMode.value === 'auto') {
    await openAutoLayoutPreview()
  } else {
    await submitRequest()
  }
}

onMounted(() => {
  loadWarehouses()
  loadPalletTemplates()
  loadProducts()
})
</script>

<template>
  <div class="inbound-request">
    <!-- Bước 1: Chọn kho -->
    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">1. Chọn kho</span>
        </div>
      </template>
      <ElForm label-width="140px">
        <ElFormItem label="Kho" required>
          <ElSelect
            v-model="selectedWarehouseKey"
            placeholder="Chọn kho đã thuê"
            :loading="loadingWarehouses"
            filterable
            :clearable="!isZoneLockedFromQuery"
          >
            <ElOption
              v-for="w in visibleWarehouses"
              :key="w.zoneId ?? w.warehouseId"
              :label="
                w.zoneName
                  ? `${w.warehouseName || `Kho #${w.warehouseId}`} - ${w.zoneName}`
                  : w.warehouseName || `Kho #${w.warehouseId}`
              "
              :value="`${w.warehouseId}:${w.zoneId ?? 0}`"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
    </ElCard>

    <!-- Bước 2 + 3: Pallet & Product -->
    <ElRow :gutter="20" class="mb-20px">
      <!-- Pallet -->
      <ElCol :xs="24" :md="12">
        <ElCard shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="text-lg font-bold">2. Chọn / tạo pallet</span>
            </div>
          </template>
          <ElTabs v-model="palletTab">
            <ElTabPane label="Từ template" name="template">
              <ElForm label-width="140px">
                <ElFormItem label="Template" required>
                  <ElSelect
                    v-model="palletFromTemplateForm.templateId"
                    placeholder="Chọn template pallet"
                    :loading="loadingPalletTemplates"
                    filterable
                    @change="handleSelectPalletTemplate"
                  >
                    <ElOption
                      v-for="tpl in palletTemplates"
                      :key="tpl.templateId"
                      :label="tpl.templateName"
                      :value="tpl.templateId"
                    />
                  </ElSelect>
                </ElFormItem>
                <ElFormItem label="Barcode" required>
                  <ElInput
                    v-model="palletFromTemplateForm.barcode"
                    placeholder="Mã barcode pallet"
                  />
                </ElFormItem>
                <ElFormItem label="Loại pallet">
                  <ElInput v-model="palletFromTemplateForm.palletType" placeholder="Loại pallet" />
                </ElFormItem>
                <ElFormItem>
                  <ElButton type="primary" @click="createPalletFromTemplate">
                    <Icon icon="vi-ant-design:plus-square-outlined" />
                    Tạo pallet từ template
                  </ElButton>
                </ElFormItem>
              </ElForm>
            </ElTabPane>
            <ElTabPane label="Tùy chỉnh" name="custom">
              <ElForm label-width="140px">
                <ElFormItem label="Barcode" required>
                  <ElInput v-model="customPalletForm.barcode" placeholder="Mã barcode pallet" />
                </ElFormItem>
                <ElFormItem label="Kích thước pallet (m)" required>
                  <div class="inline-inputs dims-group">
                    <div class="dim-field">
                      <span class="dim-label">Chiều dài (L)</span>
                      <ElInputNumber v-model="customPalletForm.length" :min="0.01" :step="0.1" />
                    </div>
                    <div class="dim-field">
                      <span class="dim-label">Chiều rộng (W)</span>
                      <ElInputNumber v-model="customPalletForm.width" :min="0.01" :step="0.1" />
                    </div>
                    <div class="dim-field">
                      <span class="dim-label">Chiều cao (H)</span>
                      <ElInputNumber v-model="customPalletForm.height" :min="0.01" :step="0.01" />
                    </div>
                  </div>
                </ElFormItem>
                <ElFormItem label="Tải trọng tối đa (kg)">
                  <ElInputNumber v-model="customPalletForm.maxWeight" :min="0.01" :step="10" />
                </ElFormItem>
                <ElFormItem label="Chiều cao xếp chồng (m)">
                  <ElInputNumber
                    v-model="customPalletForm.maxStackHeight"
                    :min="0.01"
                    :step="0.1"
                  />
                </ElFormItem>
                <ElFormItem label="Loại pallet">
                  <ElInput v-model="customPalletForm.palletType" placeholder="Loại pallet" />
                </ElFormItem>
                <ElFormItem>
                  <ElButton type="primary" @click="createCustomPallet">
                    <Icon icon="vi-ant-design:plus-square-outlined" />
                    Tạo pallet tùy chỉnh
                  </ElButton>
                </ElFormItem>
              </ElForm>
            </ElTabPane>
          </ElTabs>

          <div v-if="createdPallets.length" class="mt-10">
            <div class="text-sm mb-5">Pallet đã tạo:</div>
            <ElSelect v-model="selectedPalletId" placeholder="Chọn pallet để sử dụng" filterable>
              <ElOption
                v-for="p in createdPallets"
                :key="p.palletId"
                :label="`${p.barcode} (${p.length}×${p.width}×${p.height}m)`"
                :value="p.palletId"
              />
            </ElSelect>
          </div>
        </ElCard>
      </ElCol>

      <!-- Product -->
      <ElCol :xs="24" :md="12">
        <ElCard shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="text-lg font-bold">3. Chọn / tạo sản phẩm</span>
            </div>
          </template>
          <ElForm label-width="140px">
            <ElFormItem label="Mẫu sản phẩm">
              <ElSelect
                v-model="selectedProductId"
                placeholder="Chọn sản phẩm có sẵn"
                :loading="loadingProducts"
                filterable
                @change="handleSelectProduct"
              >
                <ElOption
                  v-for="p in filteredProducts"
                  :key="p.productId"
                  :label="`${p.productCode} - ${p.productName}`"
                  :value="p.productId"
                />
              </ElSelect>
            </ElFormItem>
            <ElFormItem>
              <div class="text-gray text-sm">
                Lưu ý: Nếu bạn chỉnh sửa thông tin mẫu sản phẩm bên dưới, vui lòng bấm
                <strong>"Lưu thành sản phẩm mới"</strong> trước khi thêm hàng vào yêu cầu. Nếu
                không, phiếu inbound sẽ sử dụng thông tin của sản phẩm cũ đã lưu.
              </div>
            </ElFormItem>
            <ElFormItem label="Mã sản phẩm" required>
              <ElInput v-model="productForm.productCode" />
            </ElFormItem>
            <ElFormItem label="Tên sản phẩm" required>
              <ElInput v-model="productForm.productName" />
            </ElFormItem>
            <ElFormItem label="Mô tả">
              <ElInput v-model="productForm.description" type="textarea" :rows="2" />
            </ElFormItem>
            <ElFormItem label="Đơn vị" required>
              <ElInput v-model="productForm.unit" />
            </ElFormItem>
            <ElFormItem label="Danh mục">
              <ElInput v-model="productForm.category" />
            </ElFormItem>
            <ElFormItem label="Kích thước chuẩn SP (m)">
              <div class="inline-inputs dims-group">
                <div class="dim-field">
                  <span class="dim-label">Chiều dài (L)</span>
                  <ElInputNumber v-model="productForm.standardLength" :min="0.01" :step="0.1" />
                </div>
                <div class="dim-field">
                  <span class="dim-label">Chiều rộng (W)</span>
                  <ElInputNumber v-model="productForm.standardWidth" :min="0.01" :step="0.1" />
                </div>
                <div class="dim-field">
                  <span class="dim-label">Chiều cao (H)</span>
                  <ElInputNumber v-model="productForm.standardHeight" :min="0.01" :step="0.01" />
                </div>
              </div>
            </ElFormItem>
            <ElFormItem label="Trọng lượng chuẩn (kg)">
              <ElInputNumber v-model="productForm.standardWeight" :min="0.01" :step="0.1" />
            </ElFormItem>
            <ElFormItem label="Dễ vỡ / Nguy hiểm">
              <div class="inline-inputs">
                <label class="checkbox-label">
                  <input v-model="productForm.isFragile" type="checkbox" />
                  <span class="ml-5">Dễ vỡ</span>
                </label>
                <label class="checkbox-label ml-20">
                  <input v-model="productForm.isHazardous" type="checkbox" />
                  <span class="ml-5">Nguy hiểm</span>
                </label>
              </div>
            </ElFormItem>
            <ElFormItem label="Điều kiện lưu trữ">
              <ElInput v-model="productForm.storageConditions" />
            </ElFormItem>
            <ElFormItem>
              <ElButton type="primary" @click="saveProductAsNew">
                <Icon icon="vi-ant-design:save-outlined" />
                Lưu thành sản phẩm mới
              </ElButton>
            </ElFormItem>
          </ElForm>
        </ElCard>
      </ElCol>
    </ElRow>

    <!-- Bước 4: Thêm items và gửi yêu cầu -->
    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">4. Thêm hàng hóa vào yêu cầu</span>
        </div>
      </template>

      <ElForm label-width="180px" class="mb-20px">
        <ElFormItem label="Pallet sử dụng" required>
          <div class="product-summary">
            <span v-if="currentPallet">
              {{ currentPallet.barcode }}
              ({{ currentPallet.length }}×{{ currentPallet.width }}×{{ currentPallet.height }}m)
            </span>
            <span v-else class="text-gray">Chưa tạo hoặc chọn pallet</span>
          </div>
        </ElFormItem>
        <ElFormItem label="Sản phẩm" required>
          <div class="product-summary">
            <span v-if="currentProductId">
              {{ productNameMap[currentProductId] || 'Sản phẩm đã chọn' }}
            </span>
            <span v-else class="text-gray">Chưa chọn sản phẩm</span>
          </div>
        </ElFormItem>
        <ElFormItem label="Cách xếp hàng" required>
          <div>
            <ElRadioGroup v-model="stackMode">
              <ElRadioButton label="auto">Hệ thống gợi ý cách xếp</ElRadioButton>
              <ElRadioButton label="manual">Bạn tự xếp trên pallet</ElRadioButton>
            </ElRadioGroup>
          </div>
        </ElFormItem>
        <ElRow :gutter="20">
          <ElCol :xs="24" :md="12">
            <ElFormItem :label="quantityLabel" required>
              <ElInputNumber v-model="itemForm.quantity" :min="1" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :md="12">
            <ElFormItem label="Số lô">
              <ElInput v-model="itemForm.batchNumber" />
            </ElFormItem>
          </ElCol>
        </ElRow>
        <ElRow :gutter="20">
          <ElCol :xs="24" :md="12">
            <ElFormItem label="Ngày sản xuất" required>
              <ElDatePicker
                v-model="itemForm.manufacturingDate"
                type="date"
                placeholder="Chọn ngày sản xuất"
                value-format="YYYY-MM-DD"
              />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :md="12">
            <ElFormItem label="Ngày hết hạn">
              <ElDatePicker
                v-model="itemForm.expiryDate"
                type="date"
                placeholder="Chọn ngày hết hạn (nếu có)"
                value-format="YYYY-MM-DD"
              />
            </ElFormItem>
          </ElCol>
        </ElRow>
        <ElRow :gutter="20">
          <ElCol :xs="24" :md="12">
            <ElFormItem label="Đơn giá (VNĐ)" required>
              <ElInputNumber v-model="itemForm.unitPrice" :min="0.01" :step="1000" />
            </ElFormItem>
          </ElCol>
          <ElCol :xs="24" :md="12">
            <ElFormItem label="Thành tiền (VNĐ)" required>
              <ElInputNumber v-model="itemForm.totalAmount" :min="0.01" :step="1000" />
            </ElFormItem>
          </ElCol>
        </ElRow>
        <ElFormItem>
          <ElButton type="primary" @click="addItemToList">
            <Icon icon="vi-ant-design:plus-circle-outlined" />
            Thêm vào danh sách hàng hóa
          </ElButton>
        </ElFormItem>
      </ElForm>

      <ElTable v-if="items.length" :data="items" border size="small">
        <ElTableColumn type="index" label="#" width="60" />
        <ElTableColumn prop="palletId" label="Pallet" width="100" />
        <ElTableColumn label="Sản phẩm">
          <template #default="scope">
            {{ productNameMap[scope.row.productId] || scope.row.productId }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="quantity" label="Số lượng" width="100" />
        <ElTableColumn prop="manufacturingDate" label="Ngày SX" width="120" />
        <ElTableColumn prop="expiryDate" label="Ngày HH" width="120" />
        <ElTableColumn prop="unitPrice" label="Đơn giá" width="120" />
        <ElTableColumn prop="totalAmount" label="Thành tiền" width="140" />
        <ElTableColumn prop="batchNumber" label="Số lô" width="140" />
        <ElTableColumn label="Thao tác" width="100">
          <template #default="scope">
            <ElButton type="danger" text size="small" @click="removeItem(scope.$index)">
              Xóa
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-else class="text-gray text-sm">Chưa có hàng hóa nào trong yêu cầu.</div>
    </ElCard>

    <ElCard shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Hoàn tất yêu cầu</span>
        </div>
      </template>
      <ElForm label-width="140px">
        <ElFormItem label="Ghi chú">
          <ElInput v-model="notes" type="textarea" :rows="3" />
        </ElFormItem>
        <ElFormItem>
          <ElButton type="primary" :loading="submitting" @click="handleSubmitClick">
            <Icon icon="vi-ant-design:send-outlined" />
            Gửi yêu cầu nhập kho
          </ElButton>
        </ElFormItem>
      </ElForm>
    </ElCard>

    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Danh sách yêu cầu nhập kho</span>
          <ElButton
            text
            type="primary"
            :loading="loadingInboundRequests"
            @click="loadInboundRequests"
          >
            <Icon icon="vi-ep:refresh" />
            Làm mới
          </ElButton>
        </div>
      </template>
      <ElTable
        v-if="inboundRequests.length"
        :data="inboundRequests"
        border
        size="small"
        v-loading="loadingInboundRequests"
      >
        <ElTableColumn prop="receiptNumber" label="Mã phiếu" width="180" />
        <ElTableColumn prop="warehouseName" label="Kho" min-width="200" />
        <ElTableColumn label="Khu vực" min-width="160">
          <template #default="{ row }">
            <span v-if="row.zoneName">
              {{ row.zoneName }}
              <span v-if="row.zoneId">(#{{ row.zoneId }})</span>
            </span>
            <span v-else-if="row.zoneId">Zone #{{ row.zoneId }}</span>
            <span v-else class="text-gray">—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="inboundDate" label="Ngày yêu cầu" width="160" />
        <ElTableColumn prop="status" label="Trạng thái" width="120" />
        <ElTableColumn prop="totalItems" label="Số hàng" width="100" />
        <ElTableColumn prop="totalPallets" label="Số pallet" width="110" />
        <ElTableColumn prop="createdByName" label="Người tạo" min-width="180" />
      </ElTable>
      <div v-else class="text-gray text-sm">Chưa có yêu cầu nhập kho nào.</div>
    </ElCard>

    <ElDialog
      v-model="showAutoLayoutDialog"
      title="Chọn kiểu xếp do hệ thống gợi ý"
      width="70%"
      top="5vh"
    >
      <div class="auto-layout-grid">
        <div
          v-for="tpl in autoStackTemplates"
          :key="tpl.id"
          :class="['auto-layout-card', { 'is-selected': tpl.id === selectedAutoLayoutId }]"
          @click="handleSelectAutoTemplate(tpl.id)"
        >
          <div class="auto-layout-card__header">
            <span class="auto-layout-card__title">{{ tpl.title }}</span>
          </div>
          <div
            class="auto-layout-card__canvas"
            :ref="(el) => setAutoPreviewContainer(tpl.id, el)"
          ></div>
          <div class="auto-layout-card__info">
            <div class="auto-layout-card__dims" v-if="autoPreviewBlockDims[tpl.id]">
              <strong>Kích thước khối hàng trên pallet (L×W×H):</strong>
              {{ autoPreviewBlockDims[tpl.id].length.toFixed(2) }} ×
              {{ autoPreviewBlockDims[tpl.id].width.toFixed(2) }} ×
              {{ autoPreviewBlockDims[tpl.id].height.toFixed(2) }} m
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <ElButton @click="showAutoLayoutDialog = false">Hủy</ElButton>
        <ElButton type="primary" :loading="submitting" @click="submitRequest">
          Tạo yêu cầu với kiểu xếp này
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped lang="less">
.inbound-request {
  padding: 20px;
}

.mb-20px {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.inline-inputs {
  display: flex;
  align-items: center;
}

.dims-group {
  gap: 16px;
  flex-wrap: wrap;
}

.dim-field {
  display: flex;
  flex-direction: column;
}

.dim-label {
  margin-bottom: 4px;
  font-size: 12px;
  color: #909399;
}

.mx-5 {
  margin: 0 5px;
}

.ml-5 {
  margin-left: 5px;
}

.ml-20 {
  margin-left: 20px;
}

.mt-10 {
  margin-top: 10px;
}

.text-gray {
  color: #909399;
}

.product-summary {
  display: flex;
  min-height: 24px;
  align-items: center;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
}

.auto-layout-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.auto-layout-card {
  padding: 16px;
  color: #f9fafb;
  cursor: pointer;
  background: #1f2937;
  border: 2px solid transparent;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 35%);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}

.auto-layout-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgb(0 0 0 / 50%);
}

.auto-layout-card.is-selected {
  border-color: #facc15;
  box-shadow: 0 0 0 2px rgb(250 204 21 / 65%);
}

.auto-layout-card__header {
  margin-bottom: 8px;
}

.auto-layout-card__title {
  display: block;
  font-size: 16px;
  font-weight: 700;
}

.auto-layout-card__canvas {
  width: 100%;
  height: 200px;
  overflow: hidden;
  background: #111827;
  border-radius: 8px;
}
</style>
