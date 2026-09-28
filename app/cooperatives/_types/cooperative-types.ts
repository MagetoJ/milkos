export interface Cooperative {
  id: string
  name: string
  location: string
  memberCount: number
  status: 'Pending' | 'Approved' | 'Needs review'
}

export interface CooperativeApplicationPayload {
  name: string
  location: string
  memberCount: number
}