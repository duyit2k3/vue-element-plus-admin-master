<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  ElCard,
  ElTable,
  ElTableColumn,
  ElDescriptions,
  ElDescriptionsItem,
  ElTag,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElDialog
} from 'element-plus'
import { Icon } from '@/components/Icon'
import outboundApi, { type OutboundRequestDetail, type OutboundItemDetail } from '@/api/outbound'
import warehouseApi from '@/api/warehouse'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/store/modules/user'
import { Qrcode } from '@/components/Qrcode'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const userRole = computed(() => userStore.getUserInfo?.role?.toLowerCase() || '')
const isCustomer = computed(() => userRole.value === 'customer')
const isWarehouseOwner = computed(() => userRole.value === 'warehouse_owner')

const receiptId = computed(() => {
  const raw = route.params.receiptId
  const n = Array.isArray(raw) ? Number(raw[0]) : Number(raw)
  return Number.isFinite(n) ? n : NaN
})

const detail = ref<OutboundRequestDetail | null>(null)
const loading = ref(false)

const showQrDialog = ref(false)
const currentQrText = ref('')

const warehouse3DData = ref<import('@/api/warehouse').Warehouse3DData | null>(null)
const loadingWarehouse3D = ref(false)

const loadDetail = async () => {
  const id = receiptId.value
  if (!Number.isFinite(id)) return
  loading.value = true
  try {
    const res = await outboundApi.getOutboundRequestDetail(id)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      detail.value = (res.data || null) as OutboundRequestDetail | null
    }
  } catch {
    ElMessage.error('Không thể tải chi tiết yêu cầu xuất kho')
  } finally {
    loading.value = false
  }
}

const statusText = computed(() => {
  const st = (detail.value?.status || '').toLowerCase()
  if (st === 'pending') return 'Chờ duyệt'
  if (st === 'completed') return 'Đã duyệt'
  if (st === 'cancelled') return 'Đã hủy'
  return detail.value?.status || ''
})

const statusType = computed<'info' | 'success' | 'warning' | 'danger' | ''>(() => {
  const st = (detail.value?.status || '').toLowerCase()
  if (st === 'pending') return 'warning'
  if (st === 'completed') return 'success'
  if (st === 'cancelled') return 'danger'
  return ''
})

const canCancel = computed(() => {
  if (!detail.value) return false
  const st = (detail.value.status || '').toLowerCase()
  return isCustomer.value && st === 'pending'
})

const canApproveOrReject = computed(() => {
  if (!detail.value) return false
  const st = (detail.value.status || '').toLowerCase()
  return isWarehouseOwner.value && st === 'pending'
})

const isCompleted = computed(() => {
  const st = (detail.value?.status || '').toLowerCase()
  return st === 'completed'
})

const handleCancel = async () => {
  if (!detail.value) return
  if (!canCancel.value) {
    ElMessage.warning('Chỉ có thể hủy yêu cầu ở trạng thái pending')
    return
  }

  try {
    const { value, action } = await ElMessageBox.prompt(
      'Nhập lý do hủy yêu cầu này',
      'Hủy yêu cầu xuất kho',
      {
        confirmButtonText: 'Hủy yêu cầu',
        cancelButtonText: 'Đóng',
        type: 'warning',
        inputPlaceholder: 'Ví dụ: Đã tạo nhầm, không còn nhu cầu xuất ...',
        inputType: 'textarea',
        inputValidator: (val: string) => {
          if (!val || !val.trim()) return 'Vui lòng nhập lý do hủy'
          return true
        }
      }
    )

    if (action !== 'confirm') return

    await outboundApi.updateOutboundRequestStatus(detail.value.receiptId, {
      status: 'cancelled',
      notes: value.trim()
    })

    ElMessage.success('Đã hủy yêu cầu xuất kho')
    await loadDetail()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('Không thể hủy yêu cầu, vui lòng thử lại')
  }
}

const handleApprove = async () => {
  if (!detail.value) return
  if (!canApproveOrReject.value) {
    ElMessage.warning('Chỉ có thể duyệt yêu cầu ở trạng thái pending')
    return
  }

  try {
    await ElMessageBox.confirm('Xác nhận duyệt yêu cầu xuất kho này?', 'Duyệt yêu cầu', {
      confirmButtonText: 'Duyệt',
      cancelButtonText: 'Hủy',
      type: 'warning'
    })

    await outboundApi.updateOutboundRequestStatus(detail.value.receiptId, {
      status: 'completed'
    })

    ElMessage.success('Đã duyệt yêu cầu xuất kho')

    router.push({
      name: 'WarehouseOutbound3DApproval',
      params: {
        id: detail.value.warehouseId
      },
      query: {
        receiptId: detail.value.receiptId
      }
    })
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('Không thể duyệt yêu cầu, vui lòng thử lại')
  }
}

