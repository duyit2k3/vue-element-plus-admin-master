<script setup lang="ts">
import { ElCard, ElButton, ElSpace, ElDivider } from 'element-plus'

const emit = defineEmits<{
  addWarehouse: []
  inbound: []
  outbound: []
  searchItem: []
  optimize: []
  exportPDF: []
  manageZones: []
  manageRacks: []
}>()
</script>

<template>
  <ElCard shadow="hover" class="action-panel">
    <template #header>
      <div class="card-header">
        <Icon icon="ep:operation" class="mr-2" />
        <span>Hành Động Kho</span>
      </div>
    </template>

    <div class="action-section">
      <div class="section-title">Quản Lý Kho</div>
      <ElSpace wrap>
        <ElButton type="primary" @click="emit('addWarehouse')">
          <Icon icon="ep:plus" class="mr-1" />
          Thêm Kho Mới
        </ElButton>
        <ElButton type="success" @click="emit('manageZones')">
          <Icon icon="ep:office-building" class="mr-1" />
          Quản Lý Khu Vực
        </ElButton>
        <ElButton type="info" @click="emit('manageRacks')">
          <Icon icon="ep:grid" class="mr-1" />
          Quản Lý Kệ
        </ElButton>
      </ElSpace>
    </div>

    <ElDivider />

    <div class="action-section">
      <div class="section-title">Nhập/Xuất Kho</div>
      <ElSpace wrap>
        <ElButton type="success" @click="emit('inbound')">
          <Icon icon="ep:download" class="mr-1" />
          Nhập Kho
        </ElButton>
        <ElButton type="warning" @click="emit('outbound')">
          <Icon icon="ep:upload" class="mr-1" />
          Xuất Kho
        </ElButton>
      </ElSpace>
    </div>

    <ElDivider />

    <div class="action-section">
      <div class="section-title">Tìm Kiếm & Tối Ưu</div>
      <ElSpace wrap>
        <ElButton @click="emit('searchItem')">
          <Icon icon="ep:search" class="mr-1" />
          Tìm Hàng Hóa
        </ElButton>
        <ElButton type="primary" @click="emit('optimize')">
          <Icon icon="ep:magic-stick" class="mr-1" />
          Tối Ưu Sắp Xếp
        </ElButton>
      </ElSpace>
    </div>

    <ElDivider />

    <div class="action-section">
      <div class="section-title">Báo Cáo & Xuất</div>
      <ElSpace wrap>
        <ElButton type="danger" @click="emit('exportPDF')">
          <Icon icon="ep:document" class="mr-1" />
          Xuất PDF
        </ElButton>
      </ElSpace>
    </div>
  </ElCard>
</template>

<style scoped lang="less">
.action-panel {
  .card-header {
    display: flex;
    align-items: center;
    font-weight: bold;
  }

  .action-section {
    margin-bottom: 10px;

    .section-title {
      margin-bottom: 12px;
      font-size: 14px;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }
  }
}
</style>
