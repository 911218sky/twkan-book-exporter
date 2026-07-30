import assert from "node:assert/strict"
import test from "node:test"
import { createWorkerTabs } from "../src/browser/worker-tabs.js"

test("createWorkerTabs waits for each tab before creating the next", async () => {
  // Given: a Camofox tab factory that rejects overlapping session creation
  const opened: string[] = []
  let active = 0
  const createTab = async (): Promise<{ readonly tabId: string }> => {
    active += 1
    assert.equal(active, 1)
    const tabId = `tab-${opened.length + 1}`
    await Promise.resolve()
    opened.push(tabId)
    active -= 1
    return { tabId }
  }

  // When: workers need multiple Camofox tabs
  const tabs = await createWorkerTabs(3, createTab)

  // Then: tabs are created one at a time in stable order
  assert.deepEqual(tabs, ["tab-1", "tab-2", "tab-3"])
  assert.deepEqual(opened, ["tab-1", "tab-2", "tab-3"])
})
