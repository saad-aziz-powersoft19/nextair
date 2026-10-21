import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';

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
  applicationName: 'NextAir',
  appleWebApp: {
    capable: true,
    title: 'NextAir',
    statusBarStyle: 'black',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#09090b',
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
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
