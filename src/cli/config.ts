import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { parse } from "yaml"
import { CrawlError } from "../core/errors.js"

export type CrawlConfig = {
  readonly book?: string
  readonly camofox?: CamofoxConfig
  readonly concurrency?: number
  readonly delayMs?: number
  readonly ignore?: string
  readonly limit?: number
  readonly output?: string
  readonly retries?: number
}

export type CamofoxConfig = {
  readonly bindHost?: string
  readonly browserIdleTimeoutMs?: number
  readonly crashReportEnabled?: boolean
  readonly handlerTimeoutMs?: number
  readonly maxConcurrentPerUser?: number
  readonly maxSessions?: number
  readonly maxTabsGlobal?: number
  readonly maxTabsPerSession?: number
  readonly navigateTimeoutMs?: number
  readonly port?: number
  readonly sessionTimeoutMs?: number
  readonly tabInactivityMs?: number
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number") throw new CrawlError(`Configuration field ${name} must be a number.`)
  return value
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new CrawlError(`Configuration field ${name} must be a string.`)
  return value
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new CrawlError(`Configuration field ${name} must be a boolean.`)
  return value
}

function optionalCamofoxConfig(value: unknown): CamofoxConfig | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new CrawlError("Configuration field camofox must be a YAML mapping.")
  const bindHost = optionalString(value["bindHost"], "camofox.bindHost")
  const browserIdleTimeoutMs = optionalNumber(value["browserIdleTimeoutMs"], "camofox.browserIdleTimeoutMs")
  const crashReportEnabled = optionalBoolean(value["crashReportEnabled"], "camofox.crashReportEnabled")
  const handlerTimeoutMs = optionalNumber(value["handlerTimeoutMs"], "camofox.handlerTimeoutMs")
  const maxConcurrentPerUser = optionalNumber(value["maxConcurrentPerUser"], "camofox.maxConcurrentPerUser")
  const maxSessions = optionalNumber(value["maxSessions"], "camofox.maxSessions")
  const maxTabsGlobal = optionalNumber(value["maxTabsGlobal"], "camofox.maxTabsGlobal")
  const maxTabsPerSession = optionalNumber(value["maxTabsPerSession"], "camofox.maxTabsPerSession")
  const navigateTimeoutMs = optionalNumber(value["navigateTimeoutMs"], "camofox.navigateTimeoutMs")
  const port = optionalNumber(value["port"], "camofox.port")
  const sessionTimeoutMs = optionalNumber(value["sessionTimeoutMs"], "camofox.sessionTimeoutMs")
  const tabInactivityMs = optionalNumber(value["tabInactivityMs"], "camofox.tabInactivityMs")
  return {
    ...(bindHost === undefined ? {} : { bindHost }),
    ...(browserIdleTimeoutMs === undefined ? {} : { browserIdleTimeoutMs }),
    ...(crashReportEnabled === undefined ? {} : { crashReportEnabled }),
    ...(handlerTimeoutMs === undefined ? {} : { handlerTimeoutMs }),
    ...(maxConcurrentPerUser === undefined ? {} : { maxConcurrentPerUser }),
    ...(maxSessions === undefined ? {} : { maxSessions }),
    ...(maxTabsGlobal === undefined ? {} : { maxTabsGlobal }),
    ...(maxTabsPerSession === undefined ? {} : { maxTabsPerSession }),
    ...(navigateTimeoutMs === undefined ? {} : { navigateTimeoutMs }),
    ...(port === undefined ? {} : { port }),
    ...(sessionTimeoutMs === undefined ? {} : { sessionTimeoutMs }),
    ...(tabInactivityMs === undefined ? {} : { tabInactivityMs }),
  }
}

function optionalBook(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value)
  throw new CrawlError("Configuration field book must be a Twkan URL, ID string, or positive numeric ID.")
}

// 先找設定檔路徑，再交給 CLI 解析器套用覆寫，確保命令列優先。
export function configPathFromArguments(arguments_: readonly string[]): string {
  const inline = arguments_.find((argument) => argument.startsWith("--config="))
  if (inline !== undefined) return inline.slice("--config=".length)
  const index = arguments_.indexOf("--config")
  if (index === -1) return "twkanexporter.yaml"
  const path = arguments_[index + 1]
  if (path === undefined) throw new CrawlError("--config requires a path.")
  return path
}

// YAML 是外部輸入，只允許文件列出的純量設定進入內部流程。
export async function loadCrawlConfig(path: string, fallbackPath = "twkanexporter.example.yaml"): Promise<CrawlConfig> {
  let readablePath = path
  try {
    await access(readablePath, constants.R_OK)
  } catch (error) {
    if (path !== "twkanexporter.yaml" && !path.endsWith("/twkanexporter.yaml") && !path.endsWith("\\twkanexporter.yaml")) {
      if (error instanceof Error) throw new CrawlError(`Cannot read configuration file: ${path}`)
      throw error
    }
    readablePath = fallbackPath
    try {
      await access(readablePath, constants.R_OK)
    } catch (fallbackError) {
      if (fallbackError instanceof Error) return {}
      throw fallbackError
    }
  }
  const parsed: unknown = parse(await readFile(readablePath, "utf8"))
  if (!isRecord(parsed)) throw new CrawlError("Configuration must be a YAML mapping.")
  const book = optionalBook(parsed["book"])
  const camofox = optionalCamofoxConfig(parsed["camofox"])
  const concurrency = optionalNumber(parsed["concurrency"], "concurrency")
  const delayMs = optionalNumber(parsed["delayMs"], "delayMs")
  const ignore = optionalString(parsed["ignore"], "ignore")
  const limit = optionalNumber(parsed["limit"], "limit")
  const output = optionalString(parsed["output"], "output")
  const retries = optionalNumber(parsed["retries"], "retries")
  return {
    ...(book === undefined ? {} : { book }),
    ...(camofox === undefined ? {} : { camofox }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(delayMs === undefined ? {} : { delayMs }),
    ...(ignore === undefined ? {} : { ignore }),
    ...(limit === undefined ? {} : { limit }),
    ...(output === undefined ? {} : { output }),
    ...(retries === undefined ? {} : { retries }),
  }
}
