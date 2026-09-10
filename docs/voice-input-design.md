# 语音输入（ASR 听写）方案与可行性分析

> ## 🟡 状态：**已评估，暂缓实现**（2026-09-10 决定）
>
> **结论：技术完全可行，方案已论证到可直接落码的程度，但产品侧决定「很长一段时间内不做」。**
> 本文因此作为**存档**保留——不是"待办"，也不代表正在推进。未来若重新考虑，可直接从 §4 的实现清单开始，无需重做调研。
>
> 暂缓时的判断依据（一句话）：云端方案的费用与体积成本都近乎为零，但**它是"锦上添花"而非用户痛点**；而本地方案的 +251MB 体积 / +302MB 内存与"纯本地"卖点之间的取舍，不足以支撑现在投入。
>
> 已完成的可复用资产：① 全部技术未知数已实测消除（§3.4）；② 探针工程留在 `E:\_asr-probe`；③ 经验已沉淀进 skill `electron-feature-feasibility-audit`（权限/CSP/安全上下文/本地推理的通用审计清单）。

> 目标：在 AI 输入框的**发送按钮旁边**增加一个语音输入按钮 —— 按下说话/点击录音 → 本地录音 → 转文字 → 回填输入框（或直接发送）。
> 目标分支：`feature/v3.1.0`。本文只做方案与可行性论证，不含实现代码。

---

## 0. 结论速览

| 结论 | 判定 | 依据 |
|---|---|---|
| 浏览器原生 Web Speech API（`webkitSpeechRecognition`） | ❌ **不可行，直接排除** | Electron 不含 Google Speech API 密钥 → 固定 `network` error，且 Google 明确禁止衍生品使用（见 §2.1） |
| `getUserMedia` + `MediaRecorder` 在渲染层录音 | ✅ 可行，**零改造成本** | 沙箱/上下文隔离开启不影响 Web 平台 API；`file://` 与 `http://localhost` 都是安全上下文（见 §2.2） |
| 麦克风权限 | ✅ 开箱即通，但**建议显式收紧** | Electron 默认自动批准**所有**权限请求——本仓库未设 handler（见 §2.3） |
| 主进程调用云端 ASR（OpenAI 兼容 `/audio/transcriptions`） | ✅ 可行，**推荐路线** | 已有 `net.fetch` 传输层 + DPAPI 密钥箱 + `validateProviderUrl` 白名单，**完全绕开 CSP/CORS**（见 §2.4） |
| **云端 ASR 的费用** | ✅ **可做到 0 元** | 硅基流动 `SenseVoiceSmall` **免费**（2026-08 官方价格页）；OpenAI 档 $0.003~0.006/min，语音输入级用量约每月几元。且**走用户自己的 Key → 产品方服务器成本为 0**（见 §3.1） |
| 纯本地离线 ASR（sherpa-onnx） | ✅ **可行，且 Windows 不需编译** | Windows x64 官方预编译（引擎仅 +32.8MB），中文模型 20MB / 229MB 两档，**永不联网**（见 §3.2） |
| 是否需要改 CSP | ✅ **不需要**（除非要做"录完回放确认"） | 录音不触发 CSP；仅 `blob:` 播放会被 `default-src 'self'` 拦（见 §2.5） |
| 是否需要新依赖 | ✅ **不需要** | 出站 multipart 用 Node 20 内置 `FormData`/手写 Buffer 即可，无新包（见 §4.5） |
| 首屏体积影响 | ✅ 零影响 | 无新依赖、无新 lazy 边界（见 §5.4） |

**推荐：方案 B（云端 OpenAI 兼容转写，复用已有供应商体系）做 P0 → 本地离线做 P2 兜底。**

---

## 1. 现状核查（本仓库事实基线）

| 项 | 现状 | 位置 |
|---|---|---|
| Electron | **33.2.0**（Chromium 130 / Node 20.18） | `node_modules/electron/package.json` |
| 渲染进程沙箱 | `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false` | `electron/main/index.ts:251-256` |
| 权限处理器 | **未设置** `setPermissionRequestHandler` / `setPermissionCheckHandler` | 全仓库 grep 无命中 |
| CSP | `default-src 'self'; script-src 'self'; …` —— **未声明 `connect-src` / `media-src`** | `index.html:6` |
| 主进程出站 HTTP | `net.fetch`（`llmService.httpJson`），超时 + `AbortSignal.any` | `electron/lib/llmService.ts:110-121` |
| 供应商模型 | `ProviderConfig{ id, name, type: openai-compatible\|ollama\|anthropic, baseUrl, apiKeyEncrypted, enabled, models[], headers }` | `electron/lib/llmService.ts:19-31` |
| 密钥存储 | DPAPI 加解密（`encryptSecret` / `decryptSecret`） | `electron/lib/secretBox.ts` |
| URL 白名单 | `validateProviderUrl`：https 放行；http 仅本机 | `electron/lib/llmService.ts:93-101` |
| 出站 multipart | **不存在**（`lanShare/upload.ts` 是入站解析器） | grep 确认 |
| 已有"转写" | `transcribeVision` 是 **PDF→视觉模型 OCR**，与音频无关，勿混淆 | `electron/lib/aiTeachingSources.ts:516` |
| 已有音频能力 | 仅有 TTS（`speechSynthesis` 朗读） | `src/lib/tts.ts` |
| 设置 schema | 单源 `SETTINGS`，`ui:true && anchor` 才进设置页搜索 | `src/lib/settings.ts` / `modules/settings/sections.tsx:84` |
| 新增 IPC 的三处落点 | preload API + `ElectronAPI` 接口 + `ipcMain.handle` | `electron/preload/index.ts` / `src/types/index.ts:942` |

### 1.1 需要挂按钮的 4 个输入区（"发送按钮旁边"不止一处）

