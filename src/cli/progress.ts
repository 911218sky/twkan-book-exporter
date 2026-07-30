import { logUpdateStderr } from "log-update"

type CrawlSummary = {
  readonly cached: number
  readonly completed: number
  readonly downloaded: number
  readonly total: number
}

type TerminalLine = {
  readonly done: () => void
  readonly update: (message: string) => void
}

const stderrTerminalLine = {
  done: () => logUpdateStderr.done(),
  update: (message: string) => logUpdateStderr(message),
} satisfies TerminalLine

// 互動終端覆寫同一行；重導輸出時定期換行，避免日誌膨脹或看不到進度。
export class ProgressReporter {
  // 固定程式啟動時的快取基準，避免重啟後把本次下載重新計入 cache。
  private initialCached: number | undefined
  private completed = 0
  private lastLogged = -1
  private restartingNow = false
  private total = 0

  public constructor(
    private readonly write: (message: string) => void = (message) => console.error(message),
    private readonly interactive = process.stderr.isTTY === true,
    private readonly terminalLine: TerminalLine = stderrTerminalLine,
  ) {}

  public summary(): CrawlSummary {
    const cached = this.initialCached ?? 0
    return { cached, completed: this.completed, downloaded: this.completed - cached, total: this.total }
  }

  public render(cached: number, completed: number, total: number): void {
    this.initialCached ??= cached
    this.completed = Math.max(this.completed, completed)
    this.total = total
    this.writeProgress(this.message(), this.restartingNow)
    this.restartingNow = false
  }

  public restarting(reason: string): void {
    this.writeProgress(`${this.message()} [${reason}，正在重啟 Camofox...]`, true)
    this.restartingNow = true
  }

  public resumed(): void {
    if (!this.restartingNow) return
    this.writeProgress(this.message(), true)
    this.restartingNow = false
  }

  private message(): string {
    const summary = this.summary()
    return `Progress ${summary.completed}/${summary.total} | cache ${summary.cached} | downloaded ${summary.downloaded}`
  }

  private writeProgress(message: string, force = false): void {
    if (this.interactive) {
      const summary = this.summary()
      // log-update 會依終端顯示寬度清除舊幀，包含中文全形字元與較長的重啟提示。
      this.terminalLine.update(message)
      if (summary.completed === summary.total) this.terminalLine.done()
      return
    }
    // 重導到檔案或 CI 時不能覆寫歷史內容，只定期新增一行以控制日誌大小。
    const summary = this.summary()
    const interval = Math.max(1, Math.floor(summary.total / 20))
    if (force || summary.completed === summary.total || summary.completed - this.lastLogged >= interval) {
      this.write(message)
      this.lastLogged = summary.completed
    }
  }
}
