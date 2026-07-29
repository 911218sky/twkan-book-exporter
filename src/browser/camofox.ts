import { spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { createRequire } from "node:module"
import { setTimeout as delay } from "node:timers/promises"
import { CrawlError } from "../core/errors.js"

const require = createRequire(import.meta.url)
const origin = "http://127.0.0.1:9377"
type Tab = { readonly tabId: string }

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export class Camofox {
  private readonly userId = `twkan-${crypto.randomUUID()}`
  private readonly server: ChildProcess | undefined

  private constructor(server: ChildProcess | undefined) { this.server = server }

  public static async connect(): Promise<Camofox> {
    if (await Camofox.healthy()) return new Camofox(undefined)
    const server = spawn(process.execPath, [require.resolve("@askjo/camofox-browser/server.js")], {
      env: { ...process.env, BROWSER_IDLE_TIMEOUT_MS: process.env.BROWSER_IDLE_TIMEOUT_MS ?? "10000", CAMOFOX_BIND_HOST: process.env.CAMOFOX_BIND_HOST ?? "127.0.0.1", CAMOFOX_CRASH_REPORT_ENABLED: process.env.CAMOFOX_CRASH_REPORT_ENABLED ?? "false", CAMOFOX_DISABLE_DEFAULT_ADDONS: "true", MAX_CONCURRENT_PER_USER: process.env.MAX_CONCURRENT_PER_USER ?? "3", MAX_SESSIONS: process.env.MAX_SESSIONS ?? "1", MAX_TABS_GLOBAL: process.env.MAX_TABS_GLOBAL ?? "3", MAX_TABS_PER_SESSION: process.env.MAX_TABS_PER_SESSION ?? "3", SESSION_TIMEOUT_MS: process.env.SESSION_TIMEOUT_MS ?? "60000", TAB_INACTIVITY_MS: process.env.TAB_INACTIVITY_MS ?? "60000" },
      stdio: "ignore", windowsHide: true,
    })
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (await Camofox.healthy()) return new Camofox(server)
      await delay(1_000)
    }
    server.kill()
    throw new CrawlError("Camofox did not become ready within 30 seconds.")
  }

  public async createTab(url?: string): Promise<Tab> {
    const body = url === undefined ? { sessionKey: "crawler", userId: this.userId } : { sessionKey: "crawler", url, userId: this.userId }
    const value = await this.request("/tabs", { method: "POST", body })
    if (!isRecord(value) || typeof value["tabId"] !== "string") throw new CrawlError("Camofox did not return a tab ID.")
    return { tabId: value["tabId"] }
  }

  public async navigate(tabId: string, url: string): Promise<void> { await this.request(`/tabs/${tabId}/navigate`, { method: "POST", body: { url, userId: this.userId } }) }

  public async evaluate(tabId: string, expression: string): Promise<unknown> {
    const value = await this.request(`/tabs/${tabId}/evaluate`, { method: "POST", body: { expression, userId: this.userId } })
    if (!isRecord(value)) throw new CrawlError("Camofox returned an invalid evaluation response.")
    return value["result"]
  }

  public async close(tabId: string | undefined): Promise<void> {
    try {
      if (tabId !== undefined) await this.request(`/tabs/${tabId}?userId=${encodeURIComponent(this.userId)}`, { method: "DELETE" })
    } catch (error) {
      if (!(error instanceof CrawlError) || (!error.message.includes("Tab no longer exists") && !error.message.includes("Tab not found"))) throw error
    } finally {
      try {
        await this.request(`/sessions/${this.userId}`, { method: "DELETE" })
      } finally {
        this.server?.kill()
      }
    }
  }

  private static async healthy(): Promise<boolean> {
    try { return (await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1_000) })).ok } catch { return false }
  }

  private async request(path: string, init: { readonly body?: unknown; readonly method: string }): Promise<unknown> {
    const response = init.body === undefined
      ? await fetch(`${origin}${path}`, { method: init.method, signal: AbortSignal.timeout(35_000) })
      : await fetch(`${origin}${path}`, { body: JSON.stringify(init.body), headers: { "content-type": "application/json" }, method: init.method, signal: AbortSignal.timeout(35_000) })
    const body: unknown = await response.json()
    if (!response.ok) {
      const message = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `HTTP ${response.status}`
      throw new CrawlError(`Camofox ${init.method} ${path} failed: ${message}`)
    }
    return body
  }
}
