import type { RouteRecordRaw } from 'vue-router'
import { defineComponent } from 'vue'

/**
* redirect: noredirect        Khi thiết lập là noredirect, route này sẽ **không thể click được trong breadcrumb**
* name: 'router-name'         Đặt tên cho route — **bắt buộc phải có**, nếu không sẽ gặp lỗi khi dùng <keep-alive>
* meta: {
    hidden: true              Khi thiết lập là true, **route sẽ không hiển thị trên sidebar**
                               (thường dùng cho các trang như 404, login, v.v.) — mặc định là false

    alwaysShow: true          Nếu một route cha có nhiều hơn 1 route con, nó sẽ tự động trở thành dạng lồng nhau.
                              Nhưng nếu chỉ có 1 route con, route cha **sẽ không hiển thị** trên sidebar.
                              Nếu bạn muốn **luôn hiển thị route cha** dù có bao nhiêu route con,
                              thì hãy đặt alwaysShow: true — nó sẽ **bỏ qua quy tắc mặc định**

    title: 'title'            Tiêu đề của route — được **hiển thị trên sidebar và breadcrumb**

    icon: 'svg-name'          Tên biểu tượng (SVG) sẽ hiển thị kèm với tiêu đề trong sidebar

    noCache: true             Nếu là true, **component sẽ không được cache** bởi <keep-alive> — mặc định là false

    breadcrumb: false         Nếu là false, **route sẽ không hiển thị trong breadcrumb** — mặc định là true

    affix: true               Nếu là true, **route sẽ luôn được ghim trên tag view (thanh tab)** — mặc định là false

    noTagsView: true          Nếu là true, **route sẽ không hiển thị trong tag view (thanh tab)** — mặc định là false

    activeMenu: '/dashboard'  Dùng để chỉ định route cần được **highlight (làm nổi bật) trong sidebar**
                               Thường dùng khi ở các trang chi tiết mà muốn làm nổi route cha

    canTo: true               Khi đặt là true, **dù route đang hidden**, vẫn **có thể điều hướng tới route này** — mặc định là false

    permission: ['edit','add', 'delete']    Danh sách quyền (permission) yêu cầu để truy cập route này
  }
**/


interface RouteMetaCustom extends Record<string | number | symbol, unknown> {
  hidden?: boolean
  alwaysShow?: boolean
  title?: string
  icon?: string
  noCache?: boolean
  breadcrumb?: boolean
  affix?: boolean
  activeMenu?: string
  noTagsView?: boolean
  canTo?: boolean
  permission?: string[]
}

declare module 'vue-router' {
  interface RouteMeta extends RouteMetaCustom {}
}

type Component<T = any> =
  | ReturnType<typeof defineComponent>
  | (() => Promise<typeof import('*.vue')>)
  | (() => Promise<T>)

declare global {
  declare interface AppRouteRecordRaw extends Omit<RouteRecordRaw, 'meta' | 'children'> {
    name: string
    meta: RouteMetaCustom
    component?: Component | string
    children?: AppRouteRecordRaw[]
    props?: Recordable
    fullPath?: string
  }

  declare interface AppCustomRouteRecordRaw
    extends Omit<RouteRecordRaw, 'meta' | 'component' | 'children'> {
    name: string
    meta: RouteMetaCustom
    component: string
    path: string
    redirect: string
    children?: AppCustomRouteRecordRaw[]
  }
}
