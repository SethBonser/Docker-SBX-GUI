import { ElectronAPI } from '@electron-toolkit/preload'
import type { SbxApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    sbxApi: SbxApi
  }
}
