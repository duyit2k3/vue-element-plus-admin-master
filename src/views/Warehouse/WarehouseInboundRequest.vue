<script setup lang="ts">
import { ref, reactive, onMounted, watch, computed } from 'vue'
import {
  ElCard,
  ElRow,
  ElCol,
  ElForm,
  ElFormItem,
  ElSelect,
  ElOption,
  ElTabs,
  ElTabPane,
  ElInput,
  ElInputNumber,
  ElDatePicker,
  ElTable,
  ElTableColumn,
  ElButton,
  ElMessage
} from 'element-plus'
import { Icon } from '@/components/Icon'
import warehouseApi, { type WarehouseListItem } from '@/api/warehouse'
import palletApi, {
  type PalletTemplate,
  type PalletViewModel,
  type CreatePalletRequest,
  type CreatePalletFromTemplateRequest
} from '@/api/pallet'
import productApi, { type ProductViewModel, type CreateProductRequest } from '@/api/product'
import inboundApi, {
  type InboundItemRequest,
  type CreateInboundRequestRequest,
  type InboundRequestListItem
} from '@/api/inbound'
import { useUserStore } from '@/store/modules/user'
import { useRoute } from 'vue-router'

const userStore = useUserStore()
const route = useRoute()

// Warehouse
const warehouses = ref<WarehouseListItem[]>([])
const selectedWarehouseId = ref<number | undefined>(undefined)
const loadingWarehouses = ref(false)
const inboundRequests = ref<InboundRequestListItem[]>([])
const loadingInboundRequests = ref(false)

