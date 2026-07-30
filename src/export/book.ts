import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { Camofox } from "../browser/camofox.js"
import type { CrawlOptions } from "../cli/options.js"
import { BrowserRestartRequiredError, CrawlError } from "../core/errors.js"
import { ChapterContentError, bookMetadata, chapterIndexUrl, chapterLinks, chapterUrls, requireChapter } from "../twkan/novel.js"
import type { BookMetadata } from "../twkan/novel.js"

// 這些表達式在 Camofox 頁面內執行，只回傳可序列化資料給 Node.js。
const chapterExpression = "(() => { const candidates = ['#txtcontent0', '#articlecontent', '#content', '.chapter-content', '.read-content', 'article'].map((selector) => document.querySelector(selector)).filter((element) => element !== null); const content = candidates.map((element) => element.innerText.trim()).sort((left, right) => right.length - left.length)[0] ?? ''; return { title: document.querySelector('h1')?.textContent?.trim() ?? '', content }; })()"
const completeLinksExpression = `(() => { const bookId = location.pathname.match(/^\\/book\\/(\\d+)\\/index\\.html$/)?.[1]; if (bookId === undefined) return []; return fetch('/ajax_novels/chapterlist/' + bookId + '.html').then((response) => response.text()).then((html) => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href*="/txt/"]'), (anchor) => new URL(anchor.getAttribute('href'), location.href).href)); })()`
const bookMetadataExpression = "(() => { const info = typeof bookinfo === 'undefined' ? {} : bookinfo; const text = document.body.innerText; const status = text.match(/\\d+(?:\\.\\d+)?\\s*萬字\\s*[|｜]\\s*(?:連載|完結)/)?.[0] ?? ''; const panelText = document.querySelector('#tab_info')?.innerText ?? ''; const synopsis = document.querySelector('meta[property=\"og:description\"]')?.getAttribute('content')?.trim() ?? document.querySelector('.book-intro, .book_intro, .intro, #intro, #bookintro')?.textContent?.trim() ?? document.querySelector('meta[name=description]')?.getAttribute('content')?.trim() ?? ''; const keywords = panelText.match(/小說關鍵詞[：:]\\s*([^\\n]+)/)?.[1]?.trim() ?? document.querySelector('meta[name=keywords]')?.getAttribute('content')?.trim() ?? info.tags ?? ''; return { title: info.articlename ?? document.querySelector('h1')?.textContent?.trim() ?? '', author: info.author ?? '', category: info.sortName ?? '', keywords, status, synopsis }; })()"
const metadataFilename = "0000-書籍資訊.txt"

type PlannedChapter = {
  readonly link: { readonly url: string }
  readonly number: number
}

type ExportResult = {
  readonly cached: number
  readonly mergedFile: string
  readonly total: number
  readonly written: number
}

export type ProgressCallback = (cached: number, completed: number, total: number) => void
export type BrowserRecoveryCallback = (error: unknown, action: "restart-browser") => void

export function navigationSlot(nextNavigationAt: number, now: number, delayMs: number): { readonly nextNavigationAt: number; readonly waitMs: number } {
  // 所有 worker 共用同一時間軸，確保導航請求彼此仍至少相隔 delayMs。
  const readyAt = Math.max(nextNavigationAt, now)
  return { nextNavigationAt: readyAt + delayMs, waitMs: readyAt - now }
}

function requireActiveCrawl(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new CrawlError("Crawl interrupted.")
}

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?\"<>|]/g, "").trim() || "untitled"
}

function filename(number: number, title: string): string {
  const safe = safeFilename(title)
  return `${String(number).padStart(4, "0")}-${safe}.txt`
}