| # | 位置 | 文件:行 | 说明 |
|---|---|---|---|
| 1 | AI 助手侧栏输入区 | `src/components/shared/AssistantPanel/index.tsx:722-736` | 全局侧栏（`App.tsx:781` 常驻），**主要目标** |
| 2 | AI 学堂 `Composer`（紧凑态） | `src/components/shared/AiLearn/index.tsx:209` | 复用 #3 组件 |
| 3 | AI 学堂 `Composer`（常规态） | `src/components/shared/AiLearn/index.tsx:453` | 组件定义在 `:106-137` |
| 4 | AI 教学对话输入 | `src/modules/ai-teaching/index.tsx:2054` + 发送按钮 `:2256` | 独立实现 |

> **设计含义**：抽一个 `<VoiceInputButton>` + `useVoiceInput()`，插到 #1 与 #4；#2/#3 因为共用 `Composer`，只改一处即自动覆盖。**共改 3 个文件即可覆盖全部 4 个输入区。**

---

## 2. 可行性逐条论证

### 2.1 ❌ Web Speech API —— 不可行（必须排除的"零成本假象"）

`webkitSpeechRecognition` 看起来是最省事的方案，但在 Electron 里**结构性不可用**：

- Chromium 的语音识别是**云端服务**，依赖编译进 Chrome 的 Google API Key；
- Electron 未包含该密钥，且 Google 明确表示 *"many of the Google APIs used by Chromium code are specific to Google Chrome and not intended for use in derived products"*，**不提供额外配额**；
- 结果：`onerror` 固定返回 `network`（"Network communication required for completing the recognition failed"），**在 Electron 32~35 全版本持续存在**；
- 民间绕法（设 `GOOGLE_API_KEY` 环境变量）需要用户自备 Google Cloud 密钥、且会污染系统级 Chrome 行为，**不可作为产品功能分发**。

> ⚠️ 排除这条很重要：否则很容易写成"用 Web Speech API，半小时搞定"，然后在真机上撞 `network` 且找不到原因。

### 2.2 ✅ 渲染层录音（`getUserMedia` + `MediaRecorder`）

| 关注点 | 结论 |
|---|---|
| `sandbox: true` 是否影响 | **不影响**。`getUserMedia`/`MediaRecorder` 是 Web 平台 API，与 Node 集成无关 |
| 生产 `file://` 是否安全上下文 | **是**。Chromium 把 `file:` 视为 potentially trustworthy origin，`navigator.mediaDevices` 正常暴露 |
| 开发 `http://localhost:7173` | 也是安全上下文（localhost 例外），dev 同样可用 |
| 编解码 | Chromium 自带 `audio/webm;codecs=opus`（无需依赖，用 `MediaRecorder.isTypeSupported` 探测即可） |
| 额外 webPreferences | **不需要**。网上流传的 `allowMediaDevices: true` **不是真实存在的 Electron 选项**（已核对 `electron.d.ts` 无此字段），不要照抄 |

### 2.3 ⚠️ 麦克风权限：默认放行，但建议显式收紧

Electron 官方文档原文：

> *"默认情况下，Electron 将自动批准所有的许可请求，除非开发者手动配置一个自定义处理函数。"*（"有安全意识的开发者可能希望默认反着来"）

本仓库**未配置任何 handler**，所以 `getUserMedia({ audio: true })` 会**直接成功**，不需要改主进程代码。

但本仓库的安全风格偏严（clipper 走 Origin 白名单 + Bearer token、`validateProviderUrl` 禁明文 http、DPAPI 加密密钥），而"默认批准所有权限"意味着**任何被注入的渲染代码都能静默开麦/开摄像头**。建议顺手补齐：

```ts
session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
  if (permission === 'media') {
    // 只放行麦克风，摄像头一律拒（Electron 把 camera/mic 合并为 media）
    const types = (details as any)?.mediaTypes ?? []
    return callback(types.length > 0 && types.every(t => t === 'audio'))
  }
  if (permission === 'display-capture') return callback(false)
  callback(false)   // 其余默认全拒
})
```

> `media` 权限**同时涵盖摄像头与麦克风**（Electron 不区分），必须用 `details.mediaTypes` 细分——不细分就等于给摄像头也开了口子。

### 2.4 ✅ 主进程转写：复用既有传输层，绕开 CSP 与 CORS

这是整个方案最省事的一环，因为链路已经存在：

```
渲染层 MediaRecorder → ArrayBuffer → IPC（结构化克隆）
   → 主进程 asrService.transcribe() → net.fetch({baseUrl}/audio/transcriptions, multipart)
   → { text } → 回填输入框
```

- **无需改 CSP**：`net.fetch` 在主进程，不受渲染层 `connect-src` 约束；
- **无 CORS**：不是浏览器同源请求；
- **密钥安全**：复用 `decryptSecret(p.apiKeyEncrypted)`，明文只在内存瞬间存在，渲染层拿不到；
- **地址校验**：复用 `validateProviderUrl`（https 才放行非本机地址），与 LLM 供应商同一把尺子；
- **多供应商**：直接复用现有供应商列表，用户**不必再填一遍 Key**（这是相对自建 ASR 接口最大的体验优势）。

### 2.5 CSP 复核：唯一会被拦的是"录完回放"

CSP 为 `default-src 'self'`，缺省回落到 `'self'`：

| 行为 | 是否受 CSP 约束 | 结论 |
|---|---|---|
| `getUserMedia` 取流 | 否（设备 API，非资源加载） | ✅ 通 |
| `MediaRecorder` 录制 | 否 | ✅ 通 |
| 上传到主进程 | 否（IPC） | ✅ 通 |
| **`<audio src={URL.createObjectURL(blob)}>` 回放** | **是**（`media-src 'self'` 不含 `blob:`） | ❌ 被拦，报 `MEDIA_ELEMENT_ERROR` |

> 若产品要"录完先回放确认再转写"，必须给 CSP 加 `media-src 'self' blob:`。**P0 不做回放即可完全不碰 CSP。**

