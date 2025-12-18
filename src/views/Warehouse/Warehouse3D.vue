<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import {
  ElCard,
  ElRow,
  ElCol,
  ElSelect,
  ElOption,
  ElButton,
  ElTag,
  ElStatistic,
  ElAlert,
  ElDrawer,
  ElDescriptions,
  ElDescriptionsItem,
  ElMessageBox,
  ElMessage
} from 'element-plus'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import warehouseApi, { type Warehouse3DData, type WarehouseListItem } from '@/api/warehouse'
import ActionPanel from './components/ActionPanel.vue'
import { useRouter } from 'vue-router'

// State
const loading = ref(true)
const warehouseList = ref<WarehouseListItem[]>([])
const router = useRouter()
const selectedWarehouseId = ref<number | undefined>(undefined)
const warehouseData = ref<Warehouse3DData | null>(null)
const canvasContainer = ref<HTMLDivElement>()
const showItemDrawer = ref(false)
const selectedItem = ref<any>(null)

// Three.js objects
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let animationId: number

// Colors
const COLORS = {
  warehouse: 0x2c3e50,
  zone: 0x3498db,
  rack: 0x95a5a6,
  shelf: 0xbdc3c7,
  pallet: 0xf39c12,
  item: {
    normal: 0x27ae60,
    heavy: 0xe74c3c,
    fragile: 0x9b59b6,
    priority: 0xf1c40f
  },
  ground: 0x7f8c8d
}

// Computed
const statistics = computed(() => {
  if (!warehouseData.value) return null
  return {
    totalZones: warehouseData.value.zones.length,
    totalRacks: warehouseData.value.racks.length,
    totalPallets: warehouseData.value.pallets.length,
    totalItems: warehouseData.value.items.length,
    groundPallets: warehouseData.value.pallets.filter((p) => p.isGround).length,
    shelfPallets: warehouseData.value.pallets.filter((p) => !p.isGround).length
  }
})

// Load warehouse list
const loadWarehouseList = async () => {
  try {
    const res = await warehouseApi.getAllWarehouses()
    if (res.statusCode === 200) {
      warehouseList.value = res.data
      if (warehouseList.value.length > 0) {
        selectedWarehouseId.value = warehouseList.value[0].warehouseId
        await loadWarehouse3DData()
      }
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách kho')
  }
}

// Load warehouse 3D data
const loadWarehouse3DData = async () => {
  if (!selectedWarehouseId.value) return

  loading.value = true
  try {
    const res = await warehouseApi.getWarehouse3DData(selectedWarehouseId.value)
    if (res.statusCode === 200) {
      warehouseData.value = res.data
      initThreeJS()
      ElMessage.success('Tải dữ liệu kho thành công')
    } else {
      ElMessage.error(res.message || 'Không thể tải dữ liệu kho')
    }
  } catch (error) {
    ElMessage.error('Lỗi khi tải dữ liệu kho')
  } finally {
    loading.value = false
  }
}

// Initialize Three.js scene
const initThreeJS = () => {
  if (!canvasContainer.value || !warehouseData.value) return

  // Clear previous scene
  if (renderer) {
    cancelAnimationFrame(animationId)
    renderer.dispose()
    canvasContainer.value.innerHTML = ''
  }

  // Scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf0f0f0)
  scene.fog = new THREE.Fog(0xf0f0f0, 50, 200)

  // Camera
  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
  camera.position.set(
    warehouseData.value.length * 1.5,
    warehouseData.value.height * 1.5,
    warehouseData.value.width * 1.5
  )

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  canvasContainer.value.appendChild(renderer.domElement)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(50, 50, 50)
  directionalLight.castShadow = true
  scene.add(directionalLight)

  // Grid
  const gridHelper = new THREE.GridHelper(
    Math.max(warehouseData.value.length, warehouseData.value.width),
    20,
    0x888888,
    0xcccccc
  )
  scene.add(gridHelper)

  // Axes
  const axesHelper = new THREE.AxesHelper(10)
  scene.add(axesHelper)

  // Render warehouse
  renderWarehouse()
  renderZones()
  renderRacks()
  renderPallets()
  renderItems()

  // Animation loop
  animate()
}

// Render warehouse boundary
const renderWarehouse = () => {
  if (!warehouseData.value) return

  const geometry = new THREE.BoxGeometry(
    warehouseData.value.length,
    warehouseData.value.height,
    warehouseData.value.width
  )
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: COLORS.warehouse, linewidth: 2 })
  )
  line.position.set(
    warehouseData.value.length / 2,
    warehouseData.value.height / 2,
    warehouseData.value.width / 2
  )
  scene.add(line)
}

