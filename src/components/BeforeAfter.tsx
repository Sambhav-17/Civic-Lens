import { useId, useRef, useState } from 'react';
import { useMediaQuery } from '@/hooks/useQuery';

/**
 * Original report photo vs after-repair photo.
 * Side by side on wide screens; a swipe/drag comparison slider on mobile
 * (also operable with the keyboard via the range input).
 */
export function BeforeAfter({ before, after, beforeLabel = 'Reported', afterLabel = 'After repair' }: { before: string; after: string; beforeLabel?: string; afterLabel?: string }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const dragging = useRef(false);

  if (wide)
    return (
      <div className="grid grid-cols-2 gap-3">
        {[[before, beforeLabel, 'border-critical/40 text-critical'], [after, afterLabel, 'border-success/40 text-success']].map(([src, l, c]) => (
          <figure key={l} className={`overflow-hidden rounded-2xl border ${c.split(' ')[0]}`}>
            <img src={src} alt={`${l} photo`} className="aspect-[4/3] w-full object-cover" />
            <figcaption className={`bg-midnight/80 px-3 py-2 text-xs font-bold uppercase tracking-wider ${c.split(' ')[1]}`}>{l}</figcaption>
          </figure>
        ))}
      </div>
    );

  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div>
      <div
        ref={box}
        className="relative aspect-[4/3] touch-pan-y select-none overflow-hidden rounded-2xl border border-line"
        onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); move(e.clientX); }}
        onPointerMove={(e) => dragging.current && move(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      >
        <img src={after} alt={`${afterLabel} photo`} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={before} alt={`${beforeLabel} photo`} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,.8)]" style={{ left: `${pos}%` }} aria-hidden>
          <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-bold text-midnight">⇆</span>
        </div>
        <span className="absolute left-2 top-2 rounded-md bg-critical/90 px-2 py-0.5 text-[10px] font-bold uppercase text-white">{beforeLabel}</span>
        <span className="absolute right-2 top-2 rounded-md bg-success/90 px-2 py-0.5 text-[10px] font-bold uppercase text-midnight">{afterLabel}</span>
      </div>
      <label htmlFor={id} className="sr-only">Comparison position</label>
      <input id={id} type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="mt-3 w-full accent-cyan" />
    </div>
  );
}