### 2.6 ⚠️ 系统级前置条件（写进 FAQ / 错误提示）

Windows 有全局开关：**设置 → 隐私和安全性 → 麦克风 → "允许桌面应用访问你的麦克风"**。关闭时 `getUserMedia` 直接 reject。错误文案里必须带这句指引，否则用户只会看到"无法访问麦克风"而毫无头绪。

---

## 3. 三档方案对比

| 维度 | **A. Web Speech API** | **B. 云端 ASR（OpenAI 兼容）** ⭐ | **C. 本地离线 ASR** |
|---|---|---|---|
| 可行性 | ❌ Electron 不可用 | ✅ 完全可行 | ✅ 可行，**生态已成熟且 Windows 不需编译** |
| 新依赖 | 0 | **0**（Node 内置 FormData） | `sherpa-onnx-node`：引擎 **+32.8MB**（Windows x64 官方预编译）+ 模型 20~229MB |
| 需要密钥 | Google Cloud 密钥（不可分发） | **复用已有供应商 Key** | **无**（且不联网、不依赖 ModelScope） |
| 中文准确率 | — | 高（SenseVoice / Whisper / glm-asr） | 高（同一批模型：SenseVoice 内置标点恢复 + VAD） |
| 延迟 | — | 0.3~2s（整段上传后转写） | 非流式=说完才出字；流式模型首字约 0.5s（RTF≈0.3~0.45，需自测） |
| 隐私 | 音频出本机 | **音频出本机**（需明确告知） | **全程不出本机** ✅ |
| 与产品定位 | — | ⚠️ 与"纯本地无云"叙事有张力 | ✅ 完全契合 |
| 打包体积 | — | 0 | 装完占磁盘 **+48MB**（小模型）/ **+251MB**（SenseVoice）；安装包 +28MB / +161MB（§3.4⑦ 实测） |
| 落地工作量 | — | **小（约 1 人日量级）** | 中（≥ 3 人日：采集层换 AudioWorklet + asarUnpack/模型分发） |

### 3.1 云端候选与费用（价格核实于 2026-09）

均为 OpenAI 兼容 `/audio/transcriptions`，可直接复用现有供应商体系：

