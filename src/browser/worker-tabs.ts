export type CreatedTab = { readonly tabId: string }

export async function createWorkerTabs(
  count: number,
  createTab: () => Promise<CreatedTab>,
): Promise<readonly string[]> {
  const tabIds: string[] = []
  for (let index = 0; index < count; index += 1) {
    tabIds.push((await createTab()).tabId)
  }
  return tabIds
}
