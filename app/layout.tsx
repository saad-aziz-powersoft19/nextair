import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'NextAir - 2D Aeronautical Flight Simulation & Radar Navigation',
  description:
    'Real-time 2D aeronautical flight simulation engine built with Next.js and Leaflet. Choose your departure, destination, aircraft, and navigate across the globe with realistic physics.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-zinc-950 text-zinc-100 antialiased dark">
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen flex flex-col bg-zinc-950 font-sans`}>
        {children}
      </body>
    </html>
  );
}
