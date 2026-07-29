import { setTimeout as delay } from "node:timers/promises"
import { exportBook } from "../export/book.js"
import { CrawlError } from "../core/errors.js"
import { configPathFromArguments, loadCrawlConfig } from "./config.js"
import { parseOptions } from "./options.js"
import { ProgressReporter } from "./progress.js"

async function main(signal: AbortSignal): Promise<void> {
  const arguments_ = process.argv.slice(2)
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
      const resetByCamofox = error instanceof CrawlError && (error.message.includes("Tab no longer exists") || error.message.includes("Tab not found"))
      if (!resetByCamofox || sessionResets >= 30) throw error
      sessionResets += 1
      progress.reset()
      // 單一分頁逾時時 Camofox 會重建 session；既有章節檔可讓下一輪只補未完成部分。
      console.error(`Camofox reset its session; resuming completed chapters (${sessionResets}/30).`)
      await delay(5_000)
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