const loadWarehouses = async () => {
  loadingWarehouses.value = true
  try {
    const userInfo = userStore.getUserInfo
    if (!userInfo) {
      return
    }
    let res: any
    if (userInfo.role === 'customer') {
      res = await (warehouseApi as any).getWarehousesByCustomer(userInfo.accountId!)
    } else if (userInfo.role === 'warehouse_owner') {
      res = await warehouseApi.getWarehousesByOwner(userInfo.accountId!)
    } else {
      res = await warehouseApi.getAllWarehouses()
    }
    if (res && (res.statusCode === 200 || res.code === 0)) {
      warehouses.value = (res.data || []) as WarehouseListItem[]
      if (!selectedWarehouseId.value && warehouses.value.length > 0) {
        const qId = route.query.warehouseId ? Number(route.query.warehouseId) : undefined
        const matched = qId ? warehouses.value.find((w) => w.warehouseId === qId) : undefined
        selectedWarehouseId.value = matched ? matched.warehouseId : warehouses.value[0].warehouseId
      }
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách kho')
  } finally {
    loadingWarehouses.value = false
  }
}

const loadInboundRequests = async () => {
  loadingInboundRequests.value = true
  try {
    const params: { warehouseId?: number } = {}
    if (selectedWarehouseId.value) {
      params.warehouseId = selectedWarehouseId.value
    }
    const res = await inboundApi.getInboundRequests(params)
    if (res && (res.statusCode === 200 || res.code === 0)) {
      inboundRequests.value = (res.data || []) as InboundRequestListItem[]
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách yêu cầu nhập kho')
  } finally {
    loadingInboundRequests.value = false
  }
}

// Pallet
const palletTab = ref<'template' | 'custom'>('template')
const palletTemplates = ref<PalletTemplate[]>([])
const createdPallets = ref<PalletViewModel[]>([])
const selectedPalletId = ref<number | undefined>(undefined)
const loadingPalletTemplates = ref(false)

const palletFromTemplateForm = reactive<{
  templateId: number | undefined
  barcode: string
  palletType: string
}>({
  templateId: undefined,
  barcode: '',
  palletType: ''
})

const customPalletForm = reactive<CreatePalletRequest>({
  barcode: '',
  length: 1,
  width: 1,
  height: 0.15,
  maxWeight: 1000,
  maxStackHeight: 1.5,
  palletType: ''
})

const loadPalletTemplates = async () => {
  loadingPalletTemplates.value = true
  try {
    const res = await palletApi.getTemplates()
    if (res && (res.statusCode === 200 || res.code === 0)) {
      palletTemplates.value = (res.data || []) as PalletTemplate[]
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách pallet template')
  } finally {
    loadingPalletTemplates.value = false
  }
}

const handleSelectPalletTemplate = (templateId: number) => {
  const tpl = palletTemplates.value.find((t) => t.templateId === templateId)
  if (tpl) {
    palletFromTemplateForm.palletType = tpl.palletType || ''
  }
}

const addCreatedPallet = (pallet: PalletViewModel) => {
  createdPallets.value.push(pallet)
  selectedPalletId.value = pallet.palletId
  ElMessage.success('Tạo pallet thành công')
}

const createPalletFromTemplate = async () => {
  if (!palletFromTemplateForm.templateId) {
    ElMessage.error('Vui lòng chọn template pallet')
    return
  }
  if (!palletFromTemplateForm.barcode) {
    ElMessage.error('Vui lòng nhập barcode pallet')
    return
  }
  const payload: CreatePalletFromTemplateRequest = {
    barcode: palletFromTemplateForm.barcode,
    palletType: palletFromTemplateForm.palletType || undefined
  }
  try {
    const res = await palletApi.createPalletFromTemplate(palletFromTemplateForm.templateId, payload)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      addCreatedPallet(res.data as PalletViewModel)
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo pallet từ template')
  }
}

const createCustomPallet = async () => {
  if (!customPalletForm.barcode) {
    ElMessage.error('Vui lòng nhập barcode pallet')
    return
  }
  if (!customPalletForm.length || !customPalletForm.width) {
    ElMessage.error('Chiều dài và chiều rộng pallet là bắt buộc')
    return
  }
  try {
    const res = await palletApi.createPallet(customPalletForm)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      addCreatedPallet(res.data as PalletViewModel)
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo pallet tùy chỉnh')
  }
}

// Product
const products = ref<ProductViewModel[]>([])
const selectedProductId = ref<number | undefined>(undefined)
const currentProductId = ref<number | undefined>(undefined)
const loadingProducts = ref(false)

const productForm = reactive<CreateProductRequest>({
  productCode: '',
  productName: '',
  description: '',
  unit: '',
  category: '',
  standardLength: undefined,
  standardWidth: undefined,
  standardHeight: undefined,
  standardWeight: undefined,
  isFragile: false,
  isHazardous: false,
  storageConditions: ''
})

const loadProducts = async () => {
  loadingProducts.value = true
  try {
    const res = await productApi.getAvailableProducts()
    if (res && (res.statusCode === 200 || res.code === 0)) {
      products.value = (res.data || []) as ProductViewModel[]
    }
  } catch (error) {
    ElMessage.error('Không thể tải danh sách sản phẩm')
  } finally {
    loadingProducts.value = false
  }
}

const handleSelectProduct = (productId: number) => {
  const p = products.value.find((x) => x.productId === productId)
  if (!p) return
  selectedProductId.value = productId
  currentProductId.value = productId
  productForm.productCode = p.productCode
  productForm.productName = p.productName
  productForm.description = p.description || ''
  productForm.unit = p.unit
  productForm.category = p.category || ''
  productForm.standardLength = p.standardLength || undefined
  productForm.standardWidth = p.standardWidth || undefined
  productForm.standardHeight = p.standardHeight || undefined
  productForm.standardWeight = p.standardWeight || undefined
  productForm.isFragile = p.isFragile ?? false
  productForm.isHazardous = p.isHazardous ?? false
  productForm.storageConditions = p.storageConditions || ''
}

const saveProductAsNew = async () => {
  if (!productForm.productCode || !productForm.productName || !productForm.unit) {
    ElMessage.error('Mã sản phẩm, tên và đơn vị là bắt buộc')
    return
  }
  try {
    const payload: CreateProductRequest = { ...productForm }
    const res = await productApi.createProduct(payload)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      const newProd = res.data as ProductViewModel
      products.value.push(newProd)
      selectedProductId.value = newProd.productId
      currentProductId.value = newProd.productId
      ElMessage.success('Tạo sản phẩm mới thành công')
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo sản phẩm mới')
  }
}

// Inbound items
const items = ref<InboundItemRequest[]>([])

const itemForm = reactive<{
  palletId: number | undefined
  quantity: number
  manufacturingDate: string
  expiryDate: string | undefined
  unitPrice: number
  totalAmount: number
  batchNumber: string
}>({
  palletId: undefined,
  quantity: 1,
  manufacturingDate: '',
  expiryDate: undefined,
  unitPrice: 0,
  totalAmount: 0,
  batchNumber: ''
})

watch(
  () => [itemForm.quantity, itemForm.unitPrice],
  () => {
    if (itemForm.quantity > 0 && itemForm.unitPrice > 0) {
      itemForm.totalAmount = Number((itemForm.quantity * itemForm.unitPrice).toFixed(2))
    }
  }
)

watch(
  () => selectedWarehouseId.value,
  () => {
    loadInboundRequests()
  }
)

const productNameMap = computed<Record<number, string>>(() => {
  const map: Record<number, string> = {}
  products.value.forEach((p) => {
    map[p.productId] = p.productName
  })
  return map
})

const currentPallet = computed<PalletViewModel | undefined>(() => {
  return createdPallets.value.find((p) => p.palletId === selectedPalletId.value)
})

const addItemToList = () => {
  if (!selectedWarehouseId.value) {
    ElMessage.error('Vui lòng chọn kho')
    return
  }
  const palletId = selectedPalletId.value
  if (!palletId) {
    ElMessage.error('Vui lòng tạo và chọn pallet')
    return
  }
  if (!currentProductId.value) {
    ElMessage.error('Vui lòng chọn hoặc tạo sản phẩm')
    return
  }
  if (!itemForm.manufacturingDate) {
    ElMessage.error('Vui lòng chọn ngày sản xuất')
    return
  }
  if (itemForm.quantity <= 0 || itemForm.unitPrice <= 0 || itemForm.totalAmount <= 0) {
    ElMessage.error('Số lượng, đơn giá và thành tiền phải lớn hơn 0')
    return
  }

  const payload: InboundItemRequest = {
    palletId,
    productId: currentProductId.value,
    quantity: itemForm.quantity,
    manufacturingDate: itemForm.manufacturingDate,
    expiryDate: itemForm.expiryDate || undefined,
    unitPrice: itemForm.unitPrice,
    totalAmount: itemForm.totalAmount,
    batchNumber: itemForm.batchNumber || undefined
  }

  items.value.push(payload)

  // Reset một phần form cho lần nhập tiếp theo
  itemForm.quantity = 1
  itemForm.manufacturingDate = ''
  itemForm.expiryDate = undefined
  itemForm.unitPrice = 0
  itemForm.totalAmount = 0
  itemForm.batchNumber = ''
}

const removeItem = (index: number) => {
  items.value.splice(index, 1)
}

// Submit inbound request
const notes = ref('')
const submitting = ref(false)

const submitRequest = async () => {
  if (!selectedWarehouseId.value) {
    ElMessage.error('Vui lòng chọn kho')
    return
  }
  if (items.value.length === 0) {
    ElMessage.error('Vui lòng thêm ít nhất một hàng hóa')
    return
  }
  const payload: CreateInboundRequestRequest = {
    warehouseId: selectedWarehouseId.value,
    items: items.value,
    notes: notes.value || undefined
  }
  submitting.value = true
  try {
    const res = await inboundApi.createInboundRequest(payload)
    if (res && (res.statusCode === 201 || res.statusCode === 200 || res.code === 0)) {
      const data: any = res.data || {}
      ElMessage.success(
        `Tạo yêu cầu nhập kho thành công. Mã phiếu: ${data.receiptNumber || data.ReceiptNumber || ''}`
      )
      items.value = []
      notes.value = ''
      // Có thể điều hướng tới trang danh sách yêu cầu trong tương lai
    }
  } catch (error: any) {
    ElMessage.error(error?.message || 'Lỗi khi tạo yêu cầu nhập kho')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  loadWarehouses()
  loadPalletTemplates()
  loadProducts()
})
</script>

<template>
  <div class="inbound-request">
    <!-- Bước 1: Chọn kho -->
    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">1. Chọn kho</span>
        </div>
      </template>
      <ElForm label-width="140px">
        <ElFormItem label="Kho" required>
          <ElSelect
            v-model="selectedWarehouseId"
            placeholder="Chọn kho đã thuê"
            :loading="loadingWarehouses"
            filterable
            clearable
          >
            <ElOption
              v-for="w in warehouses"
              :key="w.warehouseId"
              :label="w.warehouseName || `Kho #${w.warehouseId}`"
              :value="w.warehouseId"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
    </ElCard>

    <!-- Bước 2 + 3: Pallet & Product -->
    <ElRow :gutter="20" class="mb-20px">
      <!-- Pallet -->
      <ElCol :xs="24" :md="12">
        <ElCard shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="text-lg font-bold">2. Chọn / tạo pallet</span>
            </div>
          </template>
          <ElTabs v-model="palletTab">
            <ElTabPane label="Từ template" name="template">
              <ElForm label-width="140px">
                <ElFormItem label="Template" required>
                  <ElSelect
                    v-model="palletFromTemplateForm.templateId"
                    placeholder="Chọn template pallet"
                    :loading="loadingPalletTemplates"
                    filterable
                    @change="handleSelectPalletTemplate"
                  >
                    <ElOption
                      v-for="tpl in palletTemplates"
                      :key="tpl.templateId"
                      :label="tpl.templateName"
                      :value="tpl.templateId"
                    />
                  </ElSelect>
                </ElFormItem>
                <ElFormItem label="Barcode" required>
                  <ElInput
                    v-model="palletFromTemplateForm.barcode"
                    placeholder="Mã barcode pallet"
                  />
                </ElFormItem>
                <ElFormItem label="Loại pallet">
                  <ElInput v-model="palletFromTemplateForm.palletType" placeholder="Loại pallet" />
                </ElFormItem>
                <ElFormItem>
                  <ElButton type="primary" @click="createPalletFromTemplate">
                    <Icon icon="vi-ant-design:plus-square-outlined" />
                    Tạo pallet từ template
                  </ElButton>
                </ElFormItem>
              </ElForm>
            </ElTabPane>
            <ElTabPane label="Tùy chỉnh" name="custom">
              <ElForm label-width="140px">
                <ElFormItem label="Barcode" required>
                  <ElInput v-model="customPalletForm.barcode" placeholder="Mã barcode pallet" />
                </ElFormItem>
                <ElFormItem label="Kích thước (m)" required>
                  <div class="inline-inputs">
                    <ElInputNumber v-model="customPalletForm.length" :min="0.01" :step="0.1" />
                    <span class="mx-5">×</span>
                    <ElInputNumber v-model="customPalletForm.width" :min="0.01" :step="0.1" />
                    <span class="mx-5">×</span>
                    <ElInputNumber v-model="customPalletForm.height" :min="0.01" :step="0.01" />
                  </div>
                </ElFormItem>
                <ElFormItem label="Tải trọng tối đa (kg)">
                  <ElInputNumber v-model="customPalletForm.maxWeight" :min="0.01" :step="10" />
                </ElFormItem>
                <ElFormItem label="Chiều cao xếp chồng (m)">
                  <ElInputNumber
                    v-model="customPalletForm.maxStackHeight"
                    :min="0.01"
                    :step="0.1"
                  />
                </ElFormItem>
                <ElFormItem label="Loại pallet">
                  <ElInput v-model="customPalletForm.palletType" placeholder="Loại pallet" />
                </ElFormItem>
                <ElFormItem>
                  <ElButton type="primary" @click="createCustomPallet">
                    <Icon icon="vi-ant-design:plus-square-outlined" />
                    Tạo pallet tùy chỉnh
                  </ElButton>
                </ElFormItem>
              </ElForm>
            </ElTabPane>
          </ElTabs>

          <div v-if="createdPallets.length" class="mt-10">
            <div class="text-sm mb-5">Pallet đã tạo:</div>
            <ElSelect v-model="selectedPalletId" placeholder="Chọn pallet để sử dụng" filterable>
              <ElOption
                v-for="p in createdPallets"
                :key="p.palletId"
                :label="`${p.barcode} (${p.length}×${p.width}×${p.height}m)`"
                :value="p.palletId"
              />
            </ElSelect>
          </div>
        </ElCard>
      </ElCol>

      <!-- Product -->
      <ElCol :xs="24" :md="12">
        <ElCard shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="text-lg font-bold">3. Chọn / tạo sản phẩm</span>
            </div>
          </template>
          <ElForm label-width="140px">
            <ElFormItem label="Mẫu sản phẩm">
              <ElSelect
                v-model="selectedProductId"
                placeholder="Chọn sản phẩm có sẵn"
                :loading="loadingProducts"
                filterable
                @change="handleSelectProduct"
              >
                <ElOption
                  v-for="p in products"
                  :key="p.productId"
                  :label="`${p.productCode} - ${p.productName}`"
                  :value="p.productId"
                />
              </ElSelect>
            </ElFormItem>
            <ElFormItem label="Mã sản phẩm" required>
              <ElInput v-model="productForm.productCode" />
            </ElFormItem>
            <ElFormItem label="Tên sản phẩm" required>
              <ElInput v-model="productForm.productName" />
            </ElFormItem>
            <ElFormItem label="Mô tả">
              <ElInput v-model="productForm.description" type="textarea" :rows="2" />
            </ElFormItem>
            <ElFormItem label="Đơn vị" required>
              <ElInput v-model="productForm.unit" />
            </ElFormItem>
            <ElFormItem label="Danh mục">
              <ElInput v-model="productForm.category" />
            </ElFormItem>
            <ElFormItem label="Kích thước chuẩn (m)">
              <div class="inline-inputs">
                <ElInputNumber v-model="productForm.standardLength" :min="0.01" :step="0.1" />
                <span class="mx-5">×</span>
                <ElInputNumber v-model="productForm.standardWidth" :min="0.01" :step="0.1" />
                <span class="mx-5">×</span>
                <ElInputNumber v-model="productForm.standardHeight" :min="0.01" :step="0.01" />
              </div>
            </ElFormItem>
            <ElFormItem label="Trọng lượng chuẩn (kg)">
              <ElInputNumber v-model="productForm.standardWeight" :min="0.01" :step="0.1" />
            </ElFormItem>
            <ElFormItem label="Dễ vỡ / Nguy hiểm">
              <div class="inline-inputs">
                <label class="checkbox-label">
                  <input v-model="productForm.isFragile" type="checkbox" />
                  <span class="ml-5">Dễ vỡ</span>
                </label>
                <label class="checkbox-label ml-20">
                  <input v-model="productForm.isHazardous" type="checkbox" />
                  <span class="ml-5">Nguy hiểm</span>
                </label>
              </div>
            </ElFormItem>
            <ElFormItem label="Điều kiện lưu trữ">
              <ElInput v-model="productForm.storageConditions" />
            </ElFormItem>
            <ElFormItem>
              <ElButton type="primary" @click="saveProductAsNew">
                <Icon icon="vi-ant-design:save-outlined" />
                Lưu thành sản phẩm mới
              </ElButton>
            </ElFormItem>
          </ElForm>
        </ElCard>
      </ElCol>
    </ElRow>

    <!-- Bước 4: Thêm items và gửi yêu cầu -->
    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">4. Thêm hàng hóa vào yêu cầu</span>
        </div>
      </template>

      <ElForm label-width="180px" class="mb-20px">
        <ElFormItem label="Pallet sử dụng" required>
          <div class="product-summary">
            <span v-if="currentPallet">
              {{ currentPallet.barcode }}
              ({{ currentPallet.length }}×{{ currentPallet.width }}×{{ currentPallet.height }}m)
            </span>
            <span v-else class="text-gray">Chưa tạo hoặc chọn pallet</span>
          </div>
        </ElFormItem>
        <ElFormItem label="Sản phẩm" required>
          <div class="product-summary">
            <span v-if="currentProductId">
              {{ productNameMap[currentProductId] || 'Sản phẩm đã chọn' }}
            </span>
            <span v-else class="text-gray">Chưa chọn sản phẩm</span>
          </div>
        </ElFormItem>
        <ElFormItem label="Số lượng" required>
          <ElInputNumber v-model="itemForm.quantity" :min="1" />
        </ElFormItem>
        <ElFormItem label="Ngày sản xuất" required>
          <ElDatePicker
            v-model="itemForm.manufacturingDate"
            type="date"
            placeholder="Chọn ngày sản xuất"
            value-format="YYYY-MM-DD"
          />
        </ElFormItem>
        <ElFormItem label="Ngày hết hạn">
          <ElDatePicker
            v-model="itemForm.expiryDate"
            type="date"
            placeholder="Chọn ngày hết hạn (nếu có)"
            value-format="YYYY-MM-DD"
          />
        </ElFormItem>
        <ElFormItem label="Đơn giá (VNĐ)" required>
          <ElInputNumber v-model="itemForm.unitPrice" :min="0.01" :step="1000" />
        </ElFormItem>
        <ElFormItem label="Thành tiền (VNĐ)" required>
          <ElInputNumber v-model="itemForm.totalAmount" :min="0.01" :step="1000" />
        </ElFormItem>
        <ElFormItem label="Số lô">
          <ElInput v-model="itemForm.batchNumber" />
        </ElFormItem>
        <ElFormItem>
          <ElButton type="primary" @click="addItemToList">
            <Icon icon="vi-ant-design:plus-circle-outlined" />
            Thêm vào danh sách hàng hóa
          </ElButton>
        </ElFormItem>
      </ElForm>

      <ElTable v-if="items.length" :data="items" border size="small">
        <ElTableColumn type="index" label="#" width="60" />
        <ElTableColumn prop="palletId" label="Pallet" width="100" />
        <ElTableColumn label="Sản phẩm">
          <template #default="scope">
            {{ productNameMap[scope.row.productId] || scope.row.productId }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="quantity" label="Số lượng" width="100" />
        <ElTableColumn prop="manufacturingDate" label="Ngày SX" width="120" />
        <ElTableColumn prop="expiryDate" label="Ngày HH" width="120" />
        <ElTableColumn prop="unitPrice" label="Đơn giá" width="120" />
        <ElTableColumn prop="totalAmount" label="Thành tiền" width="140" />
        <ElTableColumn prop="batchNumber" label="Số lô" width="140" />
        <ElTableColumn label="Thao tác" width="100">
          <template #default="scope">
            <ElButton type="danger" text size="small" @click="removeItem(scope.$index)">
              Xóa
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div v-else class="text-gray text-sm">Chưa có hàng hóa nào trong yêu cầu.</div>
    </ElCard>

    <ElCard shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Hoàn tất yêu cầu</span>
        </div>
      </template>
      <ElForm label-width="140px">
        <ElFormItem label="Ghi chú">
          <ElInput v-model="notes" type="textarea" :rows="3" />
        </ElFormItem>
        <ElFormItem>
          <ElButton type="primary" :loading="submitting" @click="submitRequest">
            <Icon icon="vi-ant-design:send-outlined" />
            Gửi yêu cầu nhập kho
          </ElButton>
        </ElFormItem>
      </ElForm>
    </ElCard>

    <ElCard class="mb-20px" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="text-lg font-bold">Danh sách yêu cầu nhập kho</span>
          <ElButton
            text
            type="primary"
            :loading="loadingInboundRequests"
            @click="loadInboundRequests"
          >
            <Icon icon="vi-ep:refresh" />
            Làm mới
          </ElButton>
        </div>
      </template>
      <ElTable
        v-if="inboundRequests.length"
        :data="inboundRequests"
        border
        size="small"
        v-loading="loadingInboundRequests"
      >
        <ElTableColumn prop="receiptNumber" label="Mã phiếu" width="180" />
        <ElTableColumn prop="warehouseName" label="Kho" min-width="200" />
        <ElTableColumn prop="inboundDate" label="Ngày yêu cầu" width="160" />
        <ElTableColumn prop="status" label="Trạng thái" width="120" />
        <ElTableColumn prop="totalItems" label="Số hàng" width="100" />
        <ElTableColumn prop="totalPallets" label="Số pallet" width="110" />
        <ElTableColumn prop="createdByName" label="Người tạo" min-width="180" />
      </ElTable>
      <div v-else class="text-gray text-sm">Chưa có yêu cầu nhập kho nào.</div>
    </ElCard>
  </div>
</template>

<style scoped lang="less">
.inbound-request {
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

.inline-inputs {
  display: flex;
  align-items: center;
}

.mx-5 {
  margin: 0 5px;
}

.ml-5 {
  margin-left: 5px;
}

.ml-20 {
  margin-left: 20px;
}

.mt-10 {
  margin-top: 10px;
}

.text-gray {
  color: #909399;
}

.product-summary {
  display: flex;
  min-height: 24px;
  align-items: center;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
}
</style>
