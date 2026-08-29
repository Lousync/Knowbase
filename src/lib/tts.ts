/** 单词发音（浏览器 speechSynthesis，英语语音，零依赖离线可用） */

let cachedVoice: SpeechSynthesisVoice | null = null

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice
  const voices = window.speechSynthesis?.getVoices?.() ?? []
  // 优先美式英语本地语音，退而求其次任意英语
  cachedVoice =
    voices.find(v => v.lang === 'en-US' && v.localService) ??
    voices.find(v => v.lang === 'en-US') ??
    voices.find(v => v.lang.startsWith('en')) ??
    null
  return cachedVoice
}

// 语音列表在部分平台异步加载：尽早触发一次加载
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.getVoices()
  window.speechSynthesis.onvoiceschanged = () => { cachedVoice = null }
}

/** 朗读英文单词/短语；会打断上一次未完成的朗读 */
export function speak(text: string, rate = 0.9): void {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = rate
    const voice = pickVoice()
    if (voice) u.voice = voice
    window.speechSynthesis.speak(u)
  } catch { /* TTS 不可用时静默 */ }
}