export function cacheFilenameNumber(value: string): number | undefined {
  const match = value.match(/^(\d{4})-.+\.txt$/)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

export function cacheBelongsToBook(metadataText: string, title: string): boolean {
  return metadataText.split(/\r?\n/, 1)[0] === title
}

async function cachedChapterNumbers(directory: string, planned: readonly PlannedChapter[], title: string): Promise<ReadonlySet<number>> {
  const expected = new Set(planned.map((chapter) => chapter.number))
  const cached = new Set<number>()
  const entries = await readdir(directory)
  if (!entries.includes(metadataFilename)) return cached
  const metadataText = await readFile(path.join(directory, metadataFilename), "utf8")
  if (!cacheBelongsToBook(metadataText, title)) return cached
  for (const entry of entries) {
    const number = cacheFilenameNumber(entry)
    if (number === undefined) continue
    // 只有目前計畫內的非空檔才算快取，避免舊檔或中斷產物影響續跑。
    if (expected.has(number) && (await stat(path.join(directory, entry))).size > 0) cached.add(number)
  }
  return cached
}

async function writeChapter(directory: string, chapter: { readonly content: string; readonly number: number; readonly title: string }): Promise<void> {
  const target = path.join(directory, filename(chapter.number, chapter.title))
  // 先寫入 .part，再原子改名；中斷時下次不會把半截內容當成快取。
  await writeFile(`${target}.part`, `${chapter.title}\n\n${chapter.content}\n`, "utf8")
  await rename(`${target}.part`, target)
}

export function bookMetadataText(metadata: BookMetadata): string {
  const fields = [
    metadata.title,
    `作者：${metadata.author}`,
    `分類：${metadata.category}`,
    metadata.status,
    metadata.synopsis === "" ? "" : `簡介：\n${metadata.synopsis}`,
    metadata.keywords === "" ? "" : `小說關鍵詞：${metadata.keywords}`,
  ].filter((field) => field !== "")
  return fields.join("\n\n")
}

async function writeBookMetadata(directory: string, metadata: BookMetadata): Promise<string> {
  const target = path.join(directory, metadataFilename)
  await writeFile(`${target}.part`, `${bookMetadataText(metadata)}\n`, "utf8")
  await rename(`${target}.part`, target)
  return target
}

async function mergeChapters(directory: string, metadata: BookMetadata, planned: readonly PlannedChapter[]): Promise<string> {
  const filesByNumber = new Map<number, string>()
  for (const file of await readdir(directory)) {
    const match = file.match(/^(\d{4})-.+\.txt$/)
    if (match?.[1] !== undefined) filesByNumber.set(Number(match[1]), file)
  }
  // 依本次書目順序合併，而非目錄排序，忽略章節與殘留舊檔都不會混入。
  const information = await readFile(path.join(directory, metadataFilename), "utf8").catch((error: unknown) => {
    if (error instanceof Error) throw new CrawlError(`Book information is missing and cannot be merged: ${error.message}`)
    throw new CrawlError("Book information is missing and cannot be merged.")
  })
  const contents = await Promise.all(planned.map(async (chapter) => {
    const file = filesByNumber.get(chapter.number)
    if (file === undefined) throw new CrawlError(`Chapter ${chapter.number} is missing and cannot be merged.`)
    return readFile(path.join(directory, file), "utf8")
  }))
  const target = path.join(directory, `${safeFilename(metadata.title)}.txt`)
  await writeFile(`${target}.part`, `${information.trimEnd()}\n\n${contents.join("\n")}`, "utf8")
  await rename(`${target}.part`, target)
  return target
}

export async function exportBook(
  options: CrawlOptions,
  reportProgress: ProgressCallback = () => undefined,
  signal?: AbortSignal,
  reportBrowserRecovery: BrowserRecoveryCallback = () => undefined,
): Promise<ExportResult> {
  requireActiveCrawl(signal)
  await mkdir(options.outputDirectory, { recursive: true })
  const browser = await Camofox.connect(options.camofox)
  let tabId: string | undefined
  let closePromise: Promise<void> | undefined
  let restartBrowser = false
  // SIGINT 與 finally 可能同時要求清理；共用 Promise 保證瀏覽器只關閉一次。
  const closeBrowser = (): Promise<void> => {
    if (closePromise === undefined) closePromise = browser.close(tabId, restartBrowser)
    return closePromise
  }
  const closeOnInterrupt = (): void => { void closeBrowser() }
  signal?.addEventListener("abort", closeOnInterrupt, { once: true })
  try {
    requireActiveCrawl(signal)
    tabId = (await browser.createTab(options.bookUrl)).tabId
    await browser.navigate(tabId, options.bookUrl)
    const metadata = bookMetadata(await browser.evaluate(tabId, bookMetadataExpression))
    await browser.navigate(tabId, chapterIndexUrl(options.bookUrl))
    // 完整目錄由站內 AJAX 端點提供，書籍首頁通常只包含部分章節。
    const planned = chapterLinks(chapterUrls(await browser.evaluate(tabId, completeLinksExpression)))
      .slice(0, options.limit)
      .map((link, index): PlannedChapter => ({ link, number: index + 1 }))
      .filter((chapter) => !options.ignoredChapters.has(chapter.number))
    if (planned.length === 0) throw new CrawlError("The book page did not contain chapters to export.")
    const cached = await cachedChapterNumbers(options.outputDirectory, planned, metadata.title)
    await writeBookMetadata(options.outputDirectory, metadata)
    const pending = planned.filter((chapter) => !cached.has(chapter.number))
    reportProgress(cached.size, cached.size, planned.length)
    if (tabId === undefined) throw new CrawlError("Camofox did not create the initial tab.")
    const workerCount = Math.min(options.concurrency, pending.length)
    const tabIds = workerCount === 0 ? [] : [tabId, ...(await Promise.all(Array.from({ length: workerCount - 1 }, () => browser.createTab()))).map((tab) => tab.tabId)]
    let nextIndex = 0
    let nextNavigationAt = 0
    let written = 0
    // worker 以共享索引動態領取下一章，較慢的分頁不會阻塞其他分頁。
    const worker = async (activeTabId: string): Promise<void> => {
      while (nextIndex < pending.length) {
        requireActiveCrawl(signal)
        const item = pending[nextIndex]
        nextIndex += 1
        if (item === undefined) return
        let lastError: Error | undefined
        for (let attempt = 1; attempt <= options.retries; attempt += 1) {
          try {
            const slot = navigationSlot(nextNavigationAt, Date.now(), options.delayMs)
            nextNavigationAt = slot.nextNavigationAt
            if (slot.waitMs > 0) await delay(slot.waitMs)
            await browser.navigate(activeTabId, item.link.url)
            await writeChapter(options.outputDirectory, requireChapter(await browser.evaluate(activeTabId, chapterExpression), item.number))
            written += 1
            reportProgress(cached.size, cached.size + written, planned.length)
            lastError = undefined
            break
          } catch (error) {
            requireActiveCrawl(signal)
            if (Camofox.requiresRestart(error)) throw error
            lastError = error instanceof Error ? error : new CrawlError("Unknown chapter export failure.")
            if (attempt < options.retries) await delay(options.delayMs * attempt)
          }
        }
        if (lastError instanceof ChapterContentError) {
          throw new BrowserRestartRequiredError(`Chapter ${item.number} remained unavailable after replacing its tab.`)
        }
        if (lastError !== undefined) throw lastError
      }
    }
    await Promise.all(tabIds.map(worker))
    requireActiveCrawl(signal)
    return { cached: cached.size, mergedFile: await mergeChapters(options.outputDirectory, metadata, planned), total: planned.length, written }
  } catch (error) {
    restartBrowser = Camofox.requiresRestart(error)
    // 先顯示重啟狀態；finally 完成冷卻與關閉後，CLI 才會清除提示並續跑。
    if (restartBrowser) reportBrowserRecovery(error, "restart-browser")
    throw error
  } finally {
    signal?.removeEventListener("abort", closeOnInterrupt)
    await closeBrowser()
  }
}
