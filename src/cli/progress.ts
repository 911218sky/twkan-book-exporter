// 互動終端覆寫同一行；重導輸出時定期換行，避免日誌膨脹或看不到進度。
export class ProgressReporter {
  private lastLogged = -1

  public reset(): void { this.lastLogged = -1 }

  public render(cached: number, completed: number, total: number): void {
    const message = `Progress ${completed}/${total} | cache ${cached} | downloaded ${completed - cached}`
    if (process.stderr.isTTY === true) {
      process.stderr.write(`\r${message}${completed === total ? "\n" : ""}`)
      return
    }
    const interval = Math.max(1, Math.floor(total / 20))
    if (completed === total || completed - this.lastLogged >= interval) {
      console.error(message)
      this.lastLogged = completed
    }
  }
}
