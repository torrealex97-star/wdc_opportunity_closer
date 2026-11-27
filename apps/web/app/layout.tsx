import type { Metadata } from 'next';
import './globals.css';
import RecoveryRedirect from '../components/RecoveryRedirect';
export const metadata: Metadata = {
  title: 'Women Digital Closer',
  description: 'Selección de oportunidades, formación y práctica para las alumnas de Women Digital Closers.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body><RecoveryRedirect />{children}</body></html>;
}
