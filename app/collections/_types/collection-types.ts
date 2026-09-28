export interface CollectionRecord {
  id: string
  farmer: string
  volumeLitres: number
  fatPercent: number
  snfPercent: number
  amount: number
  status: 'Synced' | 'Pending'
}

export interface CreateCollectionPayload {
  farmerId: string
  volumeLitres: number
  fatPercent: number
  snfPercent: number
}