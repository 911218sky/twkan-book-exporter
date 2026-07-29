import { access, readFile } from "node:fs/promises"
import { constants } from "node:fs"
import { parse } from "yaml"
import { CrawlError } from "../core/errors.js"

export type CrawlConfig = {
  readonly book?: string
  readonly concurrency?: number
  readonly delayMs?: number
  readonly ignore?: string
  readonly limit?: number
  readonly output?: string
  readonly retries?: number
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
export async function loadCrawlConfig(path: string): Promise<CrawlConfig> {
  try {
    await access(path, constants.R_OK)
  } catch (error) {
    if (path === "twkanexporter.yaml") return {}
    if (error instanceof Error) throw new CrawlError(`Cannot read configuration file: ${path}`)
    throw error
  }
  const parsed: unknown = parse(await readFile(path, "utf8"))
  if (!isRecord(parsed)) throw new CrawlError("Configuration must be a YAML mapping.")
  const book = optionalBook(parsed["book"])
  const concurrency = optionalNumber(parsed["concurrency"], "concurrency")
  const delayMs = optionalNumber(parsed["delayMs"], "delayMs")
  const ignore = optionalString(parsed["ignore"], "ignore")
  const limit = optionalNumber(parsed["limit"], "limit")
  const output = optionalString(parsed["output"], "output")
  const retries = optionalNumber(parsed["retries"], "retries")
  return {
    ...(book === undefined ? {} : { book }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(delayMs === undefined ? {} : { delayMs }),
    ...(ignore === undefined ? {} : { ignore }),
    ...(limit === undefined ? {} : { limit }),
    ...(output === undefined ? {} : { output }),
    ...(retries === undefined ? {} : { retries }),
  }
}
