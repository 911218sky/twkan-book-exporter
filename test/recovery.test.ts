import assert from "node:assert/strict"
import test from "node:test"
import { Camofox, replacementGeneration, sessionIndexForTab } from "../src/browser/camofox.js"
import { isCamofoxSessionReset } from "../src/cli/session-recovery.js"
import { ProgressReporter } from "../src/cli/progress.js"
import { BrowserRestartRequiredError, CrawlError } from "../src/core/errors.js"
import { navigationSlot } from "../src/export/book.js"
import { ChapterContentError, requireChapter } from "../src/twkan/novel.js"

test("navigationSlot spaces concurrent chapter navigations", () => {
  assert.deepEqual(navigationSlot(0, 1_000, 1_500), { nextNavigationAt: 2_500, waitMs: 0 })
  assert.deepEqual(navigationSlot(2_500, 1_100, 1_500), { nextNavigationAt: 4_000, waitMs: 1_400 })
})

test("sessionIndexForTab balances six tabs across two sessions", () => {
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => sessionIndexForTab(index, 2)), [0, 1, 0, 1, 0, 1])
})

test("one failed tab invalidates its session only once", () => {
  const firstReplacement = replacementGeneration(0, 0)
  const siblingReplacement = replacementGeneration(0, firstReplacement)

  assert.equal(firstReplacement, 1)
  assert.equal(siblingReplacement, 1)
})

test("a discarded tab is replaced without restarting the browser", () => {
  // Given: Camofox discarded a tab while the crawler was reading a chapter
  const error = new CrawlError("Camofox POST /tabs/abc/evaluate failed: Tab no longer exists")

  // When: the retry loop classifies the error
  const reset = isCamofoxSessionReset(error)

  // Then: the crawler replaces only the discarded tab
  assert.equal(reset, false)
  assert.equal(Camofox.isMissingTab(error), true)
  assert.equal(Camofox.canReplaceTab(error), true)
})

test("isCamofoxSessionReset recognizes a Twkan temporary rejection", () => {
  const error = new CrawlError("Camofox POST /tabs/abc/navigate failed: HTTP 403")
  assert.equal(isCamofoxSessionReset(error), true)
})

test("isCamofoxSessionReset recognizes exhausted local page recovery", () => {
  const error = new BrowserRestartRequiredError("Chapter content remained unavailable after new tabs.")
  assert.equal(isCamofoxSessionReset(error), true)
})

test("isCamofoxSessionReset recognizes the five-second navigation timeout", () => {
  const error = new CrawlError("Camofox navigation timed out after 5000ms.")
  assert.equal(Camofox.canReplaceTab(error), true)
  assert.equal(isCamofoxSessionReset(error), false)
})

test("a missing tab is replaced without restarting the browser", () => {
  const error = new CrawlError("Camofox POST /tabs/abc/navigate failed: Tab not found")
  assert.equal(Camofox.canReplaceTab(error), true)
  assert.equal(isCamofoxSessionReset(error), false)
})

test("a stale session-generation tab is replaced", () => {
  const error = new CrawlError("Camofox tab abc no longer exists because its session was replaced.")
  assert.equal(Camofox.canReplaceTab(error), true)
})

test("an empty chapter page is a retryable content error", () => {
  assert.throws(
    () => requireChapter({ content: "", title: "047心思 三" }, 47),
    ChapterContentError,
  )
})

test("progress keeps initial cache and downloaded totals after a browser restart", () => {
  // Given: a crawl that began with 106 cached chapters and then downloaded 20 more
  const messages: string[] = []
  const progress = new ProgressReporter((message) => messages.push(message), false)
  progress.render(106, 106, 567)
  progress.render(106, 126, 567)

  // When: Camofox restarts and the next scan reports all 126 files as cache
  progress.restarting("HTTP 403")
  progress.resumed()
  progress.render(126, 126, 567)

  // Then: the restart line has the current cumulative figures, not recalculated cache figures
  assert.equal(messages.at(-2), "Progress 126/567 | cache 106 | downloaded 20 [HTTP 403，正在重啟 Camofox...]")
  assert.equal(messages.at(-1), "Progress 126/567 | cache 106 | downloaded 20")
  assert.deepEqual(progress.summary(), { cached: 106, completed: 126, downloaded: 20, total: 567 })
})

test("interactive progress replaces the restart notice after Camofox resumes", () => {
  // Given: an interactive terminal renderer holding the latest visible frame
  const frames: string[] = []
  const terminalLine = { done: () => undefined, update: (message: string) => { frames.push(message) } }
  const progress = new ProgressReporter(() => undefined, true, terminalLine)
  progress.render(129, 167, 567)

  // When: a timeout restarts Camofox and the restart completes
  progress.restarting("頁面載入逾時")
  progress.resumed()

  // Then: the renderer receives a clean frame without the temporary notice
  assert.equal(frames.at(-1), "Progress 167/567 | cache 129 | downloaded 38")
})

test("progress keeps the tab replacement notice until every tab is ready", () => {
  const frames: string[] = []
  const terminalLine = { done: () => undefined, update: (message: string) => { frames.push(message) } }
  const progress = new ProgressReporter(() => undefined, true, terminalLine)
  progress.render(0, 40, 60)
  progress.replacingTab("頁面載入逾時")
  progress.replacingTab("分頁已失效")

  progress.tabReady()
  assert.match(frames.at(-1) ?? "", /更換分頁/)
  progress.tabReady()

  assert.equal(frames.at(-1), "Progress 40/60 | cache 0 | downloaded 40")
})
