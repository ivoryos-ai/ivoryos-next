"use client";
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import StepEditor from './StepEditor';

/**
 * A step still to come, opened for changing from the run panel's step list: the same editor the
 * failure pop-up has (StepEditor), without the retry. The step may start while it is open; the
 * edge then refuses the change and the editor says so.
 */
export default function StepEditDialog({ run, step, onClose }: { run: any; step: any; onClose: () => void }) {
  const row = typeof step?.parameters?._row === 'number' ? step.parameters._row + 1 : null;
  return createPortal(
    // Above the run bar and the queue drawer, below the shared dialogs (z-10100) and the failure
    // pop-up's level, like it.
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/25 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-labelledby="step-edit-title" className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#1a1a1a]">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="step-edit-title" className="text-sm font-bold text-gray-900 dark:text-gray-100">Change a step before it runs</h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={run?.name}>
              {run?.name}{row !== null ? ` · sample ${row}` : ''}
            </p>
            <p className="mt-1 font-mono text-[13px] text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]">{step.instrument}.{step.method}</p>
          </div>
          <button onClick={onClose} title="Close" className="shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <StepEditor runId={run.id} stepId={step.id} run={run} retry={false} cancelLabel="Cancel" onDone={onClose} onCancel={onClose} />
      </div>
    </div>,
    document.body,
  );
}
