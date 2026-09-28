import type { Cooperative, CooperativeApplicationPayload } from '../_types/cooperative-types'

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function listCooperatives(): Promise<Cooperative[]> {
  const response = await fetch(`${apiBaseUrl}/api/v1/cooperatives`)
  if (!response.ok) throw new Error(`Could not load cooperatives (${response.status})`)
  return response.json() as Promise<Cooperative[]>
}

export async function submitCooperativeApplication(payload: CooperativeApplicationPayload): Promise<Cooperative> {
  const response = await fetch(`${apiBaseUrl}/api/v1/cooperatives/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Could not submit application (${response.status})`)
  return response.json() as Promise<Cooperative>
}