<script setup lang="ts">
import { reactive, unref, onMounted } from 'vue'
import { ContentWrap } from '@/components/ContentWrap'
import { Table } from '@/components/Table'
import { ElButton, ElTag } from 'element-plus'
import { Icon } from '@/components/Icon'
import { useRouter } from 'vue-router'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import { useUserStore } from '@/store/modules/user'
import { useTable } from '@/hooks/web/useTable'
import { TableColumn } from '@/components/Table/src/types'

const { push } = useRouter()
const userStore = useUserStore()

// Table configuration
const columns = reactive<TableColumn[]>([
  {
    field: 'warehouseId',
    label: 'ID',
    width: '80px'
  },
  {
    field: 'warehouseName',
    label: 'Tên Kho',
    minWidth: '200px'
  },
  {
    field: 'ownerName',
    label: 'Chủ Kho',
    minWidth: '150px'
  },
  {
    field: 'size',
    label: 'Kích Thước (m)',
    minWidth: '150px'
  },
  {
    field: 'warehouseType',
    label: 'Loại Kho',
    minWidth: '120px'
  },
  {
    field: 'status',
    label: 'Trạng Thái',
    width: '120px'
  },
  {
    field: 'action',
    label: 'Thao Tác',
    width: '280px'
  }
])

const { tableRegister, tableState, tableMethods } = useTable({
  fetchDataApi: async () => {
    const userInfo = userStore.getUserInfo
    const res =
      userInfo?.role === 'warehouse_owner'
        ? await warehouseApi.getWarehousesByOwner(userInfo.accountId!)
        : await warehouseApi.getAllWarehouses()

    if (res.statusCode === 200 || res.code === 0) {
      return {
        list: res.data || [],
        total: (res.data || []).length
      }
    }
    return { list: [], total: 0 }
  }
})

const { dataList, loading } = tableState
const { getList } = tableMethods

const viewDetail = (row: WarehouseListItem) => {
  push(`/warehouse/${row.warehouseId}/detail`)
}

const view3D = (row: WarehouseListItem) => {
  push(`/warehouse/${row.warehouseId}/3d-view`)
}

const viewItems = (row: WarehouseListItem) => {
  push(`/warehouse/${row.warehouseId}/items`)
}

const viewZones = (row: WarehouseListItem) => {
  push(`/warehouse/${row.warehouseId}/zones`)
}

const getStatusType = (status: string | null) => {
  const statusMap: Record<string, any> = {
    active: 'success',
    inactive: 'info',
    maintenance: 'warning',
    full: 'danger'
  }
  return statusMap[status || 'inactive'] || 'info'
}

const getStatusText = (status: string | null) => {
  const textMap: Record<string, string> = {
    active: 'Hoạt động',
    inactive: 'Không hoạt động',
    maintenance: 'Bảo trì',
    full: 'Đầy'
  }
  return textMap[status || 'inactive'] || 'Không xác định'
}

onMounted(() => {
  getList()
})
</script>

<template>
  <ContentWrap title="Danh Sách Kho" :message="'Quản lý tất cả các kho hàng trong hệ thống'">
    <Table
      :columns="columns"
      :data="dataList"
      :loading="loading"
      :pagination="{
        total: unref(tableState.total),
        currentPage: unref(tableState.currentPage),
        pageSize: unref(tableState.pageSize)
      }"
      @register="tableRegister"
    >
      <template #warehouseName="{ row }">
        <div class="flex items-center">
          <Icon icon="vi-ant-design:database-outlined" class="mr-5px" />
          <span class="font-bold">{{ row.warehouseName || 'Chưa đặt tên' }}</span>
        </div>
      </template>

      <template #size="{ row }">
        <span>{{ row.length }} × {{ row.width }} × {{ row.height }}</span>
      </template>

      <template #status="{ row }">
        <ElTag :type="getStatusType(row.status)">
          {{ getStatusText(row.status) }}
        </ElTag>
      </template>

      <template #action="{ row }">
        <div class="flex gap-5px">
          <ElButton size="small" type="primary" @click="viewDetail(row)">
            <Icon icon="vi-ant-design:eye-outlined" />
            Chi Tiết
          </ElButton>
          <ElButton size="small" type="success" @click="view3D(row)">
            <Icon icon="vi-ant-design:deployment-unit-outlined" />
            3D
          </ElButton>
          <ElButton size="small" type="info" @click="viewItems(row)">
            <Icon icon="vi-ant-design:inbox-outlined" />
            Hàng
          </ElButton>
          <ElButton size="small" type="warning" @click="viewZones(row)">
            <Icon icon="vi-ant-design:layout-outlined" />
            Khu vực
          </ElButton>
        </div>
      </template>
    </Table>
  </ContentWrap>
</template>

<style scoped lang="less">
.warehouse-overview {
  padding: 20px;
}

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

.mb-20px {
  margin-bottom: 20px;
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
