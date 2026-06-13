import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Electron 环境下必须从本地 node_modules 加载，禁用 CDN
loader.config({ monaco })
