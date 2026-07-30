import { exportBook } from "../export/book.js"
import { CrawlError } from "../core/errors.js"
import { configPathFromArguments, loadCrawlConfig } from "./config.js"
import { parseOptions } from "./options.js"
import { ProgressReporter } from "./progress.js"
import { camofoxResetReason, isCamofoxSessionReset } from "./session-recovery.js"

async function main(signal: AbortSignal): Promise<void> {
  const arguments_ = process.argv.slice(2).filter((argument) => argument !== "--")
  // 先讀 YAML，之後由同一組命令列參數覆寫，避免設定檔吃掉臨時調整。
  const options = parseOptions(arguments_, await loadCrawlConfig(configPathFromArguments(arguments_)))
  const progress = new ProgressReporter()
  let result: Awaited<ReturnType<typeof exportBook>>
  while (true) {
    try {
      result = await exportBook(
        options,
        progress.render.bind(progress),
        signal,
        (error) => progress.restarting(camofoxResetReason(error)),
      )
      break
    } catch (error) {
      if (!isCamofoxSessionReset(error)) throw error
      progress.resumed()
    }
  }
  const summary = progress.summary()
  console.log(`Export complete. Verified ${result.total}/${result.total} chapters. Cache ${summary.cached}. Downloaded ${summary.downloaded}.`)
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
