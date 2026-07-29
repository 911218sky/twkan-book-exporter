export class CrawlError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "CrawlError"
  }
}