| 供应商 | Base URL | 模型 | 价格（核实日期） | 备注 |
|---|---|---|---|---|
| **硅基流动 SiliconFlow** | `https://api.siliconflow.cn/v1` | `FunAudioLLM/SenseVoiceSmall` | **免费**（2026-08-05 官方价格页） | 中文/方言优化、推理快；同页 `TeleSpeechASR` 也免费。**不承诺永久免费**；单文件 ≤50MB、≤1 小时 |
| 智谱 BigModel | `https://open.bigmodel.cn/api/paas/v4` | `glm-asr-2512` | 按量计费，见官网 | 国内直连稳定 |
| OpenAI | `https://api.openai.com/v1` | `gpt-transcribe`（2026-07 新的推荐默认） | **$0.0045/min** | 比 whisper-1 便宜 25%，WER 40.4%→19.3%。无免费额度；新用户 $5 试用（3 个月过期）；文件 ≤25MB |
| OpenAI | 同上 | `whisper-1` / `gpt-4o-transcribe` | $0.006/min | whisper-1 是**唯一**支持词级时间戳与 `/audio/translations` 的 |
| OpenAI | 同上 | `gpt-4o-mini-transcribe` | **$0.003/min** | 最便宜的托管档 |
| OpenAI | 同上 | `gpt-live-transcribe`（流式） | $0.017/min | 实时流式，贵 3~5 倍 |
| 阿里云百炼 | `dashscope.aliyuncs.com` | `qwen3-asr-flash` | 约 **¥0.00022/秒 ≈ ¥0.013/min**（2026-07-30 华北2） | 国内合规首选 |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo` | 有免费额度 | 国内需代理 |

#### 💰 语音输入场景的真实成本（关键：这是**短音频高频**，跟会议转写完全不是一个量级）

按每次说话 20 秒估算：

| 使用强度 | 次数/天 | 音频分钟/月 | 硅基流动 | OpenAI mini | OpenAI gpt-transcribe | 阿里百炼 |
|---|---|---|---|---|---|---|
| 轻度 | 10 次 | 100 min | **¥0** | ≈¥2 | ≈¥3 | ≈¥1.3 |
| 中度 | 50 次 | 500 min | **¥0** | ≈¥11 | ≈¥16 | ≈¥6.6 |
| 重度 | 200 次 | 2000 min | **¥0** | ≈¥43 | ≈¥65 | ≈¥26 |

> 结论：**即使重度使用，云端 ASR 的钱几乎可以忽略**（按分钟计费的方案对 20 秒的短句特别友好）。选硅基流动则是 0 元。

#### ⚠️ 但「要不要额外费用」有三个层面的答案

| 层面 | 答案 |
|---|---|
| **钱** | 首选硅基流动 = **0 元**；即便走 OpenAI 也是每月几元到几十元量级。**没有"必须付费"的门槛。** |
| **谁付** | **走用户自己的 Key，费用由用户付，产品方服务器成本为 0。** 这是"复用供应商"路线最大的价值——Knowbase 不需要为此养后端。若要**内置免配置**，则变成产品方承担（按上表 × 用户数），那是另一个商业决策。 |
| **配置成本（非钱）** | 用户已有的 DeepSeek / 各类中转站 Key **可能不支持 `/audio/transcriptions`** → 需要单独注册一个硅基流动账号拿 Key。这是唯一真实的"额外成本"，且要在 UI 里引导好（未配置时点语音按钮 → 直接跳转配置页）。 |

> 实现注意：`FunAudioLLM/SenseVoiceSmall` 是**非流式**（整段上传 → 返回 `{ text }`），不支持边说边出字。要做流式只能换 OpenAI 的 `gpt-live-transcribe`（$0.017/min）或 WebSocket 实时接口，成本翻 3~5 倍。

> 「语音→**翻译**」是另一件事：若要把中文语音直接出英文，`whisper-1` 的 `/audio/translations` 端点可一步完成（$0.006/min，仅译成英文）；更常见的做法是 **ASR 转文字 → 复用已有的 `translateService`（LLM）翻译**，不额外付费、也不限目标语言。

> 走"复用供应商"路线的前提是该供应商的 baseUrl 支持 `/audio/transcriptions`（上表均支持；**Ollama 与 Anthropic 不支持** → 需在 UI 里按 `type === 'openai-compatible'` 过滤候选）。

### 3.2 本地离线 ASR：可行，且引擎已成熟（**修正：不应只当 P2 兜底**）

`sherpa-onnx`（k2-fsa / 新一代 Kaldi，Kaldi 之父 Daniel Povey 团队，Apache-2.0）是目前 Electron 里最现实的本地 ASR 方案。

**npm 包 `sherpa-onnx-node`（v1.13.6，2026-08 仍在更新）的硬事实**：

| 项 | 事实 | 意义 |
|---|---|---|
| 官方预编译平台 | Linux x64/arm64、macOS x64/arm64、**Windows x64 / ia32** | **Windows x64 直接可用** |
| 安装是否需要工具链 | **不需要** C++ 编译器 / Python / CMake | 走 optionalDependencies 拉预编译包 |
| 下载体积 | 包本体 59.7 kB；**win-x64 预编译包 32.8 MB** | 引擎成本 ≈ +33MB |
| Windows 运行期配置 | **无需任何环境变量**（DLL 在 node_modules 内自动找到） | macOS/Linux 才要设 `DYLD_LIBRARY_PATH` / `LD_LIBRARY_PATH` |
| 运行时依赖 | 0（纯 ONNX Runtime，**永不联网**） | 对比：FunASR/SenseVoice 的 Python 包即使模型在本地，启动仍会尝试连 modelscope.cn 校验 |
| 多线程 | native addon 支持多线程；另有纯 WASM 版（不支持多线程，Node ≥18） | 主进程用 native 版 |

**中文模型档位（体积为官方 releases 实际大小，性能需自测复核）**：

| 模型 | 体积 | 形态 | 特点 |
|---|---|---|---|
| `streaming-zipformer-small-ctc-zh-int8` | **20.3 MB** | 流式 | 最小档；边说边出字；精度略降 |
| `sense-voice-zh-en-ja-ko-yue` int8 | **229 MB** | 非流式 | 中英日韩粤自动识别；**内置标点恢复 + Silero VAD + 情感/音频事件检测** |
| 同上完整版（非量化） | 895 MB | 非流式 | 精度上限，体积不可接受（除非按需下载） |
| Paraformer / Zipformer 中文系列 | 数十 ~ 数百 MB | 流式/非流式 | 官方按场景提供多档，可换模型不换引擎 |

社区实测（非官方数据，需自测）：ARM 小设备上 RTF ≈ 0.3~0.45；SenseVoice int8 转 1 分钟中文约 1.2s，同场景 whisper-base 约 4s。桌面 x86 CPU 会明显更快。

**⚠️ 架构上最关键的一条差异：本地 ASR 不吃 `webm/opus`**

sherpa-onnx 的入口是 **16 kHz 单声道 float32 PCM**（`stream.accept_waveform(sample_rate, samples)`），而方案 B 的 `MediaRecorder` 产出的是 webm/opus 容器 —— **两者不能直接对接**。所以本地路线**必须替换采集层**，二选一：

| 采集形态 | 做法 | 评价 |
|---|---|---|
| **① 渲染层 AudioWorklet**（推荐） | `AudioContext` + `AudioWorkletNode` 直接取 16k PCM → IPC 送主进程 | 权限仍走 Chromium（与云端方案同一套 UI/权限路径），前端只换"采集实现"；需自写约 30 行 worklet |
| ② 主进程 `node-cpal` | 主进程直接读麦克风 + Silero VAD 断句（官方示例 `test_vad_asr_non_streaming_sense_voice_microphone.js` 就是此形态） | 渲染层零音频代码、官方示例现成；但多一个 native 依赖，权限提示脱离 Chromium 体系 |

**推荐 ①**：让**云端与本地共用同一个采集层与同一套按钮状态机**，只在主进程侧换 adapter —— 这是"以后能无痛接本地引擎"的前提。

**打包装配（electron-builder）——本地路线的真正成本所在**：

| 项 | 做法 | 坑 |
|---|---|---|
| native addon | 必须 `asarUnpack`（`.node`/`.dll` 不能留在 asar 内） | electron-vite 打主进程时要标 **external**，否则 rollup 会尝试内联 `.node` 而失败（参照仓库对 `defuddle`/`linkedom` 的 external 处理） |
| 模型文件 | 走 `extraResources`，或首次使用时下载 | 不能进 asar |
| 模型分发 | 二选一：**随包分发**（离线可用、包大）／**首次下载**（包小，要处理校验/断点/镜像） | 仓库已有 npmmirror 镜像经验可复用 |
| 首启体验 | 首次 `OfflineRecognizer` 初始化要加载 229MB 模型（数百 ms ~ 数秒，常驻内存数百 MB） | 必须懒加载 + 加载中 UI，绝不放在启动路径上 |
| 安装包 / 磁盘体积 | 装完占磁盘 **+48MB**（小模型）/ **+251MB**（SenseVoice）；安装包 **+28MB / +161MB**（§3.4⑦ 实测，int8 模型压缩率只有 67~76%，压不下去） | 与"纯本地"定位的取舍需要拍板 |

**结论（修正）**：本地不做"兜底"，而是**与云端并列为同一接口的两种 adapter**。技术上完全可行、Windows 无需编译、引擎仅 +33MB；真正要付的代价是**模型体积（50~260MB）与采集层重写**。建议 P0 先用云端打通（零体积、零 native），但**从第一天就把接口按"引擎可切换"设计**（`asrEngine: 'cloud' | 'local'` + 同一 `transcribe` 签名），P2 接本地时前端几乎不用动。

### 3.3 同类产品的实际做法（参照系）

对本机 WorkBuddy 客户端（`D:\develp\WorkBuddy\resources\app.asar`）做静态检索的结果：

| 检索项 | 命中 |
|---|---|
| `getUserMedia` / `MediaRecorder` | 16 / 66 处 → **渲染层录音** |
| `audio/transcriptions` | 30 处 → **上传到 OpenAI 兼容端点** |
| `gpt-4o-transcribe` / `whisper-1` / `groq` / `bigmodel` | 74 / 48 / 59 / 11 处 → 云端模型候选 |
| `onnxruntime` / `sherpa-onnx` / `whisper.cpp` / `@huggingface/transformers` / `libvosk` | **0 命中 → 无任何本地推理引擎** |
| 界面文案 | 有「语音输入」「语音输入 ({shortcut})」「语音输入（ASR）入口」「语音输入提问需要开启麦克风权限…」 |

**判定：WorkBuddy 的语音输入是云端识别**（渲染层 `MediaRecorder` 录音 → 上传 `/audio/transcriptions`）。这说明**云端 ASR 是这类工具的普遍选择**，方案 B 的路线与业界一致；本地方案则是差异化能力，不是必需项。

> 也可以自己验证：**断网后点语音输入** —— 能用 = 本地，报错 = 云端。

---

### 3.4 实测数据（本机真实跑出来的，非估算）

**方法与产物**：探针工程在 `E:\_asr-probe`（`bench-small.js` / `bench2.js` / `bench3.js` / `bench-sv.js` / `bench-worker.js`），模型取自官方 releases（经 ghfast 镜像）与 hf-mirror。指标为进程级 RSS 增量与 `process.cpuUsage()`。

#### ① 磁盘体积（实测）

| 组成 | 实测 |
|---|---|
| `sherpa-onnx-node`（JS 封装） | 105 KB |
| `sherpa-onnx-win-x64`（native 引擎） | **23 MB**（onnxruntime.dll 17.8MB + sherpa-onnx-c-api.dll 4.6MB + .node 0.7MB） |
| 小模型档 `streaming-zipformer-small-ctc-zh-int8` | **26.6 MB**（model.int8.onnx 25.1MB） |
| SenseVoice int8 档 | **228.5 MB** |
| **合计（小模型 / SenseVoice）** | **≈ +50 MB / +252 MB** |

#### ② 内存（RSS，实测）

| 阶段 | 小模型档 | SenseVoice int8 |
|---|---|---|
| 空 Node 进程基线 | 38.2 MB | 38.2 MB |
| `require('sherpa-onnx-node')` 后 | 41.7 MB（**只 +3.4**） | 41.7 MB（**只 +3.4**） |
| 模型加载后**常驻** | **121 MB（+83）** | **340 MB（+302）** |
| 识别 5.6s 音频后峰值 | 135 MB | 353 MB |
| 56s 长音频后 | 145 MB | 500 MB |
| **空闲 CPU（模型已加载）** | **0.00%** | **0.32%** |

**经验公式**：常驻 ≈ **60 MB（引擎固定开销）+ 模型文件大小 × 1.0~1.3**。
⚠️ **每个 recognizer 实例各自加载一份模型** —— 探针里建 4 个实例直接把 RSS 推到 342 MB，**必须做单例**。

#### ③ 速度（实测）

| 场景 | 小模型（流式） | SenseVoice int8（非流式） |
|---|---|---|
| 5.6s 音频 | 220 ms（RTF 0.038） | 408 ms（RTF 0.073） |
| 56s 音频 | 2.1 s（RTF 0.038） | 5.1 s（RTF 0.092） |
| 每 1s 音频的 CPU 时间 | ≈ 50~70 ms | ≈ 180 ms |
| **标点** | ❌ 无："…我想说的是呢大家如果…" | ✅ 有："…我想说的是呢，大家如果…。" |

> 小模型**能边收边出字**（流式，单块延迟 23~36ms）；SenseVoice 是**非流式**，必须说完才出结果（5.6s 话 → 0.4s 出字）。

#### ④ 事件循环 / 主进程可响应性（**决定性发现**）

| 做法 | 模型加载期间（1.6~2.2s） | 识别期间 |
|---|---|---|
| **直接在主进程跑** | 事件循环采样 **0 次 → 主线程完全冻结 2.1s** | 单次整段识别再冻结 195~5133 ms |
| **放进 `worker_threads`** | 最大间隔 **19 ms**、采样 134 次 → **全程可响应** ✅ | 最大间隔 16 ms ✅ |

> **结论：引擎必须放进 `worker_threads` 或 Electron `utilityProcess`。** 否则主进程冻结 2 秒 → 窗口"未响应"、IPC 全部停摆、界面看起来死掉。native addon 是 N-API 的，在 worker 线程里可正常工作（已实测）。

#### ⑤ `numThreads` 陷阱（实测，很容易踩）

| numThreads | 20s 音频识别（每 100ms 一块） | CPU 时间 | 单次 decode 最大 |
|---|---|---|---|
| **1** | 33 ms/块 | **1266 ms** | 47 ms |
| 2 | 26 ms/块 | 3625 ms | 35 ms |
| 4 | 31 ms/块 | **9468 ms** | **106 ms（>100ms 心跳 → 会掉块）** |

**用 1~2 线程就够了**：4 线程 CPU 涨 7.5 倍却没有更快，还因单次 decode 超过 100ms 心跳而破坏实时性（ONNX Runtime 线程池自旋导致）。稳态下同步占用 JS 线程仅 **4~5%**。

#### ⑥ 兼容性验证（消除「native 模块要 electron-rebuild」的常见担忧）

```
$ ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe -e "require('sherpa-onnx-node')"
electron-node 20.18.0 | electron 33.2.0 | sherpa 1.13.8 | onnxruntime 1.28.2 | readWave/OnlineRecognizer OK
```

native addon 走 **N-API（ABI 稳定）**，在 Electron 33（Node 20.18）下**直接加载成功，不需要 electron-rebuild**。

#### ⑦ 安装包 vs 装完占磁盘（分开算，实测压缩率）

**这两件事必须分开**：安装包是被压缩的，装完占磁盘是解压后的。逐文件实测 gzip 压缩率（NSIS 用 lzma/solid，会比 gzip 再小一些，故下表是**保守上界**）：

| 组成 | 原始（占磁盘） | gzip 后（≈安装包增量） | 保留率 |
|---|---|---|---|
| `onnxruntime.dll` | 16.97 MB | 6.09 MB | 36% |
| `sherpa-onnx-c-api.dll` | 4.39 MB | 1.81 MB | 41% |
| `.node` + 其余两个 DLL | 1.00 MB | 0.42 MB | 42% |
| **引擎小计** | **22.37 MB** | **8.31 MB** | 37% |
| 小模型 `model.int8.onnx` | 25.12 MB | 19.08 MB | 76% |
| **小模型小计** | **25.38 MB** | **19.23 MB** | 76% |
| SenseVoice `model.int8.onnx` | 228.15 MB | 152.75 MB | **67%** |
| **SenseVoice 小计** | **228.45 MB** | **152.88 MB** | 67% |

| 指标 | 小模型档 | SenseVoice 档 |
|---|---|---|
| **安装包增量** | **≈ +28 MB**（当前 125MB → ~153MB） | **≈ +161 MB**（→ ~286MB） |
| **装完占磁盘增量** | **≈ +48 MB** | **≈ +251 MB** |

> 关键观察：**已量化的 int8 模型压缩率很差（67~76%）**——不像 DLL 能压到 36%。所以"模型越大，安装包和磁盘几乎同比例一起涨"，压缩救不了体积。

#### ⑧ 一句话回答「加了对运行时和内存影响大吗」

| 维度 | 结论 |
|---|---|
| 不用时 | **零影响**（引擎 require 只 +3.4MB，空闲 CPU 0%，模型懒加载则内存不占） |
| 稳态性能 | **很小** —— 占一个线程的 4~5%，worker 隔离后主线程最大间隔 19ms（无感） |
| 内存 | **取决于档位，不是"都很小"**：小模型 **+83MB**（可算不大）；SenseVoice **+302MB（显著，不能算小）** |
| 安装包 / 磁盘 | 小模型 **+28MB / +48MB**；SenseVoice **+161MB / +251MB** |
| 最需要防的 | **不是内存也不是体积，是主线程冻结** —— 2.1s 完全冻结必须靠 worker 隔离解决 |

> **统一视角**：体积、内存、精度**是同一个旋钮**——都取决于"选多大的模型"。模型文件 ≈ 内存常驻（×1.0~1.3）≈ 磁盘占用；压缩只能把安装包降到原始体积的 67~76%。所以不存在"体积大但内存小"的档位，取舍只有一条线：**小模型（+48MB/+83MB/无标点）↔ SenseVoice（+251MB/+302MB/有标点）。**

---

## 4. 推荐方案（B）详细设计

### 4.1 链路架构

```
┌─ 渲染层（sandbox） ───────────────────────────────┐
│  VoiceInputButton                                 │
│   ├ getUserMedia({ audio })  → MediaStream        │
│   ├ MediaRecorder(webm/opus) → chunks[]           │
│   └ AnalyserNode → 波形条 / 计时（纯视觉反馈）      │
│                    │                              │
│              ArrayBuffer（≤ ~2MB）                 │
└────────────────────┼──────────────────────────────┘
                     │ IPC: asr:transcribe
