<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import {
  ElCard,
  ElButton,
  ElRadioGroup,
  ElRadioButton,
  ElCheckbox,
  ElSelect,
  ElOption,
  ElDivider,
  ElMessage,
  ElMessageBox
} from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter, useRoute } from 'vue-router'
import warehouseApi, { type Warehouse3DData } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

const { push } = useRouter()
const route = useRoute()
const loading = ref(true)
const warehouseData = ref<Warehouse3DData | null>(null)
const container = ref<HTMLDivElement>()
const userStore = useUserStore()

const warehouseId = computed(() => Number(route.params.id))
const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const canCreateInbound = computed(() => userRole.value === 'customer')
const canViewInbound = computed(() =>
  ['customer', 'warehouse_owner', 'admin'].includes(userRole.value)
)

const goToCreateInbound = () => {
  push({
    path: '/warehouse/inbound-request/create',
    query: { warehouseId: String(warehouseId.value) }
  })
}

const goToViewInbound = () => {
  push({ path: '/warehouse/inbound-request', query: { warehouseId: String(warehouseId.value) } })
}

// 3D Scene variables
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2

// UI State
const viewMode = ref<'all' | 'zones' | 'items'>('all')
const showGrid = ref(true)
const showLabels = ref(false)
const selectedObject = ref<any>(null)
const filterByCustomer = ref<number | undefined>(undefined)

// Statistics
const stats = computed(() => {
  if (!warehouseData.value) return null
  return {
    totalZones: warehouseData.value.zones?.length || 0,
    totalPallets: warehouseData.value.pallets?.length || 0,
    totalItems: warehouseData.value.items?.length || 0,
    occupiedPallets:
      warehouseData.value.pallets?.filter((p) =>
        warehouseData.value!.items?.some((i) => i.palletId === p.palletId)
      ).length || 0
  }
})

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

// Load warehouse 3D data
const loadWarehouse3DData = async () => {
  loading.value = true
  try {
    const res = await warehouseApi.getWarehouse3DData(warehouseId.value)
    if (res.statusCode === 200 || res.code === 0) {
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
  scene.add(ground)

  // Raycaster
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // Event listeners
  window.addEventListener('resize', onWindowResize)
  renderer.domElement.addEventListener('click', onCanvasClick)

  // Render warehouse objects
  renderWarehouse()

  // Start animation loop
  animate()
}

// Render warehouse objects
const renderWarehouse = () => {
  if (!warehouseData.value) return

  // Clear old objects (keep lights and helpers)
  const objectsToRemove: THREE.Object3D[] = []
  scene.children.forEach((child) => {
    if (
      !(child instanceof THREE.Light) &&
      child.name !== 'gridHelper' &&
      child.type !== 'Mesh' // Don't remove ground
    ) {
      if (child.name && !child.name.includes('ground')) {
        objectsToRemove.push(child)
      }
    }
  })
  objectsToRemove.forEach((obj) => scene.remove(obj))

  // Remove old meshes
  scene.children = scene.children.filter(
    (child) =>
      child instanceof THREE.Light ||
      child.name === 'gridHelper' ||
      child.name === 'ground' ||
      child.type === 'Mesh'
  )

  // Render warehouse boundary
  renderWarehouseBoundary()

  // Render zones
  warehouseData.value.zones?.forEach((zone) => {
    if (!filterByCustomer.value || zone.customerId === filterByCustomer.value) {
      renderZone(zone)
    }
  })

  // Render racks
  renderRacks()

  // Render pallets
  warehouseData.value.pallets?.forEach((pallet) => {
    const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
    if (!zone || (filterByCustomer.value && zone.customerId !== filterByCustomer.value)) return
    renderPallet(pallet)
  })

  // Render items if in items view mode
  if (viewMode.value === 'items' || viewMode.value === 'all') {
    warehouseData.value.items?.forEach((item) => {
      const pallet = warehouseData.value!.pallets?.find((p) => p.palletId === item.palletId)
      if (!pallet) return
      const zone = warehouseData.value!.zones?.find((z) => z.zoneId === pallet.zoneId)
      if (!zone || (filterByCustomer.value && zone.customerId !== filterByCustomer.value)) return
      renderItem(item, pallet)
    })
  }
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
    if (!zone || (filterByCustomer.value && zone.customerId !== filterByCustomer.value)) return

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
    scene.add(frameLines)

    rack.shelves?.forEach((shelf: any) => {
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
      scene.add(shelfMesh)
    })
  })
}

