import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Secure-Contract | INCUBATEX Hackathon',
  description: 'AI-driven smart contract risk analysis platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}