<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import {
  ElCard,
  ElSelect,
  ElOption,
  ElButton,
  ElTag,
  ElRadioGroup,
  ElRadioButton,
  ElDivider,
  ElCheckbox,
  ElMessage,
  ElMessageBox
} from 'element-plus'
import { Icon } from '@/components/Icon'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import warehouseApi, { type Warehouse3DData } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'

const userStore = useUserStore()
const container = ref<HTMLDivElement>()
const warehouseData = ref<Warehouse3DData | null>(null)
const loading = ref(false)
const selectedWarehouseId = ref(1)

// 3D Scene variables
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2

// UI State
const viewMode = ref<'overview' | 'zones' | 'items'>('overview')
const selectedZone = ref<any>(null)
const selectedItem = ref<any>(null)
const showGrid = ref(true)
const showLabels = ref(true)
const filterByCustomer = ref<number | undefined>(undefined)

// Statistics
const stats = computed(() => {
  if (!warehouseData.value) return null

  const totalZones = warehouseData.value.zones?.length || 0
  const totalRacks = warehouseData.value.racks?.length || 0
  const totalPallets = warehouseData.value.pallets?.length || 0
  const totalItems = warehouseData.value.items?.length || 0

  const occupiedPallets =
    warehouseData.value.pallets?.filter((p) =>
      warehouseData.value!.items?.some((i) => i.palletId === p.palletId)
    ).length || 0

  const occupancyRate = totalPallets > 0 ? ((occupiedPallets / totalPallets) * 100).toFixed(1) : '0'

  return {
    totalZones,
    totalRacks,
    totalPallets,
    totalItems,
    occupiedPallets,
    occupancyRate
  }
})

// Customer list for filter
const customers = computed(() => {
  if (!warehouseData.value?.zones) return []
  const customerMap = new Map()
  warehouseData.value.zones.forEach((zone) => {
    if (zone.customerId && zone.customerName) {
      customerMap.set(zone.customerId, zone.customerName)
    }
  })
  return Array.from(customerMap.entries()).map(([id, name]) => ({ id, name }))
})

const loadWarehouse3DData = async () => {
  loading.value = true
  try {
    const response = await warehouseApi.getWarehouse3DData(selectedWarehouseId.value)
    if (response.data) {
      warehouseData.value = response.data
      initScene()
      renderWarehouse()
    }
  } catch (error: any) {
    ElMessage.error(error.message || 'Không thể tải dữ liệu kho')
  } finally {
    loading.value = false
  }
}

const initScene = () => {
  if (!container.value) return

  // Scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)
  scene.fog = new THREE.Fog(0xf0f0f0, 50, 200)

  // Camera
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
  camera.position.set(30, 30, 30)
  camera.lookAt(0, 0, 0)

  // Renderer
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
  controls.minDistance = 5
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI / 2

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(20, 30, 20)
  directionalLight.castShadow = true
  directionalLight.shadow.camera.left = -50
  directionalLight.shadow.camera.right = 50
  directionalLight.shadow.camera.top = 50
  directionalLight.shadow.camera.bottom = -50
  scene.add(directionalLight)

  // Grid
  if (showGrid.value) {
    const gridHelper = new THREE.GridHelper(100, 100, 0x888888, 0xcccccc)
    gridHelper.name = 'gridHelper'
    scene.add(gridHelper)
  }

  // Raycaster for mouse interaction
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // Event listeners
  window.addEventListener('resize', onWindowResize)
  renderer.domElement.addEventListener('click', onMouseClick)
  renderer.domElement.addEventListener('mousemove', onMouseMove)

  animate()
}

const renderWarehouse = () => {
  if (!warehouseData.value) return

  // Clear previous objects
  scene.children = scene.children.filter(
    (child) =>
      child instanceof THREE.AmbientLight ||
      child instanceof THREE.DirectionalLight ||
      child.name === 'gridHelper'
  )

  // Render warehouse boundary
  renderWarehouseBoundary()

  // Render zones
  warehouseData.value.zones?.forEach((zone) => {
    if (filterByCustomer.value === null || zone.customerId === filterByCustomer.value) {
      renderZone(zone)
    }
  })

  // Render racks
  warehouseData.value.racks?.forEach((rack) => {
    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === rack.zoneId)
    if (!zone || (filterByCustomer.value !== null && zone.customerId !== filterByCustomer.value))
      return
    renderRack(rack)
  })

  // Render pallets
  warehouseData.value.pallets?.forEach((pallet) => {
    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
    if (!zone || (filterByCustomer.value !== null && zone.customerId !== filterByCustomer.value))
      return
    renderPallet(pallet)
  })

  // Render items
  if (viewMode.value === 'items') {
    warehouseData.value.items?.forEach((item) => {
      const pallet = warehouseData.value!.pallets?.find((p) => p.palletId === item.palletId)
      if (!pallet) return
      const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
      if (!zone || (filterByCustomer.value !== null && zone.customerId !== filterByCustomer.value))
        return
      renderItem(item, pallet)
    })
  }
}

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

