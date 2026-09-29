// PROTOTYPE, throwaway: floating bar that cycles `?variant=` (and any prototype-only fixture
// controls passed as children). Never rendered in production builds.
import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

export function PrototypeSwitcher({
  variants,
  names,
  children,
}: {
  variants: string[];
  names: Record<string, string>;
  children?: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const current = params.get('variant') ?? variants[0]!;
  const index = Math.max(0, variants.indexOf(current));

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]!;
    setParams(
      (p) => {
        p.set('variant', next);
        return p;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span className="whitespace-nowrap">
        {variants[index]} ({names[variants[index]!]})
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
      {children && <span className="border-l border-gray-600 pl-3">{children}</span>}
    </div>
  );
}
