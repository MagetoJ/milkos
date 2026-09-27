import './globals.css';
import Navbar from './components/Navbar';
import { Providers } from '@/components/providers';

export const metadata = {
  title: 'MaziwaCollect - Multi-Tenant Milk Platform',
  description: 'Digital Milk Collection and Cooperative Management',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <Providers>
          <Navbar />
          <main className="main-content">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
