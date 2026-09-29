import type { ReactNode } from 'react'
import { RoleGuard } from '@/components/ui/role-guard'
import { ROUTE_ACCESS } from '@/lib/auth'

export default function CollectionsLayout({ children }: { children: ReactNode }) {
	return <RoleGuard allowedRoles={ROUTE_ACCESS['/collections']}>{children}</RoleGuard>
}
