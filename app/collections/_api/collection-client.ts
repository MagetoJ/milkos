import type { CollectionRecord, CreateCollectionPayload } from '../_types/collection-types'

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function listCollections(): Promise<CollectionRecord[]> {
  const response = await fetch(`${apiBaseUrl}/api/v1/collections`)
  if (!response.ok) throw new Error(`Could not load collections (${response.status})`)
  return response.json() as Promise<CollectionRecord[]>
}

export async function createCollection(payload: CreateCollectionPayload): Promise<CollectionRecord> {
  const response = await fetch(`${apiBaseUrl}/api/v1/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Could not save collection (${response.status})`)
  return response.json() as Promise<CollectionRecord>
}