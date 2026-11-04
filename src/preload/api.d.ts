import type { SmartRouteApi } from './index'

declare global {
  interface Window {
    smartRoute: SmartRouteApi
  }
}
