import { parseArgs } from "node:util"
import type { CamofoxConfig, CrawlConfig } from "./config.js"
import { CrawlError } from "../core/errors.js"
import { bookUrl } from "../twkan/novel.js"

export type CrawlOptions = {
  readonly bookUrl: string
  readonly camofox: ResolvedCamofoxConfig
  readonly concurrency: number
  readonly delayMs: number
  readonly ignoredChapters: ReadonlySet<number>
  readonly limit: number
  readonly outputDirectory: string
  readonly retries: number
}

export type ResolvedCamofoxConfig = {
  readonly bindHost: string
  readonly browserIdleTimeoutMs: number
  readonly crashReportEnabled: boolean
  readonly handlerTimeoutMs: number
  readonly maxConcurrentPerUser: number
  readonly maxSessions: number
  readonly maxTabsGlobal: number
  readonly maxTabsPerSession: number
  readonly navigateTimeoutMs: number
  readonly sessionTimeoutMs: number
  readonly tabInactivityMs: number
}

function positive(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new CrawlError(`${name} must be a positive integer.`)
  return number
}

function nonNegative(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new CrawlError(`${name} must be a non-negative integer.`)
  return number
}

function resolveCamofoxConfig(config: CamofoxConfig | undefined): ResolvedCamofoxConfig {
  return {
    bindHost: config?.bindHost ?? "127.0.0.1",
    browserIdleTimeoutMs: nonNegative(config?.browserIdleTimeoutMs, 120_000, "camofox.browserIdleTimeoutMs"),
    crashReportEnabled: config?.crashReportEnabled ?? false,
    handlerTimeoutMs: positive(config?.handlerTimeoutMs, 60_000, "camofox.handlerTimeoutMs"),
    maxConcurrentPerUser: positive(config?.maxConcurrentPerUser, 3, "camofox.maxConcurrentPerUser"),
    maxSessions: positive(config?.maxSessions, 2, "camofox.maxSessions"),
    maxTabsGlobal: positive(config?.maxTabsGlobal, 6, "camofox.maxTabsGlobal"),
    maxTabsPerSession: positive(config?.maxTabsPerSession, 3, "camofox.maxTabsPerSession"),
    navigateTimeoutMs: positive(config?.navigateTimeoutMs, 5_000, "camofox.navigateTimeoutMs"),
    sessionTimeoutMs: positive(config?.sessionTimeoutMs, 180_000, "camofox.sessionTimeoutMs"),
    tabInactivityMs: positive(config?.tabInactivityMs, 180_000, "camofox.tabInactivityMs"),
  }
}

// 忽略清單接受逗號分隔的章號與閉區間，例如 1-2,8；設定檔與 CLI 共用此解析規則。
function ignoredChapters(value: string | undefined): ReadonlySet<number> {
  if (value === undefined || value === "") return new Set()
  const ignored = new Set<number>()
  for (const segment of value.split(",")) {
    const range = segment.match(/^(\d+)-(\d+)$/)
    if (range?.[1] !== undefined && range[2] !== undefined) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start > end) throw new CrawlError("An ignored chapter range must increase.")
      for (let chapter = start; chapter <= end; chapter += 1) ignored.add(chapter)
      continue
    }
    if (/^\d+$/.test(segment)) {
      ignored.add(Number(segment))
      continue
    }
    throw new CrawlError("Ignore must be chapter numbers or ranges, for example 1-2,8.")
  }
  return ignored
}

export function parseOptions(arguments_: readonly string[], config: CrawlConfig = {}): CrawlOptions {
  // CLI 值優先於 YAML；第二個 `--` 會先移除，兼容 npm 的參數轉送語法。
  const { positionals, values } = parseArgs({
    args: arguments_.filter((argument) => argument !== "--"), allowPositionals: true,
    options: { concurrency: { short: "c", type: "string" }, config: { type: "string" }, delayMs: { type: "string" }, ignore: { short: "x", type: "string" }, limit: { type: "string" }, output: { short: "o", type: "string" }, retries: { type: "string" } }, strict: true,
  })
  const input = positionals[0] ?? config.book
  if (input === undefined) throw new CrawlError("Usage: npm run crawl -- <book-url-or-id> [--ignore 1-2,8] [--output DIR]")
  return {
    bookUrl: bookUrl(input),
    camofox: resolveCamofoxConfig(config.camofox),
    concurrency: positive(values.concurrency ?? config.concurrency, 6, "Concurrency"),
    delayMs: nonNegative(values.delayMs ?? config.delayMs, 500, "Delay"),
    ignoredChapters: ignoredChapters(values.ignore ?? config.ignore),
    limit: positive(values.limit ?? config.limit, Number.POSITIVE_INFINITY, "Limit"),
    outputDirectory: values.output ?? config.output ?? "output",
    retries: positive(values.retries ?? config.retries, 3, "Retries"),
  }
}
