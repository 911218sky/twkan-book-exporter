import { parseArgs } from "node:util"
import type { CrawlConfig } from "./config.js"
import { CrawlError } from "../core/errors.js"
import { bookUrl } from "../twkan/novel.js"

export type CrawlOptions = {
  readonly bookUrl: string
  readonly concurrency: number
  readonly delayMs: number
  readonly ignoredChapters: ReadonlySet<number>
  readonly limit: number
  readonly outputDirectory: string
  readonly retries: number
}

function positive(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new CrawlError(`${name} must be a positive integer.`)
  return number
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
  const { positionals, values } = parseArgs({
    args: arguments_, allowPositionals: true,
    options: { concurrency: { short: "c", type: "string" }, config: { type: "string" }, delayMs: { type: "string" }, ignore: { short: "x", type: "string" }, limit: { type: "string" }, output: { short: "o", type: "string" }, retries: { type: "string" } }, strict: true,
  })
  const input = positionals[0] ?? config.book
  if (input === undefined) throw new CrawlError("Usage: npm run crawl -- <book-url-or-id> [--ignore 1-2,8] [--output DIR]")
  return {
    bookUrl: bookUrl(input),
    concurrency: positive(values.concurrency ?? config.concurrency, 3, "Concurrency"),
    delayMs: positive(values.delayMs ?? config.delayMs, 1_500, "Delay"),
    ignoredChapters: ignoredChapters(values.ignore ?? config.ignore),
    limit: positive(values.limit ?? config.limit, Number.POSITIVE_INFINITY, "Limit"),
    outputDirectory: values.output ?? config.output ?? "output",
    retries: positive(values.retries ?? config.retries, 3, "Retries"),
  }
}