const handleReject = async () => {
  if (!detail.value) return
  if (!canApproveOrReject.value) {
    ElMessage.warning('Chỉ có thể từ chối yêu cầu ở trạng thái pending')
    return
  }

  try {
    const { value, action } = await ElMessageBox.prompt(
      'Nhập lý do từ chối yêu cầu này',
      'Từ chối yêu cầu',
      {
        confirmButtonText: 'Từ chối',
        cancelButtonText: 'Hủy',
        type: 'warning',
        inputPlaceholder: 'Ví dụ: Thông tin chưa chính xác, không đủ hàng tồn kho ...',
        inputType: 'textarea',
        inputValidator: (val: string) => {
          if (!val || !val.trim()) return 'Vui lòng nhập lý do từ chối'
          return true
        }
      }
    )

    if (action !== 'confirm') return

    await outboundApi.updateOutboundRequestStatus(detail.value.receiptId, {
      status: 'cancelled',
      notes: value.trim()
    })

    ElMessage.success('Đã từ chối yêu cầu xuất kho')
    await loadDetail()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error('Không thể từ chối yêu cầu, vui lòng thử lại')
  }
}

const goBack = () => {
  router.back()
}

const viewOutboundReceipt = async () => {
  if (!detail.value || !detail.value.receiptId) {
    ElMessage.warning('Thiếu thông tin phiếu xuất để xuất PDF')
    return
  }

  try {
    const res: any = await (outboundApi as any).exportOutboundReceiptPdf(detail.value.receiptId)
    const blob: Blob | null = res && res.data instanceof Blob ? (res.data as Blob) : null

    if (!blob) {
      ElMessage.error('Dữ liệu phiếu xuất PDF không hợp lệ')
      return
    }

    const fileURL = URL.createObjectURL(blob)
    const win = window.open(fileURL, '_blank')
    if (!win) {
      ElMessage.warning('Trình duyệt chặn cửa sổ mới, vui lòng cho phép popup để xem PDF')
    }

    setTimeout(() => {
      URL.revokeObjectURL(fileURL)
    }, 60 * 1000)
  } catch {
    ElMessage.error('Không thể tải phiếu xuất PDF')
  }
}

const items = computed<OutboundItemDetail[]>(() => detail.value?.items || [])

