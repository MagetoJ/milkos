import type { ReactNode } from 'react'
import { RoleGuard } from '@/components/ui/role-guard'
import { ROUTE_ACCESS } from '@/lib/auth'

export default function CooperativesLayout({ children }: { children: ReactNode }) {
	return <RoleGuard allowedRoles={ROUTE_ACCESS['/cooperatives']}>{children}</RoleGuard>
}
