export class CrawlError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "CrawlError"
  }
}

export class BrowserRestartRequiredError extends CrawlError {
  public override readonly name = "BrowserRestartRequiredError"
}
