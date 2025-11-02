import 'vue/jsx'

// windi css
import '@/plugins/unocss'

// svgIcon
import '@/plugins/svgIcon'

// Đa ngôn ngữ (i18n)
import { setupI18n } from '@/plugins/vueI18n'

// Import và khởi tạo store (Pinia/Vuex)
import { setupStore } from '@/store'

// Đăng ký các component toàn cục
import { setupGlobCom } from '@/components'

// thư viện UI Element Plus
import { setupElementPlus } from '@/plugins/elementPlus'

// Import các file style toàn cục
import '@/styles/index.less'

// Import thư viện hiệu ứng CSS (animate.css)
import '@/plugins/animate.css'

// Import và khởi tạo hệ thống router
import { setupRouter } from './router'

// Thiết lập các directive liên quan đến quyền hạn (ví dụ: v-permission)
import { setupPermission } from './directives'

import { createApp } from 'vue'

import App from './App.vue'

import './permission'

// Hàm khởi tạo toàn bộ ứng dụng
const setupAll = async () => {
  const app = createApp(App)

  await setupI18n(app)

  setupStore(app)

  setupGlobCom(app)

  setupElementPlus(app)

  setupRouter(app)

  setupPermission(app)

  app.mount('#app')
}

setupAll()