// Render pallet
const renderPallet = (pallet: any) => {
  const geometry = new THREE.BoxGeometry(
    pallet.palletLength,
    pallet.palletHeight,
    pallet.palletWidth
  )

  // Check if pallet has items
  const hasItems = warehouseData.value!.items?.some((i) => i.palletId === pallet.palletId)
  const color = hasItems ? 0xe67e22 : 0xbdc3c7

  const material = new THREE.MeshPhongMaterial({ color: color })
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

// Render item (box on pallet)
const renderItem = (item: any, pallet: any) => {
  // Color based on properties
  let color = 0x27ae60 // Default green
  if (item.isFragile) {
    color = 0xe74c3c // Red for fragile
  } else if (item.isHeavy) {
    color = 0x8e44ad // Purple for heavy
  } else if (item.priorityLevel && item.priorityLevel <= 3) {
    color = 0xf39c12 // Orange for high priority
  }

  const isBox = typeof item.itemType === 'string' && item.itemType.toLowerCase() === 'box'

  if (isBox) {
    renderBoxItemAsCartons(item, pallet, color)
    return
  }

  const geometry = new THREE.BoxGeometry(item.length, item.height, item.width)
  const material = new THREE.MeshPhongMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)

  // Position relative to pallet
  mesh.position.set(
    pallet.positionX + (item.positionX || 0) + item.length / 2,
    pallet.positionY + (item.positionY || 0) + item.height / 2,
    pallet.positionZ + (item.positionZ || 0) + item.width / 2
  )
  mesh.userData = { type: 'item', data: item }
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

const renderBoxItemAsCartons = (item: any, pallet: any, color: number) => {
  const stackLength = Number(item.length) || 0
  const stackWidth = Number(item.width) || 0
  const stackHeight = Number(item.height) || 0

  if (stackLength <= 0 || stackWidth <= 0 || stackHeight <= 0) {
    return
  }

  const stdL = (item.standardLength ?? null) as number | null
  const stdW = (item.standardWidth ?? null) as number | null
  const stdH = (item.standardHeight ?? null) as number | null

  let nx = 0
  let nz = 0
  let ny = 0

  if (stdL && stdW && stdH && stdL > 0 && stdW > 0 && stdH > 0) {
    nx = Math.max(1, Math.floor(stackLength / stdL))
    nz = Math.max(1, Math.floor(stackWidth / stdW))
    ny = Math.max(1, Math.floor(stackHeight / stdH))
  } else {
    nx = 3
    nz = 2
    ny = 2
  }

  nx = Math.min(nx, 6)
  nz = Math.min(nz, 4)
  ny = Math.min(ny, 3)

  const boxLength = stackLength / nx
  const boxWidth = stackWidth / nz
  const boxHeight = stackHeight / ny

  const geometry = new THREE.BoxGeometry(boxLength, boxHeight, boxWidth)
  const material = new THREE.MeshPhongMaterial({ color, flatShading: true })

  const baseX = pallet.positionX + (item.positionX || 0)
  const baseY = pallet.positionY + (item.positionY || 0)
  const baseZ = pallet.positionZ + (item.positionZ || 0)

  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(
          baseX + boxLength * (ix + 0.5),
          baseY + boxHeight * (iy + 0.5),
          baseZ + boxWidth * (iz + 0.5)
        )
        mesh.userData = { type: 'item', data: item }
        mesh.name = `item_${item.itemId}_carton`
        mesh.castShadow = true

        scene.add(mesh)
      }
    }
  }
}

// Animation loop
const animate = () => {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
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

  const rect = container.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(scene.children, true)

  if (intersects.length > 0) {
    const object = intersects[0].object
    if (object.userData?.type) {
      handleObjectClick(object.userData)
    }
  }
}

// Handle object click
const handleObjectClick = (userData: any) => {
  selectedObject.value = userData.data

  if (userData.type === 'zone') {
    showZoneDetails(userData.data)
  } else if (userData.type === 'pallet') {
    showPalletDetails(userData.data)
  } else if (userData.type === 'item') {
    showItemDetails(userData.data)
  }
}

