import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { BrowserRestartRequiredError, CrawlError } from "../core/errors.js"
import type { ResolvedCamofoxConfig } from "../cli/options.js"

const require = createRequire(import.meta.url)
const recoveryCooldownMs = 3_000
type Tab = { readonly tabId: string }

function controlOrigin(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function sessionIndexForTab(tabOrdinal: number, sessionCount: number): number {
  return tabOrdinal % sessionCount
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function waitForProcessExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new CrawlError("Camofox did not exit within 10 seconds.")), 10_000)
    child.once("error", (error) => { clearTimeout(timeout); reject(error) })
    child.once("exit", () => { clearTimeout(timeout); resolve() })
  })
}

export class Camofox {
  private readonly activeUserIds = new Set<string>()
  private readonly config: ResolvedCamofoxConfig
  private readonly origin: string
  private readonly sessionUserIds: readonly string[]
  private readonly tabOwners = new Map<string, string>()
  private nextTabOrdinal = 0
  // 只有本程序啟動服務時才保存 child process；既有服務必須用管理腳本關閉。
  private readonly server: ChildProcess | undefined

  private constructor(server: ChildProcess | undefined, config: ResolvedCamofoxConfig) {
    const runId = crypto.randomUUID()
    this.config = config
    this.origin = controlOrigin(config.port)
    this.server = server
    this.sessionUserIds = Array.from({ length: config.maxSessions }, (_, index) => `twkan-${runId}-${index + 1}`)
  }