// Render zones
const renderZones = () => {
  if (!warehouseData.value) return

  warehouseData.value.zones.forEach((zone) => {
    const geometry = new THREE.BoxGeometry(zone.length, zone.height, zone.width)
    const material = new THREE.MeshPhongMaterial({
      color: COLORS.zone,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(
      zone.positionX + zone.length / 2,
      zone.positionY + zone.height / 2,
      zone.positionZ + zone.width / 2
    )

    // Add edges
    const edges = new THREE.EdgesGeometry(geometry)
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: COLORS.zone }))
    line.position.copy(mesh.position)

    scene.add(mesh)
    scene.add(line)
  })
}

// Render racks and shelves
const renderRacks = () => {
  if (!warehouseData.value) return

  warehouseData.value.racks.forEach((rack) => {
    // Rack frame
    const geometry = new THREE.BoxGeometry(rack.length, rack.height, rack.width)
    const edges = new THREE.EdgesGeometry(geometry)
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: COLORS.rack, linewidth: 2 })
    )
    line.position.set(
      rack.positionX + rack.length / 2,
      rack.positionY + rack.height / 2,
      rack.positionZ + rack.width / 2
    )
    scene.add(line)

    // Shelves
    rack.shelves.forEach((shelf) => {
      const shelfGeometry = new THREE.BoxGeometry(shelf.length, 0.05, shelf.width)
      const shelfMaterial = new THREE.MeshPhongMaterial({ color: COLORS.shelf })
      const shelfMesh = new THREE.Mesh(shelfGeometry, shelfMaterial)
      shelfMesh.position.set(
        rack.positionX + shelf.length / 2,
        shelf.positionY,
        rack.positionZ + shelf.width / 2
      )
      shelfMesh.castShadow = true
      shelfMesh.receiveShadow = true
      scene.add(shelfMesh)
    })
  })
}

