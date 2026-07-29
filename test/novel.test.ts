import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { loadCrawlConfig } from "../src/cli/config.js"
import { parseOptions } from "../src/cli/options.js"
import { bookMetadataText, exportBook } from "../src/export/book.js"
import { bookMetadata, bookTitle, bookUrl, chapterIndexUrl, chapterLinks, normalizeContent } from "../src/twkan/novel.js"
import { CrawlError } from "../src/core/errors.js"

test("bookTitle reads the public Twkan book title", () => {
  assert.equal(bookTitle({ title: "\u8150\u673d\u4e16\u754c" }), "\u8150\u673d\u4e16\u754c")
})

test("bookMetadata reads the public book-page details", () => {
  assert.deepEqual(bookMetadata({
    author: "\u6efe\u958b",
    category: "\u7384\u5e7b\u5947\u5e7b",
    keywords: "\u8150\u673d\u4e16\u754c\u7121\u5f48\u7a97,\u8150\u673d\u4e16\u754c\u5c0f\u8aaa",
    status: "232.59\u842c\u5b57 | \u9023\u8f09",
    synopsis: "\u795e\u79d8\uff0c\u7d55\u671b\uff0c\u75db\u82e6\uff0c\u8150\u673d\u3002",
    title: "\u8150\u673d\u4e16\u754c",
  }), {
    author: "\u6efe\u958b",
    category: "\u7384\u5e7b\u5947\u5e7b",
    keywords: "\u8150\u673d\u4e16\u754c\u7121\u5f48\u7a97,\u8150\u673d\u4e16\u754c\u5c0f\u8aaa",
    status: "232.59\u842c\u5b57 | \u9023\u8f09",
    synopsis: "\u795e\u79d8\uff0c\u7d55\u671b\uff0c\u75db\u82e6\uff0c\u8150\u673d\u3002",
    title: "\u8150\u673d\u4e16\u754c",
  })
})

test("bookMetadataText creates the first merged information document", () => {
  // Given: metadata extracted from the public book page
  const metadata = bookMetadata({
    author: "滾開",
    category: "玄幻奇幻",
    keywords: "腐朽世界無彈窗",
    status: "232.59萬字 | 連載",
    synopsis: "神秘，絕望，痛苦，腐朽。",
    title: "腐朽世界",
  })

  // When: the crawler creates the standalone book information document
  const information = bookMetadataText(metadata)

  // Then: its contents form the expected leading section of the merged book
  assert.equal(information, "腐朽世界\n\n作者：滾開\n\n分類：玄幻奇幻\n\n232.59萬字 | 連載\n\n簡介：\n神秘，絕望，痛苦，腐朽。\n\n小說關鍵詞：腐朽世界無彈窗")
})

test("parseOptions uses three paced concurrent tabs", () => {
  const options = parseOptions(["90206"])
  assert.equal(options.concurrency, 3)
  assert.equal(options.delayMs, 1_500)
})

test("parseOptions accepts an ignored chapter list and ranges", () => {
  const options = parseOptions(["90206", "--ignore", "1-2,5,8-9"])
  assert.deepEqual([...options.ignoredChapters], [1, 2, 5, 8, 9])
})

test("exportBook stops before opening Camofox when interrupted", async () => {
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    exportBook(parseOptions(["90206"]), () => undefined, controller.signal),
    CrawlError,
  )
})

test("loadCrawlConfig parses the documented YAML settings", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "twkan-exporter-"))
  context.after(async () => rm(directory, { force: true, recursive: true }))
  const configFile = path.join(directory, "book.yaml")
  await writeFile(configFile, "book: \"90206\"\nconcurrency: 2\ndelayMs: 2000\nignore: \"1-2,8\"\noutput: output/test\nretries: 4\n", "utf8")

  const config = await loadCrawlConfig(configFile)
  assert.deepEqual(config, {
    book: "90206",
    concurrency: 2,
    delayMs: 2_000,
    ignore: "1-2,8",
    output: "output/test",
    retries: 4,
  })
})

test("chapterLinks preserves the chapter order exposed by Twkan", () => {
  const links = chapterLinks([
    "https://twkan.com/txt/90206/99",
    "https://twkan.com/txt/90206/2",
    "https://twkan.com/txt/90206/99",
  ])

  assert.deepEqual(links.map((link) => link.url), [
    "https://twkan.com/txt/90206/99",
    "https://twkan.com/txt/90206/2",
  ])
})

test("bookUrl accepts the full chapter index URL", () => {
  assert.equal(bookUrl("https://twkan.com/book/90206/index.html"), "https://twkan.com/book/90206.html")
})

test("chapterIndexUrl converts the book page to the complete chapter index", () => {
  // Given: a public Twkan book landing page
  const bookPage = "https://twkan.com/book/90206.html"

  // When: the crawler selects the chapter index
  const indexPage = chapterIndexUrl(bookPage)

  // Then: it uses the full index instead of the abbreviated landing page list
  assert.equal(indexPage, "https://twkan.com/book/90206/index.html")
})

test("normalizeContent removes Twkan promotion lines", () => {
  const content = "正文一\n\n  GOOGLE搜索TWKAN\n\n本書首發找台灣小說上台灣小說網，精彩盡在𝐭𝐰𝐤𝐚𝐧.𝐜𝐨𝐦\n\nPromoted Content\n\n正文二"
  assert.equal(normalizeContent(content), "正文一\n\n正文二")
})

test("normalizeContent removes the production Chinese promotion markers", () => {
  const content = [
    "chapter body",
    "",
    "\u2003\u2003GOOGLE\u641c\u7d22TWKAN",
    "",
    "\u672c\u66f8\u9996\u767c\u627e\u53f0\u7063\u5c0f\u8aaa\u4e0a\u53f0\u7063\u5c0f\u8aaa\u7db2",
    "",
    "Promoted Content",
    "",
    "next body",
  ].join("\n")

  assert.equal(normalizeContent(content), "chapter body\n\nnext body")
})

test("normalizeContent removes a Unicode-styled Twkan domain promotion", () => {
  const content = "正文一\n\n記住首發網站域名𝕥𝕨𝕜𝕒𝕟.𝕔𝕠𝕞\n\n正文二"
  assert.equal(normalizeContent(content), "正文一\n\n正文二")
})
