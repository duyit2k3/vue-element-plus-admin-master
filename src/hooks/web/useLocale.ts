import { i18n } from '@/plugins/vueI18n'
import { useLocaleStoreWithOut } from '@/store/modules/locale'
import { setHtmlPageLang } from '@/plugins/vueI18n/helper'
import zhCN from '@/locales/zh-CN'
import en from '@/locales/en'
import vi from '@/locales/vi'

const localeModules: Record<string, any> = {
  'zh-CN': zhCN,
  en: en,
  vi: vi
}

const setI18nLanguage = (locale: LocaleType) => {
  const localeStore = useLocaleStoreWithOut()

  if (i18n.mode === 'legacy') {
    i18n.global.locale = locale
  } else {
    ;(i18n.global.locale as any).value = locale
  }
  localeStore.setCurrentLocale({
    lang: locale
  })
  setHtmlPageLang(locale)
}

export const useLocale = () => {
  // Switching the language will change the locale of useI18n
  // And submit to configuration modification
  const changeLocale = async (locale: LocaleType) => {
    const globalI18n = i18n.global

    const langModule = localeModules[locale] ?? localeModules['zh-CN']

    globalI18n.setLocaleMessage(locale, langModule)

    setI18nLanguage(locale)
  }

  return {
    changeLocale
  }
}
