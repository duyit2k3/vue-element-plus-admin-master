<script setup lang="ts">
import { ref, onMounted, computed, reactive } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import { Table } from '@/components/Table'
import { ElButton, ElTag, ElMessage } from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter, useRoute } from 'vue-router'
import warehouseApi, { type Warehouse3DData } from '@/api/warehouse'
import { TableColumn } from '@/components/Table/src/types'

const { push } = useRouter()
const route = useRoute()
const loading = ref(true)
const warehouseData = ref<Warehouse3DData | null>(null)
const warehouseId = computed(() => Number(route.params.id))

// Table columns
const columns = reactive<TableColumn[]>([
  {
    field: 'zoneId',
    label: 'ID',
    width: '80px'
  },
  {
    field: 'zoneName',
    label: 'Tên Khu Vực',
    minWidth: '180px'
  },
  {
    field: 'zoneType',
    label: 'Loại Khu Vực',
    width: '150px'
  },
  {
    field: 'customerName',
    label: 'Khách Hàng',
    minWidth: '150px'
  },
  {
    field: 'size',
    label: 'Kích Thước (m)',
    width: '150px'
  },
  {
    field: 'position',
    label: 'Vị Trí (x,y,z)',
    width: '150px'
  },
  {
    field: 'capacity',
    label: 'Dung Tích (m³)',
    width: '130px'
  }
])

const zones = computed(() => warehouseData.value?.zones || [])

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

const getZoneTypeColor = (type: string) => {
  const typeMap: Record<string, any> = {
    storage: 'success',
    loading: 'warning',
    special: 'danger',
    general: 'info'
  }
  return typeMap[type?.toLowerCase()] || 'info'
}

onMounted(() => {
  loadWarehouseData()
})
</script>

<template>
  <ContentWrap :title="`Quản Lý Khu Vực - ${warehouseData?.warehouseName || 'Loading...'}`">
    <template #header>
      <ElButton type="primary" @click="push(`/warehouse/${warehouseId}/detail`)">
        <Icon icon="vi-ant-design:arrow-left-outlined" />
        Quay Lại Chi Tiết
      </ElButton>
      <ElButton type="success" @click="push(`/warehouse/${warehouseId}/3d-view`)">
        <Icon icon="vi-ant-design:deployment-unit-outlined" />
        Xem 3D
      </ElButton>
    </template>

    <Table
      :columns="columns"
      :data="zones"
      :loading="loading"
      :pagination="{ total: zones.length }"
    >
      <template #zoneName="{ row }">
        <div class="flex items-center">
          <Icon icon="vi-ant-design:layout-outlined" class="mr-5px" />
          <span class="font-bold">{{ row.zoneName || `Zone ${row.zoneId}` }}</span>
        </div>
      </template>

      <template #zoneType="{ row }">
        <ElTag :type="getZoneTypeColor(row.zoneType)">
          {{ row.zoneType || 'N/A' }}
        </ElTag>
      </template>

      <template #customerName="{ row }">
        <span>{{ row.customerName || 'Chưa phân bổ' }}</span>
      </template>

      <template #size="{ row }">
        <span>{{ row.length }} × {{ row.width }} × {{ row.height }}</span>
      </template>

      <template #position="{ row }">
        <span class="text-sm">{{ row.positionX }}, {{ row.positionY }}, {{ row.positionZ }}</span>
      </template>

      <template #capacity="{ row }">
        <span>{{ (row.length * row.width * row.height).toFixed(2) }}</span>
      </template>
    </Table>
  </ContentWrap>
</template>

<style scoped lang="less">
.flex {
  display: flex;
}

.items-center {
  align-items: center;
}

.mr-5px {
  margin-right: 5px;
}

.font-bold {
  font-weight: bold;
}

.text-sm {
  font-size: 12px;
  color: #909399;
}
</style>
