'use client';

import { CheckSquare, ClipboardCheck, Square } from 'lucide-react';
import { LiveTelemetry } from '@/types/flight';
import { buildChecklists } from '@/lib/ground';

interface ChecklistPanelProps {
  telemetry: LiveTelemetry;
}

export default function ChecklistPanel({ telemetry }: ChecklistPanelProps) {
  const checklists = buildChecklists(telemetry);

  return (
    <div className="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-bold text-white uppercase tracking-wider">Checklists</span>
        <span className="ml-auto text-[9px] font-mono text-zinc-500">AUTO-VALIDATED</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {checklists.map((checklist) => {
          const doneCount = checklist.items.filter((item) => item.done).length;
          return (
            <div
              key={checklist.id}
              className={`p-2 rounded-lg border ${
                checklist.isComplete
                  ? 'border-emerald-700/60 bg-emerald-950/20'
                  : 'border-zinc-800 bg-zinc-950/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    checklist.isComplete ? 'text-emerald-300' : 'text-zinc-300'
                  }`}
                >
                  {checklist.title}
                </span>
                <span className="text-[9px] font-mono text-zinc-500">
                  {doneCount}/{checklist.items.length}
                </span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {checklist.items.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-center gap-1.5 text-[10px] font-mono ${
                      item.done ? 'text-emerald-300' : 'text-zinc-500'
                    }`}
                  >
                    {item.done ? (
                      <CheckSquare className="w-3 h-3 shrink-0" />
                    ) : (
                      <Square className="w-3 h-3 shrink-0" />
                    )}
                    <span className="truncate">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
