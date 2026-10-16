'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Dynamically import FlightMap with ssr: false to prevent window is undefined errors
const FlightMap = dynamic(() => import('@/components/FlightMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[450px] bg-zinc-950 flex flex-col items-center justify-center text-zinc-400 gap-3">
      <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      <span className="text-xs font-mono font-medium tracking-wider text-cyan-400 uppercase">
        Initializing Aeronautical Radar...
      </span>
    </div>
  ),
});

export default FlightMap;

