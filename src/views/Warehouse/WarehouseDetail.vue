<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import { Descriptions } from '@/components/Descriptions'
import { ElCard, ElRow, ElCol, ElButton, ElMessage, ElStatistic, ElSkeleton } from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter, useRoute } from 'vue-router'
import warehouseApi, { type Warehouse3DData } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'

const { push } = useRouter()
const route = useRoute()
const loading = ref(true)
const warehouseData = ref<Warehouse3DData | null>(null)
const userStore = useUserStore()

const warehouseId = computed(() => Number(route.params.id))
const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const canCreateInbound = computed(() => userRole.value === 'customer')
const canViewInbound = computed(() =>
  ['customer', 'warehouse_owner', 'admin'].includes(userRole.value)
)
const canManageWarehouse = computed(() => ['warehouse_owner', 'admin'].includes(userRole.value))

const goToCreateInbound = () => {
  push({
    path: '/warehouse/inbound-request/create',
    query: { warehouseId: String(warehouseId.value) }
  })
}

const goToViewInbound = () => {
  push({ path: '/warehouse/inbound-request', query: { warehouseId: String(warehouseId.value) } })
}

// Statistics from warehouse data
const stats = computed(() => {
  if (!warehouseData.value) return null
  return {
    totalZones: warehouseData.value.zones?.length || 0,
    totalRacks: warehouseData.value.racks?.length || 0,
    totalItems: warehouseData.value.items?.length || 0,
    capacity: warehouseData.value.length * warehouseData.value.width * warehouseData.value.height
  }
})

// Load warehouse data
const loadWarehouseData = async () => {
  loading.value = true
  try {
    const res = await warehouseApi.getWarehouse3DData(warehouseId.value)
    if (res.statusCode === 200 || res.code === 0) {
      warehouseData.value = res.data
    } else {
      ElMessage.error('Không thể tải dữ liệu kho')
    }
  } catch (error) {
    ElMessage.error('Lỗi khi tải dữ liệu kho')
  } finally {
    loading.value = false
  }
}

const schema = computed(() => {
  if (!warehouseData.value) return []
  return [
    {
      field: 'warehouseId',
      label: 'Mã Kho',
      span: 12
    },
    {
      field: 'warehouseName',
      label: 'Tên Kho',
      span: 12
    },
    {
      field: 'ownerName',
      label: 'Chủ Kho',
      span: 12
    },
    {
      field: 'warehouseType',
      label: 'Loại Kho',
      span: 12
    },
    {
      field: 'size',
      label: 'Kích Thước',
      span: 12
    },
    {
      field: 'allowedItemTypes',
      label: 'Loại Hàng Cho Phép',
      span: 12
    },
    {
      field: 'status',
      label: 'Trạng Thái',
      span: 12
    }
  ]
})

const data = computed(() => {
  if (!warehouseData.value) return {}
  return {
    warehouseId: warehouseData.value.warehouseId,
    warehouseName: warehouseData.value.warehouseName || 'Chưa đặt tên',
    ownerName: warehouseData.value.ownerName || 'N/A',
    warehouseType: warehouseData.value.warehouseType || 'N/A',
    size: `${warehouseData.value.length}m × ${warehouseData.value.width}m × ${warehouseData.value.height}m`,
    allowedItemTypes: warehouseData.value.allowedItemTypes || 'Tất cả',
    status: warehouseData.value.status || 'N/A'
  }
})

onMounted(() => {
  loadWarehouseData()
})
</script>

<template>
  <div class="warehouse-detail">
    <ContentWrap :title="`Chi Tiết Kho #${warehouseId}`">
      <template #header>
        <ElButton type="primary" @click="push('/warehouse/list')">
          <Icon icon="vi-ant-design:arrow-left-outlined" />
          Quay Lại Danh Sách
        </ElButton>
      </template>

      <ElSkeleton :loading="loading" :rows="6" animated>
        <!-- Statistics -->
        <ElRow :gutter="20" class="mb-20px">
          <ElCol :xs="24" :sm="12" :md="6">
            <ElCard shadow="hover">
              <ElStatistic title="Số Khu Vực" :value="stats?.totalZones || 0">
                <template #prefix>
                  <Icon icon="vi-ant-design:layout-outlined" class="text-primary" />
                </template>
              </ElStatistic>
            </ElCard>
          </ElCol>
          <ElCol :xs="24" :sm="12" :md="6">
            <ElCard shadow="hover">
              <ElStatistic title="Số Giá Kệ" :value="stats?.totalRacks || 0">
                <template #prefix>
                  <Icon icon="vi-ant-design:appstore-outlined" class="text-success" />
                </template>
              </ElStatistic>
            </ElCard>
          </ElCol>
          <ElCol :xs="24" :sm="12" :md="6">
            <ElCard shadow="hover">
              <ElStatistic title="Số Hàng Hóa" :value="stats?.totalItems || 0">
                <template #prefix>
                  <Icon icon="vi-ant-design:inbox-outlined" class="text-warning" />
                </template>
              </ElStatistic>
            </ElCard>
          </ElCol>
          <ElCol :xs="24" :sm="12" :md="6">
            <ElCard shadow="hover">
              <ElStatistic title="Dung Tích (m³)" :value="stats?.capacity || 0" :precision="2">
                <template #prefix>
                  <Icon icon="vi-ant-design:fund-outlined" class="text-info" />
                </template>
              </ElStatistic>
            </ElCard>
          </ElCol>
        </ElRow>

        <!-- Warehouse Information -->
        <ElCard shadow="hover" class="mb-20px">
          <template #header>
            <span class="text-lg font-bold">Thông Tin Kho</span>
          </template>
          <Descriptions :schema="schema" :data="data" :columns="2" />
        </ElCard>

        <!-- Quick Actions -->
        <ElCard shadow="hover">
          <template #header>
            <span class="text-lg font-bold">Thao Tác</span>
          </template>
          <div class="action-buttons">
            <ElButton type="success" @click="push(`/warehouse/${warehouseId}/3d-view`)">
              <Icon icon="vi-ant-design:deployment-unit-outlined" />
              Xem Kho 3D
            </ElButton>
            <ElButton
              v-if="canManageWarehouse"
              type="primary"
              @click="push(`/warehouse/${warehouseId}/items`)"
            >
              <Icon icon="vi-ant-design:inbox-outlined" />
              Quản Lý Hàng Hóa
            </ElButton>
            <ElButton
              v-if="canManageWarehouse"
              type="warning"
              @click="push(`/warehouse/${warehouseId}/zones`)"
            >
              <Icon icon="vi-ant-design:layout-outlined" />
              Quản Lý Khu Vực
            </ElButton>
            <ElButton v-if="canCreateInbound" type="primary" @click="goToCreateInbound">
              <Icon icon="vi-ant-design:plus-square-outlined" />
              Thêm Yêu Cầu Nhập Kho
            </ElButton>
            <ElButton v-if="canViewInbound" @click="goToViewInbound">
              <Icon icon="vi-ant-design:unordered-list-outlined" />
              Xem Yêu Cầu Nhập Kho
            </ElButton>
          </div>
        </ElCard>
      </ElSkeleton>
    </ContentWrap>
  </div>
</template>

<style scoped lang="less">
.warehouse-detail {
  padding: 20px;
}

.mb-20px {
  margin-bottom: 20px;
}

.action-buttons {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.text-lg {
  font-size: 18px;
}

.font-bold {
  font-weight: bold;
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
