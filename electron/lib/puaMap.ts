/**
 * Symbol / Private-Use 字符 → Unicode 映射表。
 *
 * 背景：PPT 用 Symbol（或 MathType/MTExtra）字体敲出的数学符号，在 slideN.xml 的 <a:t> 里
 * 以**裸私用区码位**存储（0xF000 + Symbol 编码位，如 Σ 是 F053、⇒ 是 F0DE）。这些码位无字形，
 * 下游渲染成 □、AI 也无法理解（2026-09-09 编译原理 PPT 提取公式全变 □ 的根因）。
 *
 * 表来源：unicode.org《Adobe Symbol Encoding to Unicode》(symbol.txt, v1.0 2011-07-12)，
 * 其许可条款明确允许在支持 Unicode 的产品中使用本表数据。键为 Symbol 编码位（低字节），值为 Unicode 字符串。
 * 多义项（一个编码映射到 2 个 Unicode，如 Omega→Ω/ΩM）取数学首选字形。
 */
const SYMBOL_MAP: Record<number, string> = {
  0x20: ' ', 0x21: '!', 0x22: '\u2200', 0x23: '#', 0x24: '\u2203', 0x25: '%', 0x26: '&',
  0x27: '\u220B', 0x28: '(', 0x29: ')', 0x2A: '\u2217', 0x2B: '+', 0x2C: ',', 0x2D: '\u2212',
  0x2E: '.', 0x2F: '/', 0x30: '0', 0x31: '1', 0x32: '2', 0x33: '3', 0x34: '4', 0x35: '5',
  0x36: '6', 0x37: '7', 0x38: '8', 0x39: '9', 0x3A: ':', 0x3B: ';', 0x3C: '<', 0x3D: '=',
  0x3E: '>', 0x3F: '?', 0x40: '\u2245',
  // 大写希腊（Symbol 表非字母序：43=Chi、46=Phi、47=Gamma、51=Theta、56=final sigma、5A=Zeta）
  0x41: '\u0391', 0x42: '\u0392', 0x43: '\u03A7', 0x44: '\u0394', 0x45: '\u0395', 0x46: '\u03A6',
  0x47: '\u0393', 0x48: '\u0397', 0x49: '\u0399', 0x4A: '\u03D1', 0x4B: '\u039A', 0x4C: '\u039B',
  0x4D: '\u039C', 0x4E: '\u039D', 0x4F: '\u039F', 0x50: '\u03A0', 0x51: '\u0398', 0x52: '\u03A1',
  0x53: '\u03A3', 0x54: '\u03A4', 0x55: '\u03A5', 0x56: '\u03C2', 0x57: '\u03A9', 0x58: '\u039E',
  0x59: '\u03A8', 0x5A: '\u0396',
  0x5B: '[', 0x5C: '\u2234', 0x5D: ']', 0x5E: '\u22A5', 0x5F: '_',
  // 小写希腊（63=chi、66=phi、67=gamma、6A=phi1、6D=mu、72=sigmaf? 按表 72=rho、73=sigma、76=omega1）
  0x60: '', 0x61: '\u03B1', 0x62: '\u03B2', 0x63: '\u03C7', 0x64: '\u03B4', 0x65: '\u03B5',
  0x66: '\u03C6', 0x67: '\u03B3', 0x68: '\u03B7', 0x69: '\u03B9', 0x6A: '\u03D5', 0x6B: '\u03BA',
  0x6C: '\u03BB', 0x6D: '\u03BC', 0x6E: '\u03BD', 0x6F: '\u03BF', 0x70: '\u03C0', 0x71: '\u03B8',
  0x72: '\u03C1', 0x73: '\u03C3', 0x74: '\u03C4', 0x75: '\u03C5', 0x76: '\u03D6', 0x77: '\u03C9',
  0x78: '\u03BE', 0x79: '\u03C8', 0x7A: '\u03B6',
  0x7B: '{', 0x7C: '|', 0x7D: '}', 0x7E: '\u223C',
  0xA0: '\u20AC', 0xA1: '\u03D2', 0xA2: '\u2032', 0xA3: '\u2264', 0xA4: '\u2044', 0xA5: '\u221E',
  0xA6: '\u0192', 0xA7: '\u2663', 0xA8: '\u2666', 0xA9: '\u2665', 0xAA: '\u2660',
  0xAB: '\u2194', 0xAC: '\u2190', 0xAD: '\u2191', 0xAE: '\u2192', 0xAF: '\u2193',
  0xB0: '\u00B0', 0xB1: '\u00B1', 0xB2: '\u2033', 0xB3: '\u2265', 0xB4: '\u00D7', 0xB5: '\u221D',
  0xB6: '\u2202', 0xB7: '\u2022', 0xB8: '\u00F7', 0xB9: '\u2260', 0xBA: '\u2261', 0xBB: '\u2248',
  0xBC: '\u2026', 0xBD: '', 0xBE: '', 0xBF: '\u21B5',
  0xC0: '\u2135', 0xC1: '\u2111', 0xC2: '\u211C', 0xC3: '\u2118', 0xC4: '\u2297', 0xC5: '\u2295',
  0xC6: '\u2205', 0xC7: '\u2229', 0xC8: '\u222A', 0xC9: '\u2283', 0xCA: '\u2287', 0xCB: '\u2284',
  0xCC: '\u2282', 0xCD: '\u2286', 0xCE: '\u2208', 0xCF: '\u2209', 0xD0: '\u2220', 0xD1: '\u2207',
  0xD2: '\u00AE', 0xD3: '\u00A9', 0xD4: '\u2122', 0xD5: '\u220F', 0xD6: '\u221A', 0xD7: '\u22C5',
  0xD8: '\u00AC', 0xD9: '\u2227', 0xDA: '\u2228', 0xDB: '\u21D4', 0xDC: '\u21D0', 0xDD: '\u21D1',
  0xDE: '\u21D2', 0xDF: '\u21D3',
  0xE0: '\u25CA', 0xE1: '\u2329', 0xE2: '\u00AE', 0xE3: '\u00A9', 0xE4: '\u2122', 0xE5: '\u2211',
  // E6–F8 为括号/根号的上下半与 extender（CUS 构件），纯文本无意义 → 丢弃
  0xF1: '\u232A', 0xF2: '\u222B', 0xF3: '\u2320', 0xF4: '', 0xF5: '\u2321',
}

