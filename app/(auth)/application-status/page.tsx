import { StatusForm } from './status-form';

export const metadata = { title: 'Application status · MilkOS' };

/** `?reference=` is prefilled from the link on the "Application submitted" screen. */
export default async function ApplicationStatusPage({ searchParams }: { searchParams: Promise<{ reference?: string | string[] }> }) {
  const { reference } = await searchParams;
  return <StatusForm initialReference={typeof reference === 'string' ? reference.slice(0, 64) : ''} />;
}