const buildPalletQrText = (
  pallet: import('@/api/warehouse').PalletLocation,
  items: import('@/api/warehouse').ItemAllocation[]
) => {
  if (pallet.palletQrContent && typeof pallet.palletQrContent === 'string') {
    return pallet.palletQrContent
  }

  const qrLines: string[] = []
  qrLines.push(`Vị trí: (${pallet.positionX}, ${pallet.positionY}, ${pallet.positionZ})`)
  qrLines.push(
    `Kích thước pallet: ${pallet.palletLength}m × ${pallet.palletWidth}m × ${pallet.palletHeight}m`
  )
  qrLines.push('------------------')
  qrLines.push('Danh sách hàng trên pallet:')

  items.forEach((i) => {
    const unitSize =
      i.standardLength && i.standardWidth && i.standardHeight
        ? `${i.standardLength}m × ${i.standardWidth}m × ${i.standardHeight}m`
        : 'N/A'
    const stackSize = `${i.length}m × ${i.width}m × ${i.height}m`
    const qty = i.unitQuantity ?? null
    const qtyText = qty != null ? (i.unit ? `${qty} ${i.unit}` : `${qty}`) : 'N/A'
    const mfg = i.manufacturingDate || 'N/A'
    const exp = i.expiryDate || 'N/A'

    let weightText = ''
    const hasStdWeight = typeof i.standardWeight === 'number' && !Number.isNaN(i.standardWeight)
    const hasQty = typeof qty === 'number' && !Number.isNaN(qty)

    if (hasStdWeight && hasQty) {
      const totalWeight = Number(i.standardWeight) * Number(qty)
      if (Number.isFinite(totalWeight)) {
        weightText = `Trọng lượng: ${totalWeight} kg / Chuẩn: ${i.standardWeight} kg`
      }
    } else if (i.weight || i.standardWeight) {
      const parts: string[] = []
      if (i.weight != null) parts.push(`${i.weight} kg`)
      if (i.standardWeight != null) parts.push(`Chuẩn: ${i.standardWeight} kg`)
      weightText = `Trọng lượng: ${parts.join(' / ')}`
    }

    qrLines.push(`${i.productName || i.itemName || i.qrCode || 'Hàng hóa'}`)
    if (i.productCode) {
      qrLines.push(`Mã SP: ${i.productCode}`)
    }
    if (i.customerName) {
      qrLines.push(`Khách hàng: ${i.customerName}`)
    }
    qrLines.push(`Kích thước thùng (1 đơn vị): ${unitSize}`)
    qrLines.push(`Kích thước khối hàng trên pallet: ${stackSize}`)
    qrLines.push(`Số lượng đơn vị trên pallet: ${qtyText}`)
    if (weightText) {
      qrLines.push(weightText)
    }
    qrLines.push(`Ngày sản xuất: ${mfg}`)
    qrLines.push(`Hạn sử dụng: ${exp}`)
    if (i.productDescription) {
      qrLines.push(`Mô tả sản phẩm: ${i.productDescription}`)
    }
    if (i.storageConditions) {
      qrLines.push(`Lưu ý bảo quản: ${i.storageConditions}`)
    }
    if (i.unitPrice || i.totalAmount) {
      const unitPriceText = i.unitPrice != null ? i.unitPrice.toLocaleString() : ''
      const totalAmountText = i.totalAmount != null ? i.totalAmount.toLocaleString() : ''
      if (unitPriceText && totalAmountText) {
        qrLines.push(`Giá: ${unitPriceText} / đơn vị – Thành tiền: ${totalAmountText}`)
      } else if (unitPriceText) {
        qrLines.push(`Giá: ${unitPriceText} / đơn vị`)
      } else if (totalAmountText) {
        qrLines.push(`Thành tiền: ${totalAmountText}`)
      }
    }
    if (i.isFragile) {
      qrLines.push('⚠ Dễ vỡ')
    }
    if (i.isHeavy) {
      qrLines.push('⚠ Hàng nặng')
    }
    qrLines.push('')
  })

  return qrLines.join('\n')
}

const ensureWarehouse3DDataLoaded = async () => {
  if (!detail.value) return
  if (warehouse3DData.value || loadingWarehouse3D.value) return

  loadingWarehouse3D.value = true
  try {
    const res = await warehouseApi.getWarehouse3DData(detail.value.warehouseId)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      warehouse3DData.value = (res.data || null) as import('@/api/warehouse').Warehouse3DData | null
    }
  } catch {
    // ignore, sẽ fallback sang QR code của item
  } finally {
    loadingWarehouse3D.value = false
  }
}

const openQr = async (row: OutboundItemDetail) => {
  let qrText = ''

  // Ưu tiên dùng QR pallet giống Warehouse3DViewer nếu tìm được pallet chứa item này
  if (row.itemId && detail.value) {
    await ensureWarehouse3DDataLoaded()

    const data = warehouse3DData.value
    if (data && Array.isArray(data.items) && Array.isArray(data.pallets)) {
      const allItems = data.items as import('@/api/warehouse').ItemAllocation[]
      const alloc = allItems.find((i) => i.itemId === row.itemId)
      if (alloc && typeof alloc.palletId === 'number') {
        const pallet = data.pallets.find((p) => p.palletId === alloc.palletId)
        if (pallet) {
          const palletItems = allItems.filter((i) => i.palletId === alloc.palletId)
          qrText = buildPalletQrText(pallet, palletItems)
        }
      }
    }
  }

  // Nếu không tìm được pallet hoặc 3D data, fallback dùng QR code của từng item
  if (!qrText && row.qrCode) {
    qrText = row.qrCode
  }

  if (!qrText) return

  currentQrText.value = qrText
  showQrDialog.value = true
}

onMounted(() => {
  loadDetail()
})
</script>

