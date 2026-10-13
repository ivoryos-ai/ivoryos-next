"use client";

import React, { useEffect } from 'react';
import { Code, Download, X } from 'lucide-react';
import { PythonCodeView, downloadPython } from './PythonCodeView';

/**
 * The workflow as the Python script it runs, in a drawer beside the canvas. It used to replace
 * the canvas, with the way back in the same menu that had opened it. A drawer keeps the steps in
 * view and follows them as they are edited, since the code is generated from the canvas on every
 * render. No backdrop, on purpose: the canvas stays usable with the code open. Closes with the ×
 * or Escape. Download lives here, with the code, rather than as a second item in the menu.
 */
export function PythonDrawer({
  open,
  code,
  theme,
  fileName,
  onClose,
}: {
  open: boolean;
  code: string;
  theme: 'light' | 'dark';
  /** The workflow's name, which names the downloaded file. */
  fileName?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const name = `${(fileName || 'sequence').trim() || 'sequence'}.py`;

  return (
    <aside
      role="dialog"
      aria-label="Python"
      className="fixed inset-y-0 right-0 z-[120] w-full max-w-xl flex flex-col bg-white dark:bg-[#111] border-l border-gray-200 dark:border-white/10 shadow-2xl"
    >
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 border-b border-gray-200 dark:border-white/10">
        <Code className="w-4 h-4 shrink-0 text-gray-400" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900 dark:text-white truncate">{name}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">The script this workflow runs. It follows the canvas as you edit.</div>
        </div>
        <button
          type="button"
          onClick={() => downloadPython(code, fileName)}
          disabled={!code}
          title="Save this script as a .py file"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border shrink-0 bg-white border-gray-200 text-gray-700 hover:bg-gray-50 dark:bg-white/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Download .py
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="p-1.5 -mr-1 shrink-0 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="flex-1 min-h-0 flex">
        <PythonCodeView code={code} theme={theme} fileName={fileName} variant="drawer" />
      </div>
    </aside>
  );
}
