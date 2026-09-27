import './styles.css';
import Navbar from './components/Navbar';
import { AuthProvider } from './components/AuthProvider';

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
      <body>
        <AuthProvider>
          <Navbar />
          <main className="main-content">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
