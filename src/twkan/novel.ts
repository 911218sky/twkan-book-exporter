import { CrawlError } from "../core/errors.js"

const origin = "https://twkan.com"

export type ChapterLink = { readonly url: string }
export type Chapter = { readonly content: string; readonly number: number; readonly title: string }
export type BookMetadata = {
  readonly author: string
  readonly category: string
  readonly keywords: string
  readonly status: string
  readonly synopsis: string
  readonly title: string
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function bookUrl(input: string): string {
  if (/^\d+$/.test(input)) return `${origin}/book/${input}.html`
  const url = new URL(input)
  const match = url.hostname === "twkan.com" ? url.pathname.match(/^\/book\/(\d+)(?:\.html|\/index\.html)$/) : null
  if (match?.[1] === undefined) throw new CrawlError("Provide a Twkan book ID or https://twkan.com/book/<id>.html URL.")
  return `${origin}/book/${match[1]}.html`
}

export function chapterIndexUrl(value: string): string {
  const match = new URL(value).pathname.match(/^\/book\/(\d+)\.html$/)
  if (match?.[1] === undefined) throw new CrawlError("Cannot build the Twkan chapter index URL.")
  return `${origin}/book/${match[1]}/index.html`
}

/** 解析 Twkan 公開書頁腳本提供的書名，用於合併檔案名稱。 */
export function bookTitle(value: unknown): string {
  if (!isRecord(value) || typeof value["title"] !== "string" || value["title"].trim() === "") {
    throw new CrawlError("The book page did not expose a readable title.")
  }
  return value["title"].trim()
}

export function bookMetadata(value: unknown): BookMetadata {
  if (!isRecord(value)) throw new CrawlError("The book page did not expose readable metadata.")
  const title = typeof value["title"] === "string" ? value["title"].trim() : ""
  const author = typeof value["author"] === "string" ? value["author"].trim() : ""
  const category = typeof value["category"] === "string" ? value["category"].trim() : ""
  if (title === "" || author === "" || category === "") throw new CrawlError("The book page did not expose readable metadata.")
  return {
    author,
    category,
    keywords: typeof value["keywords"] === "string" ? value["keywords"].trim() : "",
    status: typeof value["status"] === "string" ? value["status"].trim() : "",
    synopsis: typeof value["synopsis"] === "string" ? value["synopsis"].trim() : "",
    title,
  }
}

export function chapterLinks(values: readonly string[]): readonly ChapterLink[] {
  const links: ChapterLink[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const url = new URL(value, origin)
    const match = url.hostname === "twkan.com" ? url.pathname.match(/^\/txt\/\d+\/(\d+)$/) : null
    if (match?.[1] !== undefined && !seen.has(url.href)) {
      seen.add(url.href)
      links.push({ url: url.href })
    }
  }
  return links
}

export function chapterUrls(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new CrawlError("Book page returned invalid chapter links.")
  return value
}

export function normalizeContent(value: string): string {
  // 同時覆蓋一般文字與 Unicode 轉義形式，避免網站推廣字樣混入章節正文。
  const knownMarkers = /google\s*(?:\u641c\u7d22|\u641c\u5c0b)?\s*twkan|\btwkan\.com\b|\u672c\u66f8\u9996\u767c|\u53f0\u7063\u5c0f\u8aaa\u7db2|promoted\s+content/i
  const noise = /google\s*(?:搜索|搜尋)\s*twkan|twkan\.com|本書首發|台灣小說網|promoted\s+content/i
  return value.split("\n").filter((line) => !noise.test(line.normalize("NFKC")) && !knownMarkers.test(line.normalize("NFKC"))).join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

export function requireChapter(value: unknown, number: number): Chapter {
  if (!isRecord(value)) throw new CrawlError(`Chapter ${number} returned an invalid page payload.`)
  const content = typeof value["content"] === "string" ? normalizeContent(value["content"]) : ""
  const title = typeof value["title"] === "string" ? value["title"].trim() : ""
  if (title === "" || content === "") throw new CrawlError(`Chapter ${number} did not expose readable public content.`)
  return { content, number, title }
}