┌────────────────────▼─ 主进程 ─────────────────────┐
│  asrService.transcribe({ providerId?, model?, buf })│
│   ├ resolveProvider → decryptSecret(DPAPI)         │
│   ├ validateProviderUrl                            │
│   └ net.fetch(`${baseUrl}/audio/transcriptions`,   │
│            multipart{ file, model, language })      │
│                    │                              │
│              { ok, text } / { ok:false, error }     │
└────────────────────┼──────────────────────────────┘
                     ▼
        回填输入框（光标处插入，函数式更新）
```

### 4.2 按钮交互与状态机

**推荐"点击切换"，不推荐"按住说话"**，理由见 §5.1。

```
idle ──click──► recording ──click / Esc / 达到上限──► transcribing ──► idle(+插入文本)
                   │                                      │
                   └──无权限/无设备──► error ◄──网络/接口失败┘
```

| 状态 | 按钮外观 | 输入框 | 提示 |
|---|---|---|---|
| `idle` | 灰色幽灵按钮（Mic 图标） | 正常 | — |
| `recording` | 主色/红色实心 + 脉冲圆点 + `00:07` 计时；输入框禁用 | 禁用 | "再点一下结束" |
| `transcribing` | 转圈（与发送按钮的 `Loader2` 同款） | 禁用 | "正在识别…" |
| `error` | 恢复 idle + toast | 正常 | 分类文案（见 §5.5） |
| 未配置 ASR 模型 | 按钮仍显示，点击 → toast 引导去设置 | 正常 | 首次使用弹一次性说明（音频将发送至 XX） |

**视觉规范（对齐现有风格）**：发送按钮是 `bg-[var(--accent)] text-white`；语音按钮必须用**幽灵态**（`border-[var(--border-color)]` + `bg-[var(--input-bg)]`），只做 `p-2 rounded-md`，不抢发送按钮的视觉权重——符合"厌恶突出标签"的既有口味。

**配套设置项**（都进 `SETTINGS` schema）：

| key | 默认 | 说明 |
|---|---|---|
| `asrModel` | `''` | `providerId:modelId`，留空则禁用语音按钮并提示去配置 |
| `asrAutoSend` | `false` | 转写完成后直接发送（默认关：语音识别难免有错字，先让用户改） |
| `asrLanguage` | `'zh'` | 传给 ASR 的语言提示 |
| `asrMaxSeconds` | `120` | 录音上限，到点自动结束（防忘记点停） |

> ⚠️ 必须同时给 `ui: true` + `anchor`，否则不会被 `schemaKeyItems()` 收进设置页搜索索引（见 `docs/ui-updates.md` 同类坑）。

### 4.3 代码落点清单

| # | 文件 | 动作 | 备注 |
|---|---|---|---|
| 1 | `electron/lib/asrService.ts` | **新建**：`transcribe()` + `ipcMain.handle('asr:transcribe')` | 复用 `llmService` 的 provider 解析/解密/校验（可小范围 export 内部函数） |
| 2 | `electron/lib/llmService.ts` | 导出 provider 解析与 `authHeaders`（或抽 `resolveProvider(id)`） | 避免复制 DPAPI 逻辑 |
| 3 | `electron/main/index.ts` | 注册 `asrService` + **补权限 handler**（§2.3） | ⚠️ 主进程改动**必须重启 dev** 才生效 |
| 4 | `electron/preload/index.ts` | `asrTranscribe: (p) => ipcRenderer.invoke('asr:transcribe', p)` | — |
| 5 | `src/types/index.ts` | `ElectronAPI` 增 `asrTranscribe` 签名 | 显式接口，漏了会 tsc 报错 |
| 6 | `src/components/shared/VoiceInputButton.tsx` | **新建**：按钮 + `useVoiceInput()`（录音/计时/波形/状态机） | 被 3 处复用 |
| 7 | `src/components/shared/AssistantPanel/index.tsx:722-736` | 插入按钮 + 光标处回填 | 主要目标 |
| 8 | `src/components/shared/AiLearn/index.tsx:128-135` | `Composer` 内插入按钮 | **一处改动覆盖学堂 2 个输入区** |
| 9 | `src/modules/ai-teaching/index.tsx:2250-2260` | 插入按钮 | — |
| 10 | `src/lib/settings.ts` | 新增 4 个 key（`ui:true` + `anchor` + `aiTab:'models'`） | 单源，搜索索引自动覆盖 |
| 11 | `src/modules/settings/views/AiModelsTab.tsx` | 新增"语音转文字"分组：供应商/模型选择 + 试听测试 | 参照现有 `llmTestModel` 交互 |
| 12 | `src/modules/help/docs/*.md` | 补一条使用说明 + 麦克风隐私前置条件 | 帮助文档为 glob 扫描 |

**改动面：新建 2 个文件，修改 10 个文件；无新依赖、无新 IPC 通道族（仅 1 个）。**

### 4.4 回填文本的正确姿势（本项目已有同类血债）

转写是**异步**的，`await` 回来后输入框的草稿可能已经被用户改动。**绝不能**用闭包里的旧 `draft` 拼字符串（同类问题在密码本"条目被覆盖"复盘中已踩过一次）：

```ts
// ❌ 错误：await 回来后 draft 是旧值，会把用户这期间的输入覆盖掉
onResult(text => setInput(input + text))

// ✅ 正确：函数式更新 + 转写完成时刻再读光标位置
onResult(text => {
  const el = inputRef.current
  const start = el?.selectionStart ?? input.length
  const end = el?.selectionEnd ?? input.length
  setInput(prev => prev.slice(0, start) + text + prev.slice(end))
  requestAnimationFrame(() => {           // 光标落到插入文本之后
    el?.focus(); el?.setSelectionRange(start + text.length, start + text.length)
  })
})
```

### 4.5 音频参数与 IPC 体积

| 参数 | 取值 | 理由 |
|---|---|---|
| 约束 | `{ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }` | 单人近距离说话场景最优 |
| 编码 | `audio/webm;codecs=opus`（`isTypeSupported` 探测后回退） | Chromium 原生，无需依赖 |
| 码率 | `audioBitsPerSecond: 16000` | 语音够用；60s ≈ 120KB，120s ≈ 240KB |
| 分片 | `start(1000)` | 每秒一片，避免长录音内存碎片 |
| IPC | `Uint8Array` 直传 | 结构化克隆支持；上限 `asrMaxSeconds` 保证 ≤ ~500KB，远低于 IPC 压力线 |
| multipart | 手写 boundary + `Buffer.concat`（约 20 行），或 Node 20 内置 `FormData` | **免新依赖**；`net.fetch` 对 `FormData` 的支持需实测，不行就用 Buffer 兜底 |

> ⚠️ 出站 multipart 是**新代码路径**（仓库现有 `lanShare/upload.ts` 是入站解析器，不可复用）。建议优先用"手写 Buffer + 显式 `Content-Type: multipart/form-data; boundary=...`"——**完全可控、不依赖 `net.fetch` 对 BodyInit 的支持细节**，是最稳的一条。

> ⚠️ 上表是**云端路线**的参数。若同期要做本地引擎（§3.2），采集层需换成 `AudioWorklet` 输出 16k 单声道 float32 PCM —— 建议把采集封装成 `useAudioCapture(mode: 'opus' | 'pcm')`，两种引擎各取所需，按钮状态机与 UI 保持不变。

---

## 5. 风险与坑（本项目特有）

### 5.1 ⚠️ 不要做"按住说话"（PTT）—— 会撞上已验证的手势坑

本仓库已有明确记录：**任何 pointer 手势结束后浏览器都会补发一次 `click`**，不拦就会"松手顺手触发别的动作"（日程表拖拽复盘中踩过）。PTT 天然是 `pointerdown/pointerup` 手势，等于主动引入这个坑，且：

- 长文本口述时"按住不放"体验差（手抖、误抬）；
- 移动端/触控板误触代价高；
- 必须再补 `dragGuard` + `stopPropagation` 两道防线。

**点击切换（toggle）在结构上规避整类问题**，且更适合"说一段话再改"的场景。

### 5.2 ⚠️ 主进程改动验收前必须重启 dev

沙箱写文件 watcher 收不到事件 → `electron/` 下改了代码，dev 仍跑旧代码且**不报错**。新增 `asrService` 与权限 handler 属于主进程改动，验收前必须重启。

### 5.3 ⚠️ 隐私叙事张力（产品层决策，非技术问题）

产品定位是"纯本地无云、换电脑 = 拷走仓库文件夹"。语音输入若走云端，**音频会离开本机**（即使供应商免费）。建议：

- 按钮首次点击时给**一次性说明**（"录音将发送至「硅基流动」转写"），并把供应商名带出来；
- 设置页里该开关的 `desc` 明确写"音频会上传至所配置的供应商"；
- 长期把本地离线实现作为"隐私模式"接入同一接口（§3.2）。

### 5.4 ✅ 首屏体积：零影响（但要守住）

本方案**不新增任何依赖**，因此不新增 chunk、不改动 `manualChunks`。唯一需要守的是：**不要为了 ASR 引入 SDK 包**（如各家云厂商的 Node SDK，动辄数 MB），一行 `net.fetch` 就够。

### 5.5 错误分类（每种都要有可行动的中文文案）

| 触发 | 文案方向 |
|---|---|
| `NotAllowedError` | "麦克风被拒绝 —— 若为系统级拦截，请到「设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问麦克风」开启" |
| `NotFoundError` | "没有检测到麦克风设备" |
| 未配置 `asrModel` | "还没有配置语音转文字模型" + [去配置] 按钮 |
| 供应商 `type` 不支持 | 仅 `openai-compatible` 的供应商可作为 ASR 候选（Ollama/Anthropic 需在 UI 过滤） |
| HTTP 4xx/5xx | 透出 `friendlyHttpError`（复用 `llmService:138` 的既有映射） |
| 超时 / 网络失败 | "识别服务无响应，录音已丢弃，请重试"（不静默保留音频，避免隐私残留） |
| 转写结果为空 | "没有听清，再试一次" |

---

### 5.6 ⚠️ 若做本地方案：引擎必须单例 + 必须进 worker（实测教训）

- **单例**：每个 recognizer 实例各自加载一份模型（实测建 4 个实例 → RSS 342MB）。全局只允许一个，用懒加载 + 引用计数。
- **进 worker**：模型加载同步冻结 JS 线程 1.6~2.2s（实测事件循环采样 0 次）。放 `worker_threads` 后主线程最大间隔降到 19ms。**做成本地方案却留在主进程 = 每次首次识别界面卡死 2 秒。**
- **numThreads 取 1~2**：4 线程 CPU 涨 7.5 倍、且单次 decode 会超过 100ms 心跳。

---

## 6. 验收清单

- [ ] 侧栏 / 学堂（紧凑+常规）/ AI 教学 共 4 个输入区都出现语音按钮，且与发送按钮对齐、不抢视觉权重
- [ ] 点击开始 → 有计时与波形反馈；再点结束 → 转写中 → 文本插入到**光标处**（不是无脑追加到末尾）
- [ ] 录音期间用户手动改了草稿 → 转写结果插入后**草稿不丢**
- [ ] 录制中按 Esc 取消，不产生请求
- [ ] `pending`（AI 正在回复）时按钮禁用
- [ ] 系统麦克风关闭 → 文案含 Windows 隐私设置指引
- [ ] 未配置 ASR 模型 → 按钮点击走引导而非静默失败
- [ ] 失败时录音数据被丢弃（内存不残留）
- [ ] 关掉开发者工具后无 CSP 报错（证明未触碰 `connect-src`）
- [ ] `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json` 无新增错误
- [ ] 首屏体积与改动前一致（本文档 §5.4 的约束）
- [ ] 权限 handler 生效后：麦克风可用、摄像头/屏幕捕获被拒

---

## 7. 分期建议

| 阶段 | 内容 | 价值 |
|---|---|---|
| **P0** | 方案 B 全链路：录音 → 主进程转写 → 回填（4 个输入区） + `asrModel` 设置 + 权限 handler 收紧。**接口按"引擎可切换"写**（`asrEngine` + 统一 `transcribe` 签名） | 功能可用，1 人日量级；且不留二次返工 |
| **P1** | 波形/计时精致化、`asrAutoSend`、录完回放确认（需 CSP 加 `media-src blob:`）、快捷键（如 `Ctrl+Shift+M`） | 体验补齐 |
| **P2** | **本地离线 ASR（sherpa-onnx）** 作为同接口第二 adapter：采集层换 AudioWorklet 取 16k PCM、`asarUnpack` + `extraResources` 装配、模型分发策略（随包 or 首用下载）、懒加载与加载中 UI | 契合"纯本地"定位；离线可用、音频不出机 |
| **P3** | 流式转写（边说边出字）：云端走 WebSocket 实时接口（智谱/讯飞/DashScope），本地换 `streaming-zipformer-small-ctc-zh-int8`（20MB） | 长口述场景质变；本地方案反而更轻 |

**取舍建议**：若"纯本地无云"是产品必须守住的卖点，可以直接跳到 **P0(云端接口层) + P2(本地引擎)** 一起做——因为**采集层与状态机是共用的**，一次做对比分两次做更省；代价是安装包 +260MB 与模型分发工程。若体积敏感，就先只上云端。

---

## 附：一句话给未来的自己

> 语音输入的坑**不在录音**（渲染层 10 行就能录），而在四处：① 别信 Web Speech API；② 别做按住说话；③ 异步转写回填必须函数式更新 + 当刻读光标；④ **本地引擎不吃 webm/opus，要 16k PCM —— 采集层得先换掉**。
