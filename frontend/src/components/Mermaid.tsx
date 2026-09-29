import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import mermaid from 'mermaid';

interface MermaidProps {
  chart: string;
}

// Initialize mermaid once globally
let mermaidInitialized = false;

// Pre-render validation: reject obviously non-mermaid content
function looksLikeMermaidChart(chart: string): boolean {
  if (!chart || !chart.trim()) return false;
  const trimmed = chart.trim();

  const invalidPatterns = [
    /^function\s+/i,
    /^import\s+/i,
    /^const\s+|^let\s+|^var\s+/i,
    /^class\s+[A-Z]/,
    /^<[a-z]/i,
  ];
  const firstLine = trimmed.split('\n')[0].trim();
  if (invalidPatterns.some(p => p.test(firstLine))) return false;

  const hasMermaidSyntax =
    /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart)/m.test(trimmed) ||
    trimmed.includes('-->') ||
    trimmed.includes('->') ||
    trimmed.match(/\[[^\]]+\].*-->/) !== null;

  if (!hasMermaidSyntax && trimmed.length > 20) return false;
  if (trimmed.length < 10) return false;
  return true;
}

// Sanitize common AI output issues before rendering
function sanitizeMermaid(chart: string): string {
  let s = chart.trim();
  // Remove markdown code fences if present
  s = s.replace(/^```(?:mermaid)?\s*/i, '').replace(/\s*```$/, '');
  // Wrap node labels that contain unescaped parentheses
  s = s.replace(
    /\[([^\]"']*[()][^\]"']*)\]/g,
    (match, label) => {
      if (!label.startsWith('"') && !label.startsWith("'")) {
        return `["${label.replace(/"/g, '\\"')}"]`;
      }
      return match;
    }
  );
  return s.trim();
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.str === 'string') return e.str;
  }
  return 'Invalid diagram syntax';
}

const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const [renderedSvg, setRenderedSvg] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}-${Date.now()}`);

  useEffect(() => {
    mountedRef.current = true;
    setError(null);

    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        // 'strict' (not 'loose') — diagrams are AI-generated, so disable raw
        // HTML labels and click-directive JS callbacks to prevent XSS.
        securityLevel: 'strict',
        fontFamily: 'Inter, ui-sans-serif, system-ui',
        themeVariables: {
          fontSize: '14px',
          fontFamily: 'Inter, ui-sans-serif',
          primaryColor: '#EEF2FF',
          primaryTextColor: '#2D2A26',
          primaryBorderColor: '#C7D2FE',
          lineColor: '#6E6962',
          secondaryColor: '#F5F2EB',
          tertiaryColor: '#F9F8F6',
          background: '#FFFFFF',
          mainBkg: '#EEF2FF',
          nodeBorder: '#C7D2FE',
          clusterBkg: '#F9F8F6',
          titleColor: '#2D2A26',
          edgeLabelBackground: '#FFFFFF',
          activeTaskBorderColor: '#4F46E5',
          activeTaskBkgColor: '#EEF2FF',
        },
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: 'basis',
        },
      });
      mermaidInitialized = true;
    }

    const trimmedChart = chart?.trim();
    if (!trimmedChart) {
      setRenderedSvg(null);
      setIsRendering(false);
      return;
    }

    if (!looksLikeMermaidChart(trimmedChart)) {
      if (mountedRef.current) {
        setError('Content does not appear to be a valid Mermaid diagram.');
        setIsRendering(false);
      }
      return;
    }

    const sanitized = sanitizeMermaid(trimmedChart);
    setIsRendering(true);
    setRenderedSvg(null);

    const currentId = idRef.current;
    // Wait for Inter to load: mermaid sizes node boxes from text metrics, so rendering early clips labels.
    const renderPromise = document.fonts.ready.then(() => mermaid.render(currentId, sanitized));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Rendering timeout after 10s')), 10000)
    );

    Promise.race([renderPromise, timeoutPromise])
      .then((result) => {
        if (mountedRef.current) {
          const r = result as { svg: string };
          setRenderedSvg(r.svg);
          setIsRendering(false);
          setError(null);
        }
      })
      .catch((e) => {
        console.error('Mermaid render failed:', e);
        if (mountedRef.current) {
          setError(extractErrorMessage(e));
          setIsRendering(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [chart]);

  return (
    <div className="my-6 w-full">
      {isRendering && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
          <RefreshCw size={18} className="animate-spin" />
          Rendering diagram…
        </div>
      )}

      {renderedSvg && !isRendering && !error && (
        <div className="bg-surface border border-border-subtle rounded-2xl p-6 overflow-x-auto shadow-soft">
          <div
            dangerouslySetInnerHTML={{ __html: renderedSvg }}
            className="flex justify-center w-full [&_svg]:max-w-full [&_svg]:h-auto"
          />
        </div>
      )}

      {error && !isRendering && (
        <div className="w-full rounded-2xl border border-border-subtle overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-surface-alt border-b border-border-subtle">
            <span className="text-xs font-bold uppercase tracking-wider text-text-muted">Diagram Source</span>
            <span className="text-xs text-danger font-medium truncate max-w-[240px]" title={error}>{error}</span>
          </div>
          <pre className="p-4 text-xs font-mono text-text-muted overflow-x-auto whitespace-pre bg-surface leading-relaxed">
            {chart}
          </pre>
        </div>
      )}
    </div>
  );
};

export default Mermaid;