const renderZone = (zone: any) => {
  const geometry = new THREE.BoxGeometry(zone.length, zone.height, zone.width)

  // Color by customer or zone type
  let color = 0x3498db
  if (zone.customerId) {
    // Generate color based on customer ID
    const hue = (zone.customerId * 137.5) % 360
    color = new THREE.Color(`hsl(${hue}, 70%, 60%)`).getHex()
  }

  const material = new THREE.MeshPhongMaterial({
    color: color,
    transparent: true,
    opacity: 0.2,
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

  // Add edges
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x2c3e50 }))
  line.position.copy(mesh.position)

  scene.add(mesh)
  scene.add(line)

  // Add label
  if (showLabels.value) {
    addLabel(
      zone.zoneName || `Zone ${zone.zoneId}`,
      mesh.position.clone().add(new THREE.Vector3(0, zone.height / 2 + 1, 0))
    )
  }
}

const renderRack = (rack: any) => {
  const geometry = new THREE.BoxGeometry(rack.length, rack.height, rack.width)
  const material = new THREE.MeshPhongMaterial({
    color: 0x95a5a6,
    transparent: false
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    rack.positionX + rack.length / 2,
    rack.positionY + rack.height / 2,
    rack.positionZ + rack.width / 2
  )
  mesh.userData = { type: 'rack', data: rack }
  mesh.name = `rack_${rack.rackId}`

  // Add edges
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x34495e }))
  line.position.copy(mesh.position)

  scene.add(mesh)
  scene.add(line)
}

const renderPallet = (pallet: any) => {
  const geometry = new THREE.BoxGeometry(
    pallet.palletLength,
    pallet.palletHeight,
    pallet.palletWidth
  )

  // Check if pallet has items
  const hasItems = warehouseData.value!.items?.some((i) => i.palletId === pallet.palletId)
  const color = hasItems ? 0xe67e22 : 0xecf0f1

  const material = new THREE.MeshPhongMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    pallet.positionX + pallet.palletLength / 2,
    pallet.positionY + pallet.palletHeight / 2,
    pallet.positionZ + pallet.palletWidth / 2
  )
  mesh.userData = { type: 'pallet', data: pallet }
  mesh.name = `pallet_${pallet.palletId}`
  mesh.castShadow = true
  mesh.receiveShadow = true

  scene.add(mesh)
}

const renderItem = (item: any, pallet: any) => {
  const geometry = new THREE.BoxGeometry(item.length, item.height, item.width)

  // Color by priority or fragility
  let color = 0x27ae60
  if (item.isFragile) color = 0xe74c3c
  else if (item.isHeavy) color = 0x8e44ad
  else if (item.priorityLevel === 'high') color = 0xf39c12

  const material = new THREE.MeshPhongMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    pallet.positionX + item.positionX + item.length / 2,
    pallet.positionY + pallet.palletHeight + item.positionY + item.height / 2,
    pallet.positionZ + item.positionZ + item.width / 2
  )
  mesh.userData = { type: 'item', data: item }
  mesh.name = `item_${item.itemId}`
  mesh.castShadow = true

  scene.add(mesh)
}

const addLabel = (_text: string, _position: THREE.Vector3) => {
  // Simplified label - in production, use CSS2DRenderer or sprites
  // For now, just a placeholder
}