<template>
  <div class="outbound-request-detail">
    <ElCard class="mb-20px" shadow="hover" :loading="loading">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Chi Tiết Yêu Cầu Xuất Kho</span>
          <div class="actions">
            <ElButton v-if="isCompleted && detail" text type="primary" @click="viewOutboundReceipt">
              <Icon icon="vi-ant-design:file-pdf-outlined" />
              Xem phiếu xuất
            </ElButton>
            <ElButton text type="primary" @click="goBack">
              <Icon icon="vi-ant-design:arrow-left-outlined" />
              Quay lại
            </ElButton>
            <ElButton text type="primary" @click="loadDetail">
              <Icon icon="vi-ep:refresh" />
              Làm mới
            </ElButton>
          </div>
        </div>
      </template>

      <ElDescriptions v-if="detail" :column="2" border>
        <ElDescriptionsItem label="Mã phiếu">
          {{ detail.receiptNumber }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Trạng thái">
          <ElTag :type="statusType || 'info'">{{ statusText }}</ElTag>
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Kho">
          {{ detail.warehouseName || `Kho #${detail.warehouseId}` }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Khách hàng">
          {{ detail.customerName || `Khách #${detail.customerId}` }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Ngày tạo yêu cầu">
          {{ detail.createdAt || '-' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Ngày xuất thực tế">
          {{ detail.outboundDate || '-' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Người tạo">
          {{ detail.createdByName || '-' }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Tổng số lượng" :span="2">
          {{ detail.totalItems }}
        </ElDescriptionsItem>
        <ElDescriptionsItem label="Ghi chú" :span="2">
          <span
            v-if="detail.notes"
            :style="
              detail.status && detail.status.toLowerCase() === 'cancelled' ? 'color: #f56c6c' : ''
            "
          >
            {{ detail.notes }}
          </span>
          <span v-else class="text-gray">—</span>
        </ElDescriptionsItem>
      </ElDescriptions>
      <div v-else class="text-gray text-sm">Không tìm thấy dữ liệu phiếu xuất.</div>

      <div class="mt-10 actions" v-if="detail">
        <ElButton v-if="canCancel" type="danger" text @click="handleCancel">
          <Icon icon="vi-ant-design:stop-outlined" />
          Hủy yêu cầu
        </ElButton>
        <ElButton v-if="canApproveOrReject" type="success" class="ml-5" @click="handleApprove">
          <Icon icon="vi-ant-design:check-circle-outlined" />
          Duyệt
        </ElButton>
        <ElButton v-if="canApproveOrReject" type="danger" text class="ml-5" @click="handleReject">
          <Icon icon="vi-ant-design:close-circle-outlined" />
          Từ chối
        </ElButton>
      </div>
    </ElCard>

    <ElCard shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Danh Sách Hàng Hóa</span>
        </div>
      </template>

      <ElTable :data="items" border size="small">
        <ElTableColumn prop="productCode" label="Mã SP" width="140" />
        <ElTableColumn label="Tên hàng" min-width="220">
          <template #default="{ row }">
            {{ row.productName || row.itemName }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="quantity" label="Số lượng" width="120" />
        <ElTableColumn prop="unit" label="Đơn vị" width="100" />
        <ElTableColumn label="Ngày sx - Hạn sd" width="220">
          <template #default="{ row }">
            <span>
              {{ row.manufacturingDate ? row.manufacturingDate.slice(0, 10) : '-' }}
              -
              {{ row.expiryDate ? row.expiryDate.slice(0, 10) : '-' }}
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="batchNumber" label="Số lô" width="160" />
        <ElTableColumn label="QR Code" width="160">
          <template #default="{ row }">
            <ElButton v-if="row.qrCode" type="primary" text size="small" @click="openQr(row)">
              <Icon icon="vi-ant-design:qrcode-outlined" />
              Xem QR
            </ElButton>
            <span v-else class="text-gray">—</span>
          </template>
        </ElTableColumn>
      </ElTable>
    </ElCard>

    <ElDialog v-model="showQrDialog" title="Mã QR hàng hóa" width="320px">
      <div v-if="currentQrText" class="qr-dialog-body">
        <Qrcode :text="currentQrText" :width="220" />
      </div>
    </ElDialog>
  </div>
</template>

<style scoped lang="less">
.outbound-request-detail {
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

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.text-lg {
  font-size: 18px;
}

.font-bold {
  font-weight: bold;
}

.text-gray {
  color: #909399;
}

.text-main {
  color: #303133;
}

.text-sm {
  font-size: 14px;
}

.mt-10 {
  margin-top: 10px;
}

.ml-5 {
  margin-left: 5px;
}

.qr-dialog-body {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px 0;
}
</style>
