<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElCard, ElRow, ElCol, ElStatistic, ElButton, ElMessage } from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter } from 'vue-router'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'

const { push } = useRouter()
const userStore = useUserStore()
const loading = ref(true)
const warehouses = ref<WarehouseListItem[]>([])

const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')

const displayWarehouses = computed(() => {
  if (userRole.value === 'warehouse_owner') {
    const map = new Map<number, WarehouseListItem>()
    warehouses.value.forEach((w) => {
      if (!map.has(w.warehouseId)) {
        map.set(w.warehouseId, w)
      }
    })
    return Array.from(map.values())
  }
  return warehouses.value
})

// Statistics
const stats = computed(() => ({
  totalWarehouses: warehouses.value.length,
  activeWarehouses: warehouses.value.filter((w) => w.status === 'active').length,
  totalCapacity: warehouses.value.reduce((sum, w) => sum + w.length * w.width * w.height, 0),
  utilizationRate: 0 // TODO: Calculate from actual data
}))

// Load warehouses
const loadWarehouses = async () => {
  loading.value = true
  try {
    const userInfo = userStore.getUserInfo
    if (!userInfo) {
      loading.value = false
      return
    }

    let res: any
    if (userInfo.role === 'warehouse_owner') {
      // Chỉ lấy danh sách kho của chủ kho (không cần chi tiết khu vực khách)
      res = await warehouseApi.getWarehousesByOwner(userInfo.accountId!)
    } else if (userInfo.role === 'customer') {
      res = await warehouseApi.getWarehousesByCustomer(userInfo.accountId!)
    } else {
      res = await warehouseApi.getAllWarehouses()
    }

    if (res.statusCode === 200 || res.code === 0) {
      warehouses.value = res.data || []
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách kho')
  } finally {
    loading.value = false
  }
}

const goToWarehouse = (warehouse: WarehouseListItem) => {
  push(`/warehouse/${warehouse.warehouseId}/detail`)
}

const goTo3DView = (warehouse: WarehouseListItem) => {
  const query: any = {}
  if (userRole.value === 'customer' && warehouse.zoneId) {
    query.zoneId = String(warehouse.zoneId)
  }

  push({
    path: `/warehouse/${warehouse.warehouseId}/3d-view`,
    query
  })
}

onMounted(() => {
  loadWarehouses()
})
</script>

<template>
  <div class="warehouse-overview">
    <!-- Statistics Cards -->
    <ElRow :gutter="20" class="mb-20px">
      <ElCol :xs="24" :sm="12" :md="6">
        <ElCard shadow="hover">
          <ElStatistic title="Tổng Số Kho" :value="stats.totalWarehouses">
            <template #prefix>
              <Icon icon="vi-ant-design:database-filled" class="text-primary" />
            </template>
          </ElStatistic>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :sm="12" :md="6">
        <ElCard shadow="hover">
          <ElStatistic title="Kho Hoạt Động" :value="stats.activeWarehouses">
            <template #prefix>
              <Icon icon="vi-ant-design:check-circle-filled" class="text-success" />
            </template>
          </ElStatistic>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :sm="12" :md="6">
        <ElCard shadow="hover">
          <ElStatistic title="Tổng Dung Tích (m³)" :value="stats.totalCapacity" :precision="2">
            <template #prefix>
              <Icon icon="vi-ant-design:fund-filled" class="text-warning" />
            </template>
          </ElStatistic>
        </ElCard>
      </ElCol>
      <ElCol :xs="24" :sm="12" :md="6">
        <ElCard shadow="hover">
          <ElStatistic title="Tỷ Lệ Sử Dụng (%)" :value="stats.utilizationRate" :precision="1">
            <template #prefix>
              <Icon icon="vi-ant-design:pie-chart-filled" class="text-info" />
            </template>
          </ElStatistic>
        </ElCard>
      </ElCol>
    </ElRow>

    <!-- Quick Actions -->
    <ElRow :gutter="20" class="mb-20px">
      <ElCol :span="24">
        <ElCard shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="text-lg font-bold">Thao Tác Nhanh</span>
            </div>
          </template>
          <div class="quick-actions">
            <ElButton type="primary" @click="push('/warehouse/list')">
              <Icon icon="vi-ant-design:unordered-list-outlined" />
              Xem Tất Cả Kho
            </ElButton>
            <ElButton type="warning" @click="push('/warehouse/inbound-request/create')">
              <Icon icon="vi-ant-design:plus-square-outlined" />
              Tạo Yêu Cầu Nhập Kho
            </ElButton>
          </div>
        </ElCard>
      </ElCol>
    </ElRow>

    <!-- Recent Warehouses -->
    <ElRow :gutter="20">
      <ElCol :span="24">
        <ElCard shadow="hover" v-loading="loading">
          <template #header>
            <div class="card-header">
              <span class="text-lg font-bold">Kho Gần Đây</span>
              <ElButton text type="primary" @click="loadWarehouses">
                <Icon icon="vi-ep:refresh" />
                Làm mới
              </ElButton>
            </div>
          </template>

          <div class="warehouse-grid">
            <ElCard
              v-for="warehouse in displayWarehouses.slice(0, 6)"
              :key="warehouse.warehouseId"
              shadow="hover"
              class="warehouse-card"
            >
              <div class="warehouse-info">
                <h3>{{ warehouse.warehouseName || 'Chưa đặt tên' }}</h3>
                <p v-if="userRole === 'customer'" class="text-gray-500">
                  {{ warehouse.zoneName || 'Chưa phân bổ khu vực' }}
                </p>
                <p v-else-if="userRole !== 'warehouse_owner'" class="text-gray-500">
                  {{ warehouse.ownerName }}
                </p>
                <!-- Với warehouse_owner không cần hiển thị khu vực khách thuê -->
                <p class="text-sm">
                  <Icon icon="vi-ant-design:container-outlined" />
                  {{ warehouse.length }}m × {{ warehouse.width }}m × {{ warehouse.height }}m
                </p>
                <div class="mt-10px">
                  <ElButton size="small" type="primary" @click="goToWarehouse(warehouse)">
                    <Icon icon="vi-ant-design:eye-outlined" />
                    Chi Tiết
                  </ElButton>
                  <ElButton size="small" type="success" @click="goTo3DView(warehouse)">
                    <Icon icon="vi-ant-design:deployment-unit-outlined" />
                    Xem 3D
                  </ElButton>
                </div>
              </div>
            </ElCard>
          </div>

          <div v-if="warehouses.length === 0" class="empty-state">
            <Icon icon="vi-ant-design:inbox-outlined" :size="80" class="text-gray-400" />
            <p class="text-gray-500 mt-10px">Chưa có kho nào</p>
          </div>
        </ElCard>
      </ElCol>
    </ElRow>
  </div>
</template>

<style scoped lang="less">
.warehouse-overview {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quick-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.warehouse-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.warehouse-card {
  cursor: pointer;
  transition: transform 0.2s;

  &:hover {
    transform: translateY(-5px);
  }
}

.warehouse-info {
  h3 {
    margin: 0 0 5px;
    color: var(--el-text-color-primary);
  }

  p {
    margin: 5px 0;
  }
}

.empty-state {
  padding: 60px 20px;
  text-align: center;
}

.text-primary {
  color: var(--el-color-primary);
}

.text-success {
  color: var(--el-color-success);
}

.text-warning {
  color: var(--el-color-warning);
}

.text-info {
  color: var(--el-color-info);
}
</style>
