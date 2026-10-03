import { redirect } from 'next/navigation';

// Replaced by /superadmin/payments; kept so old links and bookmarks still work.
export default function Page() {
  redirect('/superadmin/payments');
}