  public static async connect(config: ResolvedCamofoxConfig): Promise<Camofox> {
    // 優先沿用健康的本機服務，避免每次續跑都額外啟動一個 Camofox。
    if (await Camofox.healthy(config)) return new Camofox(undefined, config)
    // 兩個 context 分攤六個分頁，但仍共用一個瀏覽器程序以控制記憶體用量。
    const server = spawn(process.execPath, [require.resolve("@askjo/camofox-browser/server.js")], {
      env: { ...process.env, BROWSER_IDLE_TIMEOUT_MS: String(config.browserIdleTimeoutMs), CAMOFOX_BIND_HOST: config.bindHost, CAMOFOX_CRASH_REPORT_ENABLED: String(config.crashReportEnabled), CAMOFOX_DISABLE_DEFAULT_ADDONS: "true", CAMOFOX_PORT: String(config.port), HANDLER_TIMEOUT_MS: String(config.handlerTimeoutMs), MAX_CONCURRENT_PER_USER: String(config.maxConcurrentPerUser), MAX_SESSIONS: String(config.maxSessions), MAX_TABS_GLOBAL: String(config.maxTabsGlobal), MAX_TABS_PER_SESSION: String(config.maxTabsPerSession), NAVIGATE_TIMEOUT_MS: String(config.navigateTimeoutMs), SESSION_TIMEOUT_MS: String(config.sessionTimeoutMs), TAB_INACTIVITY_MS: String(config.tabInactivityMs) },
      stdio: "ignore", windowsHide: true,
    })
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await Camofox.healthy(config)) return new Camofox(server, config)
      await delay(1_000)
    }
    server.kill()
    throw new CrawlError("Camofox did not become ready within 30 seconds.")
  }

  public static isMissingTab(error: unknown): boolean {
    if (!(error instanceof CrawlError)) return false
    const message = error.message.toLowerCase()
    return message.includes("tab no longer exists")
      || message.includes("tab not found")
      || message.includes("no longer exists because its session was replaced")
  }

  public static isAccessDenied(error: unknown): boolean {
    return error instanceof CrawlError && error.message.includes("HTTP 403")
  }

  public static isNavigationTimeout(error: unknown): boolean {
    return error instanceof CrawlError && error.message.includes("navigation timed out")
  }

  public static requiresRestart(error: unknown): boolean {
    return error instanceof BrowserRestartRequiredError
      || Camofox.isAccessDenied(error)
      || Camofox.isMissingTab(error)
      || Camofox.isNavigationTimeout(error)
  }

  public async createTab(url?: string): Promise<Tab> {
    const sessionIndex = sessionIndexForTab(this.nextTabOrdinal, this.sessionUserIds.length)
    const userId = this.sessionUserIds[sessionIndex]
    if (userId === undefined) throw new CrawlError("Camofox session allocation failed.")
    this.nextTabOrdinal += 1
    return this.createTabForUser(userId, url)
  }

  private async createTabForUser(userId: string, url?: string): Promise<Tab> {
    const body = url === undefined ? { sessionKey: "crawler", userId } : { sessionKey: "crawler", url, userId }
    const value = await this.request("/tabs", { method: "POST", body })
    if (!isRecord(value) || typeof value["tabId"] !== "string") throw new CrawlError("Camofox did not return a tab ID.")
    this.activeUserIds.add(userId)
    this.tabOwners.set(value["tabId"], userId)
    return { tabId: value["tabId"] }
  }

  public async navigate(tabId: string, url: string): Promise<void> {
    const userId = this.tabOwner(tabId)
    await this.request(`/tabs/${tabId}/navigate`, { body: { url, userId }, method: "POST", timeoutMs: this.config.navigateTimeoutMs })
  }

  public async evaluate(tabId: string, expression: string): Promise<unknown> {
    const userId = this.tabOwner(tabId)
    const value = await this.request(`/tabs/${tabId}/evaluate`, { method: "POST", body: { expression, userId } })
    if (!isRecord(value)) throw new CrawlError("Camofox returned an invalid evaluation response.")
    return value["result"]
  }

  public async close(tabId: string | undefined, restartBrowser = false): Promise<void> {
    if (restartBrowser) {
      // HTTP 403 代表目前瀏覽器整體狀態不可用，才需要完整重啟。
      await Camofox.restart(this.server, this.config)
      return
    }
    try {
      if (tabId !== undefined) await this.request(`/tabs/${tabId}?userId=${encodeURIComponent(this.tabOwner(tabId))}`, { method: "DELETE" })
    } catch (error) {
      if (!Camofox.isMissingTab(error)) throw error
    } finally {
      try {
        await Promise.all([...this.activeUserIds].map((userId) => this.request(`/sessions/${userId}`, { method: "DELETE" })))
      } finally {
        await Camofox.stopOwnedServer(this.server)
      }
    }
  }

  private static async restart(server: ChildProcess | undefined, config: ResolvedCamofoxConfig): Promise<void> {
    await delay(recoveryCooldownMs)
    if (server !== undefined) {
      await Camofox.stopOwnedServer(server)
      return
    }
    if (process.platform !== "win32") throw new CrawlError("Cannot restart an externally started Camofox server on this platform.")
    // 外部服務沒有 child handle，只能依監聽連接埠找出完整程序樹並關閉。
    const script = path.resolve(process.cwd(), "scripts", "stop-camofox.ps1")
    const stopProcess = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Port", String(config.port)], { stdio: "ignore", windowsHide: true })
    await waitForProcessExit(stopProcess)
    if (stopProcess.exitCode !== 0) throw new CrawlError("Failed to stop the existing Camofox browser.")
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (!(await Camofox.healthy(config))) return
      await delay(100)
    }
    throw new CrawlError("Camofox remained available after the browser restart.")
  }

  private static async stopOwnedServer(server: ChildProcess | undefined): Promise<void> {
    if (server === undefined || server.exitCode !== null) return
    server.kill()
    await waitForProcessExit(server)
  }

  private static async healthy(config: ResolvedCamofoxConfig): Promise<boolean> {
    try { return (await fetch(`${controlOrigin(config.port)}/health`, { signal: AbortSignal.timeout(1_000) })).ok } catch { return false }
  }

  private tabOwner(tabId: string): string {
    const userId = this.tabOwners.get(tabId)
    if (userId === undefined) throw new CrawlError(`Camofox tab ${tabId} has no session owner.`)
    return userId
  }

  private async request(path: string, init: { readonly body?: unknown; readonly method: string; readonly timeoutMs?: number }): Promise<unknown> {
    const timeoutMs = init.timeoutMs ?? 70_000
    let response: Response
    try {
      response = init.body === undefined
        ? await fetch(`${this.origin}${path}`, { method: init.method, signal: AbortSignal.timeout(timeoutMs) })
        : await fetch(`${this.origin}${path}`, { body: JSON.stringify(init.body), headers: { "content-type": "application/json" }, method: init.method, signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      // 導航使用較短的逾時，並轉成可被上層辨識的重啟原因。
      if (init.timeoutMs !== undefined && error instanceof Error && error.name === "TimeoutError") {
        throw new CrawlError(`Camofox navigation timed out after ${init.timeoutMs}ms.`)
      }
      throw error
    }
    const body: unknown = await response.json()
    if (!response.ok) {
      const message = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `HTTP ${response.status}`
      throw new CrawlError(`Camofox ${init.method} ${path} failed: ${message}`)
    }
    return body
  }
}
