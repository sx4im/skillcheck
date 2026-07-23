import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'skillcheck leaderboard',
  description: 'Static leaderboard for measured agent-skill effects.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
