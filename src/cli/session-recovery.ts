import { Camofox } from "../browser/camofox.js"

export function isCamofoxSessionReset(error: unknown): boolean {
  // 只有瀏覽器狀態已失效的錯誤才進入無限續跑；一般章節錯誤仍受 retries 限制。
  return Camofox.requiresRestart(error)
}

export function camofoxResetReason(error: unknown): string {
  // 對使用者顯示短原因，完整 API 路徑仍保留在原始 CrawlError 內。
  const message = error instanceof Error ? error.message : ""
  if (message.includes("HTTP 403")) return "HTTP 403"
  if (Camofox.isMissingTab(error)) return "分頁已失效"
  if (message.includes("timed out")) return "頁面載入逾時"
  if (message.includes("did not expose readable public content")) return "章節內容未載入"
  if (message.includes("remained unavailable after replacing its tab")) return "章節內容持續未載入"
  return "Camofox 連線異常"
}
