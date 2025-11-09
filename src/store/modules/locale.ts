import { defineStore } from 'pinia'
import { store } from '../index'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import vi from 'element-plus/es/locale/lang/vi'

import { useStorage } from '@/hooks/web/useStorage'
import { LocaleDropdownType } from '@/components/LocaleDropdown'

const { getStorage, setStorage } = useStorage('localStorage')

const elLocaleMap = {
  'zh-CN': zhCn,
  en: en,
  vi: vi
}
interface LocaleState {
  currentLocale: LocaleDropdownType
  localeMap: LocaleDropdownType[]
}

export const useLocaleStore = defineStore('locales', {
  state: (): LocaleState => {
    const savedLang = getStorage('lang') as LocaleType
    const validLang: LocaleType =
      savedLang && ['zh-CN', 'en', 'vi'].includes(savedLang) ? savedLang : 'vi'
    return {
      currentLocale: {
        lang: validLang,
        elLocale: elLocaleMap[validLang]
      },
      // 多语言
      localeMap: [
        {
          lang: 'zh-CN',
          name: '简体中文'
        },
        {
          lang: 'en',
          name: 'English'
        },
        {
          lang: 'vi',
          name: 'Tiếng Việt'
        }
      ]
    }
  },
  getters: {
    getCurrentLocale(): LocaleDropdownType {
      return this.currentLocale
    },
    getLocaleMap(): LocaleDropdownType[] {
      return this.localeMap
    }
  },
  actions: {
    setCurrentLocale(localeMap: LocaleDropdownType) {
      // this.locale = Object.assign(this.locale, localeMap)
      this.currentLocale.lang = localeMap?.lang
      this.currentLocale.elLocale = elLocaleMap[localeMap?.lang]
      setStorage('lang', localeMap?.lang)
    }
  }
})

export const useLocaleStoreWithOut = () => {
  return useLocaleStore(store)
}
