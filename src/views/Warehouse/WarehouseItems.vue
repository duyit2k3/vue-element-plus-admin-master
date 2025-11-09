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
    field: 'itemName',
    label: 'Tên Hàng',
    minWidth: '180px'
  },
  {
    field: 'qrCode',
    label: 'Mã QR',
    width: '150px'
  },
  {
    field: 'itemType',
    label: 'Loại',
    width: '120px'
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
    field: 'weight',
    label: 'Trọng Lượng (kg)',
    width: '130px'
  },
  {
    field: 'priority',
    label: 'Ưu Tiên',
    width: '100px'
  },
  {
    field: 'properties',
    label: 'Thuộc Tính',
    width: '150px'
  }
])

const items = computed(() => warehouseData.value?.items || [])

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

const getPriorityType = (priority: number | null) => {
  if (!priority) return 'info'
  if (priority >= 3) return 'danger'
  if (priority >= 2) return 'warning'
  return 'success'
}

onMounted(() => {
  loadWarehouseData()
})
</script>

<template>
  <ContentWrap :title="`Quản Lý Hàng Hóa - ${warehouseData?.warehouseName || 'Loading...'}`">
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
      :data="items"
      :loading="loading"
      :pagination="{ total: items.length }"
    >
      <template #itemName="{ row }">
        <div class="flex items-center">
          <Icon icon="vi-ant-design:inbox-outlined" class="mr-5px" />
          <span>{{ row.itemName || 'N/A' }}</span>
        </div>
      </template>

      <template #size="{ row }">
        <span>{{ row.length }} × {{ row.width }} × {{ row.height }}</span>
      </template>

      <template #priority="{ row }">
        <ElTag :type="getPriorityType(row.priorityLevel)">
          {{ row.priorityLevel || 'N/A' }}
        </ElTag>
      </template>

      <template #properties="{ row }">
        <div class="flex gap-5px">
          <ElTag v-if="row.isFragile" type="danger" size="small">Dễ vỡ</ElTag>
          <ElTag v-if="row.shape === 'Heavy'" type="warning" size="small">Nặng</ElTag>
        </div>
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

.gap-5px {
  gap: 5px;
}

.mr-5px {
  margin-right: 5px;
}
</style>
