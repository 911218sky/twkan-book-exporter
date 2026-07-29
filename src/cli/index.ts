import { exportBook } from "../export/book.js"
import { CrawlError } from "../core/errors.js"
import { configPathFromArguments, loadCrawlConfig } from "./config.js"
import { parseOptions } from "./options.js"
import { ProgressReporter } from "./progress.js"
import { isCamofoxSessionReset } from "./session-recovery.js"

async function main(signal: AbortSignal): Promise<void> {
  const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--")
  // 先讀 YAML，之後由同一組命令列參數覆寫，避免設定檔吃掉臨時調整。
  const options = parseOptions(arguments_, await loadCrawlConfig(configPathFromArguments(arguments_)))
  const progress = new ProgressReporter()
  let sessionResets = 0
  let result: Awaited<ReturnType<typeof exportBook>>
  while (true) {
    try {
      result = await exportBook(options, progress.render.bind(progress), signal)
      break
    } catch (error) {
      if (!isCamofoxSessionReset(error) || sessionResets >= 30) throw error
      sessionResets += 1
      progress.reset()
      console.error(`Camofox is restarting now; resuming completed chapters (${sessionResets}/30).`)
    }
  }
  console.log(`Export complete. Verified ${result.total}/${result.total} chapters. Cache ${result.cached}. Downloaded ${result.written}.`)
  console.log(`Merged ${result.mergedFile}`)
}

const controller = new AbortController()
process.once("SIGINT", () => controller.abort())

main(controller.signal).catch((error: unknown) => {
  if (controller.signal.aborted) {
    console.error("Crawl interrupted. Camofox closed; completed chapters remain cached.")
    process.exitCode = 130
    return
  }
  console.error(error instanceof CrawlError ? error.message : error)
  process.exitCode = 1
})