const onWindowResize = () => {
  if (!container.value) return
  const width = container.value.clientWidth
  const height = container.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

const onMouseClick = (event: MouseEvent) => {
  if (!container.value) return

  const rect = container.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(scene.children, true)

  if (intersects.length > 0) {
    const object = intersects[0].object
    if (object.userData.type) {
      handleObjectClick(object.userData)
    }
  }
}

const onMouseMove = (_event: MouseEvent) => {
  // Add hover effects if needed
}

const handleObjectClick = (userData: any) => {
  if (userData.type === 'zone') {
    selectedZone.value = userData.data
    ElMessage.info(`Zone: ${userData.data.zoneName || userData.data.zoneId}`)
  } else if (userData.type === 'item') {
    selectedItem.value = userData.data
    showItemDetails(userData.data)
  } else if (userData.type === 'pallet') {
    showPalletDetails(userData.data)
  }
}

const showItemDetails = (item: any) => {
  ElMessageBox.alert(
    `
    <div>
      <p><strong>Tên:</strong> ${item.itemName}</p>
      <p><strong>QR Code:</strong> ${item.qrCode}</p>
      <p><strong>Loại:</strong> ${item.itemType}</p>
      <p><strong>Khách hàng:</strong> ${item.customerName}</p>
      <p><strong>Kích thước:</strong> ${item.length}x${item.width}x${item.height}m</p>
      <p><strong>Trọng lượng:</strong> ${item.weight}kg</p>
      <p><strong>Ưu tiên:</strong> ${item.priorityLevel}</p>
      ${item.isFragile ? '<p style="color: red;"><strong>⚠️ Dễ vỡ</strong></p>' : ''}
      ${item.isHeavy ? '<p style="color: purple;"><strong>⚠️ Nặng</strong></p>' : ''}
    </div>
    `,
    'Chi tiết hàng hóa',
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

const showPalletDetails = (pallet: any) => {
  const items = warehouseData.value!.items?.filter((i) => i.palletId === pallet.palletId) || []
  ElMessageBox.alert(
    `
    <div>
      <p><strong>Barcode:</strong> ${pallet.barcode}</p>
      <p><strong>Vị trí:</strong> X:${pallet.positionX}, Y:${pallet.positionY}, Z:${pallet.positionZ}</p>
      <p><strong>Số lượng hàng:</strong> ${items.length}</p>
      ${pallet.isGround ? '<p><strong>Đặt trên nền</strong></p>' : '<p><strong>Trên kệ</strong></p>'}
    </div>
    `,
    'Chi tiết pallet',
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
}

const animate = () => {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

const changeViewMode = (mode: 'overview' | 'zones' | 'items') => {
  viewMode.value = mode
  renderWarehouse()
}

const toggleGrid = () => {
  showGrid.value = !showGrid.value
  const grid = scene.getObjectByName('gridHelper')
  if (grid) {
    grid.visible = showGrid.value
  }
}

const resetCamera = () => {
  camera.position.set(30, 30, 30)
  camera.lookAt(0, 0, 0)
  controls.reset()
}

const applyCustomerFilter = () => {
  renderWarehouse()
}

onMounted(() => {
  loadWarehouse3DData()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  if (renderer) {
    renderer.domElement.removeEventListener('click', onMouseClick)
    renderer.domElement.removeEventListener('mousemove', onMouseMove)
    renderer.dispose()
  }
})
</script>

<template>
  <div class="warehouse-3d-manager">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <h2>Quản Lý Kho 3D</h2>
        <el-tag v-if="warehouseData" type="success">{{ warehouseData.warehouseName }}</el-tag>
        <el-tag v-if="userStore.getUserInfo" type="info">{{ userStore.getUserInfo.role }}</el-tag>
      </div>
      <div class="header-right">
        <el-button @click="loadWarehouse3DData" :loading="loading" type="primary">
          <Icon icon="vi-ep:refresh" />
          Làm mới
        </el-button>
      </div>
    </div>

    <!-- Statistics Panel -->
    <div v-if="stats" class="stats-panel">
      <div class="stat-card">
        <div class="stat-value">{{ stats.totalZones }}</div>
        <div class="stat-label">Khu vực</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.totalRacks }}</div>
        <div class="stat-label">Kệ hàng</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.totalPallets }}</div>
        <div class="stat-label">Pallet</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.totalItems }}</div>
        <div class="stat-label">Hàng hóa</div>
      </div>
      <div class="stat-card highlight">
        <div class="stat-value">{{ stats.occupancyRate }}%</div>
        <div class="stat-label">Tỷ lệ lấp đầy</div>
      </div>
    </div>

    <div class="content">
      <!-- Control Panel -->
      <div class="control-panel">
        <el-card shadow="never">
          <template #header>
            <span>Điều khiển</span>
          </template>

          <div class="control-section">
            <h4>Chế độ xem</h4>
            <el-radio-group v-model="viewMode" @change="changeViewMode">
              <el-radio-button label="overview">Tổng quan</el-radio-button>
              <el-radio-button label="zones">Khu vực</el-radio-button>
              <el-radio-button label="items">Chi tiết hàng</el-radio-button>
            </el-radio-group>
          </div>

          <el-divider />

          <div class="control-section">
            <h4>Lọc theo khách hàng</h4>
            <el-select
              v-model="filterByCustomer"
              placeholder="Tất cả khách hàng"
              clearable
              @change="applyCustomerFilter"
            >
              <el-option
                v-for="customer in customers"
                :key="customer.id"
                :label="customer.name"
                :value="customer.id"
              />
            </el-select>
          </div>

          <el-divider />

          <div class="control-section">
            <h4>Hiển thị</h4>
            <el-checkbox v-model="showGrid" @change="toggleGrid">Lưới nền</el-checkbox>
            <el-checkbox v-model="showLabels" @change="renderWarehouse">Nhãn</el-checkbox>
          </div>

          <el-divider />

          <div class="control-section">
            <el-button @click="resetCamera" style="width: 100%">
              <Icon icon="vi-ep:view" />
              Reset Camera
            </el-button>
          </div>

          <!-- Legend -->
          <el-divider />
          <div class="control-section">
            <h4>Chú thích</h4>
            <div class="legend-item">
              <div class="legend-color" style="background: #e67e22"></div>
              <span>Pallet có hàng</span>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #ecf0f1"></div>
              <span>Pallet trống</span>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #e74c3c"></div>
              <span>Hàng dễ vỡ</span>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #8e44ad"></div>
              <span>Hàng nặng</span>
            </div>
            <div class="legend-item">
              <div class="legend-color" style="background: #f39c12"></div>
              <span>Ưu tiên cao</span>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 3D Viewer -->
      <div class="viewer-container">
        <div v-loading="loading" ref="container" class="canvas-container"></div>

        <!-- Floating Info Panel -->
        <div v-if="selectedZone" class="info-panel">
          <el-card shadow="always">
            <template #header>
              <div class="info-header">
                <span>{{ selectedZone.zoneName || `Zone ${selectedZone.zoneId}` }}</span>
                <el-button text @click="selectedZone = null">
                  <Icon icon="vi-ep:close" />
                </el-button>
              </div>
            </template>
            <div class="info-content">
              <p><strong>Loại:</strong> {{ selectedZone.zoneType }}</p>
              <p v-if="selectedZone.customerName">
                <strong>Khách hàng:</strong> {{ selectedZone.customerName }}
              </p>
              <p
                ><strong>Kích thước:</strong> {{ selectedZone.length }}x{{ selectedZone.width }}x{{
                  selectedZone.height
                }}m</p
              >
            </div>
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.warehouse-3d-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  background: white;
  border-bottom: 1px solid #e4e7ed;

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;

    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }
  }
}

.stats-panel {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: white;
  border-bottom: 1px solid #e4e7ed;

  .stat-card {
    flex: 1;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 8px;
    color: white;
    text-align: center;

    &.highlight {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }

    .stat-value {
      font-size: 32px;
      font-weight: bold;
      margin-bottom: 8px;
    }

    .stat-label {
      font-size: 14px;
      opacity: 0.9;
    }
  }
}

.content {
  flex: 1;
  display: flex;
  gap: 20px;
  padding: 20px;
  overflow: hidden;
}

.control-panel {
  width: 300px;
  flex-shrink: 0;

  .control-section {
    margin-bottom: 16px;

    h4 {
      margin: 0 0 12px 0;
      font-size: 14px;
      font-weight: 600;
      color: #606266;
    }

    .el-radio-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .el-checkbox {
      display: block;
      margin: 8px 0;
    }
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    font-size: 13px;

    .legend-color {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      border: 1px solid #dcdfe6;
    }
  }
}

.viewer-container {
  flex: 1;
  position: relative;
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.canvas-container {
  width: 100%;
  height: 100%;
}

.info-panel {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 300px;
  z-index: 10;

  .info-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .info-content {
    p {
      margin: 8px 0;
      font-size: 14px;
    }
  }
}
</style>
