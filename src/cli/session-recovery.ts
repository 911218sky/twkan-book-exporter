import { Camofox } from "../browser/camofox.js"

export function isCamofoxSessionReset(error: unknown): boolean {
  return Camofox.requiresRestart(error)
}