// MathType/MTExtra 常用扩展（F0F2 区间外另有独立编码；此处覆盖常见运算符，符号字体主用已在上表）
const EXTRA: Record<number, string> = {
  0x00B5: '\u03BC', // MICRO SIGN → mu（统一为希腊小写 μ，避免字形分裂）
}

/**
 * 把一段文本里的私用区 Symbol 码位（0xF000–0xF0FF，低字节=Symbol 编码位）替换为等价 Unicode。
 * 未在表内的残留 PUA（另一套 MTExtra 私有编码等，无法安全还原）→ 占位符 ⟨eq⟩，
 * 保证正文不再出现 □：可辨、不破坏 Markdown/KaTeX 渲染，且给 AI/人工「此处有公式」的信号。
 */
export function mapSymbolPua(text: string): string {
  if (!text) return text
  let hasPua = false
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i)
    if (cp >= 0xF000 && cp <= 0xF8FF) { hasPua = true; break }
  }
  if (!hasPua) return text
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp >= 0xF000 && cp <= 0xF0FF) {
      const low = cp & 0xFF
      const mapped = SYMBOL_MAP[low]
      out += mapped !== undefined ? mapped : '\u27E8eq\u27E9'
    } else if (cp >= 0xF100 && cp <= 0xF8FF) {
      // 0xF100+ 属其它私有字体编码（MTExtra 等），标准 Symbol 表覆盖不到 → 占位
      out += '\u27E8eq\u27E9'
    } else if (EXTRA[cp] !== undefined) {
      out += EXTRA[cp]
    } else {
      out += ch
    }
  }
  return out
}
