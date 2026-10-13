"use client";

import { Download } from 'lucide-react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';

SyntaxHighlighter.registerLanguage('python', python);

interface PythonCodeViewProps {
  code: string;
  theme: 'light' | 'dark';
  /** Suggested filename for the download button, without extension. Defaults to 'sequence'. */
  fileName?: string;
  /** `drawer`: fills a side drawer, tighter padding, no download button of its own (the drawer's header has one). */
  variant?: 'page' | 'drawer';
}

/** Save the generated script as `<fileName>.py`. The view's own button and the header's menu both use it. */
export function downloadPython(code: string, fileName?: string) {
  const blob = new Blob([code], { type: 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(fileName || 'sequence').trim() || 'sequence'}.py`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function PythonCodeView({ code, theme, fileName, variant = 'page' }: PythonCodeViewProps) {
  const isDark = theme === 'dark';
  const inDrawer = variant === 'drawer';

  const downloadCode = () => downloadPython(code, fileName);

  return (
    <div className={`flex-1 min-w-0 overflow-auto h-full flex flex-col ${inDrawer ? 'p-4' : 'p-8'} ${isDark ? 'bg-[#0a0a0a]' : 'bg-gray-50'}`}>
      <div className={`rounded-xl border shadow-sm overflow-hidden flex-shrink-0 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <SyntaxHighlighter
          language="python"
          style={isDark ? oneDark : oneLight}
          showLineNumbers
          customStyle={{
            margin: 0,
            padding: '1.5rem',
            fontSize: '0.8125rem',
            background: isDark ? '#111111' : '#ffffff',
          }}
          codeTagProps={{ style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } }}
        >
          {code || '# Your sequence is empty — drag blocks in from the toolbox to see generated Python here.'}
        </SyntaxHighlighter>
      </div>
      {!inDrawer && <div className="flex justify-end mt-3 flex-shrink-0">
        <button
          onClick={downloadCode}
          disabled={!code}
          title="Download as .py"
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isDark
            ? 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10'
            : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download .py</span>
        </button>
      </div>}
    </div>
  );
}
