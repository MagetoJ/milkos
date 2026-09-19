import './styles.css';
import Navbar from './components/Navbar';

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
        <Navbar />
        <main className="main-content">{children}</main>
      </body>
    </html>
  );
}
