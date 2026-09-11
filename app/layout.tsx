import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kwik Relay — the outbound half of emergency dispatch',
  description:
    'A dispatcher console where CALL-E phone agents relay human-confirmed dispatch decisions to response units and return structured results. Independent synthetic demo — not an official 112 service.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
