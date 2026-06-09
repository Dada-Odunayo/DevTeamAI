import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'DevTeam AI',
  description: 'Qwen-powered multi-agent software delivery team',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
