"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Code, FileJson, MoreHorizontal, Upload } from 'lucide-react';

/**
 * The header's "everything else" menu: the workflow as Python (opens PythonDrawer, which has
 * the download) and as JSON (export, import) behind one ⋯ button. They used to be two controls, a hover-opened Manage
 * holding the JSON pair and a Python toggle beside it: two buttons' worth of bar for four actions
 * used now and then. Opens on click, not hover, so it behaves the same with a trackpad, a touch
 * screen and inside the desktop app; closes on a click outside, on Escape, or on choosing.
 * Shared by the edge Designer and Cloud's sequence editor so the two cannot drift.
 */
export function WorkflowFileMenu({
  onViewPython,
  onExportJSON,
  onImportJSON,
  hasSteps,
}: {
  onViewPython: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  /** Export is offered only when there is a main workflow to write out. */
  hasSteps: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (icon: React.ReactNode, label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => { setOpen(false); onClick(); }}
      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2.5"
    >
      <span className="text-gray-400 dark:text-gray-500 inline-flex">{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Python and JSON: view, export, import"
        className={`flex items-center px-3 py-1.5 rounded text-sm font-medium transition-all border ${open
          ? 'bg-accent-soft text-accent-fg border-accent-tint/60'
          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10'}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-52 bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/10 rounded-xl shadow-lg z-50 overflow-hidden py-1">
          {item(<Code className="w-4 h-4" />, 'View as Python', onViewPython)}
          <div className="my-1 border-t border-gray-100 dark:border-white/5" />
          {item(<FileJson className="w-4 h-4" />, 'Export JSON', onExportJSON, !hasSteps)}
          {item(<Upload className="w-4 h-4" />, 'Import JSON…', onImportJSON)}
        </div>
      )}
    </div>
  );
}