// Render pallets
const renderPallets = () => {
  if (!warehouseData.value) return

  warehouseData.value.pallets.forEach((pallet) => {
    const geometry = new THREE.BoxGeometry(
      pallet.palletLength,
      pallet.palletHeight,
      pallet.palletWidth
    )
    const material = new THREE.MeshPhongMaterial({
      color: pallet.isGround ? COLORS.ground : COLORS.pallet
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(
      pallet.positionX + pallet.palletLength / 2,
      pallet.positionY + pallet.palletHeight / 2,
      pallet.positionZ + pallet.palletWidth / 2
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  })
}

// Render items
const renderItems = () => {
  if (!warehouseData.value) return

  warehouseData.value.items.forEach((item) => {
    const pallet = warehouseData.value!.pallets.find((p) => p.palletId === item.palletId)
    if (!pallet) return

    const geometry = new THREE.BoxGeometry(item.length, item.height, item.width)

    // Determine color based on item properties
    let color = COLORS.item.normal
    if (item.isFragile) color = COLORS.item.fragile
    else if (item.isHeavy) color = COLORS.item.heavy
    else if (item.priorityLevel && item.priorityLevel <= 3) color = COLORS.item.priority

    const material = new THREE.MeshPhongMaterial({ color })
    const mesh = new THREE.Mesh(geometry, material)

    // Calculate absolute position
    mesh.position.set(
      pallet.positionX + (item.positionX || 0) + item.length / 2,
      pallet.positionY + pallet.palletHeight + (item.positionY || 0) + item.height / 2,
      pallet.positionZ + (item.positionZ || 0) + item.width / 2
    )

    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData = { item, pallet }

    scene.add(mesh)
  })

  // Add click handler
  addClickHandler()
}

// Add click handler for items
const addClickHandler = () => {
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()

  const onClick = (event: MouseEvent) => {
    if (!canvasContainer.value) return

    const rect = canvasContainer.value.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(scene.children, true)

    if (intersects.length > 0) {
      const object = intersects[0].object
      if (object.userData.item) {
        selectedItem.value = object.userData
        showItemDrawer.value = true
      }
    }
  }

  renderer.domElement.addEventListener('click', onClick)
}

// Animation loop
const animate = () => {
  animationId = requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

// Handle window resize
const onWindowResize = () => {
  if (!canvasContainer.value) return

  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight

  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

// Actions
const resetCamera = () => {
  if (!warehouseData.value) return
  camera.position.set(
    warehouseData.value.length * 1.5,
    warehouseData.value.height * 1.5,
    warehouseData.value.width * 1.5
  )
  controls.target.set(
    warehouseData.value.length / 2,
    warehouseData.value.height / 2,
    warehouseData.value.width / 2
  )
}

const toggleWireframe = () => {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.material.wireframe = !object.material.wireframe
    }
  })
}

// Action handlers
const handleAddWarehouse = () => {
  ElMessageBox.alert('Chức năng đang phát triển', 'Thêm Kho Mới', {
    confirmButtonText: 'OK'
  })
}

const handleInbound = () => {
  ElMessageBox.alert('Chức năng đang phát triển', 'Nhập Kho', {
    confirmButtonText: 'OK'
  })
}

const handleOutbound = () => {
  if (!selectedWarehouseId.value) {
    ElMessage.warning('Vui lòng chọn kho trước')
    return
  }

  router.push({
    path: '/warehouse/outbound-request/create',
    query: {
      warehouseId: String(selectedWarehouseId.value)
    }
  })
}

const handleSearchItem = () => {
  ElMessageBox.prompt('Nhập mã QR hoặc tên hàng', 'Tìm Kiếm Hàng Hóa', {
    confirmButtonText: 'Tìm',
    cancelButtonText: 'Hủy'
  })
    .then(({ value }) => {
      ElMessage.info(`Đang tìm: ${value}`)
    })
    .catch(() => {})
}

const handleOptimize = () => {
  ElMessageBox.confirm('Bạn có muốn chạy thuật toán tối ưu sắp xếp kho không?', 'Tối Ưu Sắp Xếp', {
    confirmButtonText: 'Chạy',
    cancelButtonText: 'Hủy',
    type: 'warning'
  })
    .then(() => {
      ElMessage.success('Đang chạy thuật toán tối ưu...')
    })
    .catch(() => {})
}

const handleExportPDF = () => {
  ElMessage.info('Đang xuất PDF...')
}

const handleManageZones = () => {
  ElMessageBox.alert('Chức năng đang phát triển', 'Quản Lý Khu Vực', {
    confirmButtonText: 'OK'
  })
}

const handleManageRacks = () => {
  ElMessageBox.alert('Chức năng đang phát triển', 'Quản Lý Kệ', {
    confirmButtonText: 'OK'
  })
}

// Lifecycle
onMounted(() => {
  loadWarehouseList()
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  if (animationId) {
    cancelAnimationFrame(animationId)
  }
  if (renderer) {
    renderer.dispose()
  }
  window.removeEventListener('resize', onWindowResize)
})
</script>

<template>
  <div class="warehouse-3d-container">
    <!-- Header -->
    <ElRow :gutter="20" class="mb-4">
      <ElCol :span="24">
        <ElCard shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="title">Quản Lý Kho 3D</span>
              <div class="actions">
                <ElSelect
                  v-model="selectedWarehouseId"
                  placeholder="Chọn kho"
                  style="width: 300px; margin-right: 10px"
                  @change="loadWarehouse3DData"
                >
                  <ElOption
                    v-for="warehouse in warehouseList"
                    :key="warehouse.warehouseId"
                    :label="warehouse.warehouseName ?? 'Chưa đặt tên'"
                    :value="warehouse.warehouseId"
                  >
                    <span>{{ warehouse.warehouseName ?? 'Chưa đặt tên' }}</span>
                    <span style="float: right; color: var(--el-text-color-secondary)">
                      {{ warehouse.warehouseType }}
                    </span>
                  </ElOption>
                </ElSelect>
                <ElButton type="primary" @click="resetCamera">
                  <Icon icon="ep:refresh" class="mr-1" />
                  Reset Camera
                </ElButton>
                <ElButton @click="toggleWireframe">
                  <Icon icon="ep:view" class="mr-1" />
                  Wireframe
                </ElButton>
              </div>
            </div>
          </template>

          <!-- Statistics -->
          <ElRow v-if="statistics" :gutter="20" class="mb-4">
            <ElCol :span="4">
              <ElStatistic title="Tổng khu vực" :value="statistics.totalZones">
                <template #prefix>
                  <Icon icon="ep:office-building" />
                </template>
              </ElStatistic>
            </ElCol>
            <ElCol :span="4">
              <ElStatistic title="Tổng kệ" :value="statistics.totalRacks">
                <template #prefix>
                  <Icon icon="ep:grid" />
                </template>
              </ElStatistic>
            </ElCol>
            <ElCol :span="4">
              <ElStatistic title="Tổng pallet" :value="statistics.totalPallets">
                <template #prefix>
                  <Icon icon="ep:box" />
                </template>
              </ElStatistic>
            </ElCol>
            <ElCol :span="4">
              <ElStatistic title="Pallet dưới đất" :value="statistics.groundPallets">
                <template #prefix>
                  <Icon icon="ep:bottom" />
                </template>
              </ElStatistic>
            </ElCol>
            <ElCol :span="4">
              <ElStatistic title="Pallet trên kệ" :value="statistics.shelfPallets">
                <template #prefix>
                  <Icon icon="ep:top" />
                </template>
              </ElStatistic>
            </ElCol>
            <ElCol :span="4">
              <ElStatistic title="Tổng hàng hóa" :value="statistics.totalItems">
                <template #prefix>
                  <Icon icon="ep:goods" />
                </template>
              </ElStatistic>
            </ElCol>
          </ElRow>

          <!-- Legend -->
          <ElAlert type="info" :closable="false" class="mb-4">
            <div class="legend">
              <span class="legend-item">
                <span class="color-box" style="background: #27ae60"></span>
                Hàng thường
              </span>
              <span class="legend-item">
                <span class="color-box" style="background: #e74c3c"></span>
                Hàng nặng
              </span>
              <span class="legend-item">
                <span class="color-box" style="background: #9b59b6"></span>
                Hàng dễ vỡ
              </span>
              <span class="legend-item">
                <span class="color-box" style="background: #f1c40f"></span>
                Ưu tiên cao
              </span>
              <span class="legend-item">
                <span class="color-box" style="background: #f39c12"></span>
                Pallet
              </span>
              <span class="legend-item">
                <span class="color-box" style="background: #7f8c8d"></span>
                Pallet đất
              </span>
            </div>
          </ElAlert>
        </ElCard>
      </ElCol>
    </ElRow>

    <!-- 3D Canvas & Action Panel -->
    <ElRow :gutter="20">
      <ElCol :span="18">
        <ElCard shadow="hover" body-style="padding: 0;">
          <div ref="canvasContainer" class="canvas-container" v-loading="loading"></div>
        </ElCard>
      </ElCol>
      <ElCol :span="6">
        <ActionPanel
          @add-warehouse="handleAddWarehouse"
          @inbound="handleInbound"
          @outbound="handleOutbound"
          @search-item="handleSearchItem"
          @optimize="handleOptimize"
          @export-p-d-f="handleExportPDF"
          @manage-zones="handleManageZones"
          @manage-racks="handleManageRacks"
        />
      </ElCol>
    </ElRow>

    <!-- Item Details Drawer -->
    <ElDrawer v-model="showItemDrawer" title="Chi Tiết Hàng Hóa" direction="rtl" size="400px">
      <div v-if="selectedItem">
        <ElDescriptions :column="1" border>
          <ElDescriptionsItem label="Mã QR">
            {{ selectedItem.item.qrCode }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Tên hàng">
            {{ selectedItem.item.itemName }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Loại hàng">
            <ElTag>{{ selectedItem.item.itemType }}</ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Khách hàng">
            {{ selectedItem.item.customerName }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Kích thước">
            {{ selectedItem.item.length }} × {{ selectedItem.item.width }} ×
            {{ selectedItem.item.height }} m
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Trọng lượng">
            {{ selectedItem.item.weight }} kg
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Hình dạng">
            {{ selectedItem.item.shape }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Mức ưu tiên">
            <ElTag :type="selectedItem.item.priorityLevel <= 3 ? 'danger' : 'info'">
              {{ selectedItem.item.priorityLevel }}
            </ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Thuộc tính">
            <ElTag v-if="selectedItem.item.isHeavy" type="danger" class="mr-2">Nặng</ElTag>
            <ElTag v-if="selectedItem.item.isFragile" type="warning">Dễ vỡ</ElTag>
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Pallet">
            {{ selectedItem.pallet.barcode }}
          </ElDescriptionsItem>
          <ElDescriptionsItem label="Vị trí">
            X: {{ selectedItem.pallet.positionX.toFixed(2) }}, Y:
            {{ selectedItem.pallet.positionY.toFixed(2) }}, Z:
            {{ selectedItem.pallet.positionZ.toFixed(2) }}
          </ElDescriptionsItem>
        </ElDescriptions>

        <div class="mt-4">
          <ElButton type="primary" style="width: 100%">
            <Icon icon="ep:edit" class="mr-1" />
            Chỉnh sửa
          </ElButton>
          <ElButton type="danger" style="width: 100%; margin-top: 10px">
            <Icon icon="ep:delete" class="mr-1" />
            Xuất kho
          </ElButton>
        </div>
      </div>
    </ElDrawer>
  </div>
</template>

<style scoped lang="less">
.warehouse-3d-container {
  padding: 20px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .title {
      font-size: 18px;
      font-weight: bold;
    }

    .actions {
      display: flex;
      align-items: center;
    }
  }

  .canvas-container {
    position: relative;
    width: 100%;
    height: 70vh;
    min-height: 600px;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;

      .color-box {
        width: 20px;
        height: 20px;
        border: 1px solid #ddd;
        border-radius: 4px;
      }
    }
  }
}
</style>