const showZoneDetails = (zone: any) => {
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

const showPalletDetails = (pallet: any) => {
  const items = warehouseData.value?.items?.filter((i) => i.palletId === pallet.palletId) || []

  ElMessageBox.alert(
    `
    <div style="line-height: 1.8">
      <p><strong>Barcode:</strong> ${pallet.barcode}</p>
      <p><strong>Mã vị trí:</strong> ${pallet.locationCode || 'N/A'}</p>
      <p><strong>Vị trí:</strong> (${pallet.positionX}, ${pallet.positionY}, ${pallet.positionZ})</p>
      <p><strong>Kích thước:</strong> ${pallet.palletLength}m × ${pallet.palletWidth}m × ${pallet.palletHeight}m</p>
      <p><strong>Loại:</strong> ${pallet.isGround ? 'Đặt trên nền' : 'Trên kệ'}</p>
      <p><strong>Stack level:</strong> ${pallet.stackLevel}</p>
      <p><strong>Số hàng hóa:</strong> ${items.length} items</p>
      ${items.length > 0 ? `<hr/><p><strong>Danh sách hàng:</strong></p><ul>${items.map((i) => `<li>${i.itemName || i.qrCode}</li>`).join('')}</ul>` : ''}
    </div>
    `,
    `📦 Chi tiết Pallet`,
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: 'Đóng'
    }
  )
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

const toggleGrid = () => {
  const grid = scene.getObjectByName('gridHelper')
  if (grid) grid.visible = showGrid.value
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

onMounted(() => {
  loadWarehouse3DData()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
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
      <ElButton type="primary" @click="push(`/warehouse/${warehouseId}/detail`)">
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

    <div class="warehouse-3d-viewer">
      <!-- Stats Bar -->
      <div v-if="stats" class="stats-bar">
        <div class="stat-item">
          <Icon icon="vi-ant-design:layout-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">{{ stats.totalZones }}</div>
            <div class="stat-label">Khu vực</div>
          </div>
        </div>
        <div class="stat-item">
          <Icon icon="vi-ant-design:appstore-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">{{ stats.totalPallets }}</div>
            <div class="stat-label">Pallets</div>
          </div>
        </div>
        <div class="stat-item">
          <Icon icon="vi-ant-design:inbox-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">{{ stats.totalItems }}</div>
            <div class="stat-label">Hàng hóa</div>
          </div>
        </div>
        <div class="stat-item highlight">
          <Icon icon="vi-ant-design:pie-chart-outlined" class="stat-icon" />
          <div>
            <div class="stat-value">
              {{
                stats.totalPallets > 0
                  ? ((stats.occupiedPallets / stats.totalPallets) * 100).toFixed(0)
                  : 0
              }}%
            </div>
            <div class="stat-label">Sử dụng</div>
          </div>
        </div>
      </div>

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
              <ElRadioButton value="all">Tất cả</ElRadioButton>
              <ElRadioButton value="zones">Khu vực</ElRadioButton>
              <ElRadioButton value="items">Hàng hóa</ElRadioButton>
            </ElRadioGroup>
          </div>

          <ElDivider />

          <div class="control-section">
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

          <ElDivider />

          <div class="control-section">
            <h4>Hiển thị</h4>
            <ElCheckbox v-model="showGrid" @change="toggleGrid">Lưới nền</ElCheckbox>
            <ElCheckbox v-model="showLabels" @change="renderWarehouse">Nhãn</ElCheckbox>
          </div>

          <ElDivider />

          <div class="control-section">
            <ElButton size="small" style="width: 100%" @click="resetCamera">
              <Icon icon="vi-ep:view" />
              Reset Camera
            </ElButton>
            <ElButton
              size="small"
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
                <span>Hàng dễ vỡ</span>
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
                <span>Hàng thường</span>
              </div>
            </div>
          </div>
        </ElCard>

        <!-- 3D Canvas -->
        <div class="canvas-wrapper">
          <div v-loading="loading" ref="container" class="canvas-container"></div>

          <!-- Info overlay -->
          <div v-if="selectedObject" class="info-overlay">
            <ElCard shadow="always">
              <template #header>
                <div class="info-header">
                  <span class="font-bold">
                    {{
                      selectedObject.itemName || selectedObject.zoneName || selectedObject.barcode
                    }}
                  </span>
                  <ElButton text @click="selectedObject = null">
                    <Icon icon="vi-ep:close" />
                  </ElButton>
                </div>
              </template>
              <div class="info-content">
                <p
                  ><strong>Loại:</strong>
                  {{ selectedObject.itemType || selectedObject.zoneType || 'Pallet' }}</p
                >
                <p v-if="selectedObject.customerName">
                  <strong>Khách hàng:</strong> {{ selectedObject.customerName }}
                </p>
              </div>
            </ElCard>
          </div>

          <!-- Help Text -->
          <div class="help-text">
            <p>💡 <strong>Hướng dẫn:</strong></p>
            <p>• Click chuột trái để chọn đối tượng</p>
            <p>• Giữ chuột trái + kéo để xoay camera</p>
            <p>• Cuộn chuột để zoom in/out</p>
            <p>• Giữ chuột phải + kéo để di chuyển</p>
          </div>
        </div>
      </div>
    </div>
  </ContentWrap>
</template>

<style scoped lang="less">
.warehouse-3d-viewer {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 200px);
  min-height: 600px;
}

.stats-bar {
  display: flex;
  padding: 15px;
  margin-bottom: 15px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
  gap: 15px;

  .stat-item {
    display: flex;
    padding: 15px;
    color: white;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 8px;
    flex: 1;
    align-items: center;
    gap: 12px;

    &.highlight {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }

    .stat-icon {
      font-size: 32px;
      opacity: 0.9;
    }

    .stat-value {
      margin-bottom: 5px;
      font-size: 24px;
      font-weight: bold;
      line-height: 1;
    }

    .stat-label {
      font-size: 12px;
      opacity: 0.85;
    }
  }
}

.main-content {
  flex: 1;
  display: flex;
  gap: 15px;
  overflow: hidden;
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
