import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import {
  forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, type LinkProps } from 'react-router-dom';
import { CATEGORY_META } from '@/lib/categories';
import { SEVERITY_META } from '@/lib/severity';
import type { Category, HazardStatus, SeverityLevel } from '@/lib/types';
import { STATUS_META } from '@/lib/workflow';

export { clsx as cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-cyan text-midnight hover:bg-[#62E2FF] shadow-glow',
  secondary: 'bg-surface-2/80 text-ink border border-line hover:border-cyan/50 hover:bg-surface-3 backdrop-blur',
  ghost: 'text-ink-2 hover:text-ink hover:bg-white/5',
  danger: 'bg-critical text-white hover:bg-[#ff6570]',
  success: 'bg-success text-midnight hover:bg-[#6ae8b8]',
};
const sizes: Record<Size, string> = {
  sm: 'min-h-[36px] px-3 text-sm gap-1.5 rounded-lg',
  md: 'min-h-[44px] px-4 text-[15px] gap-2 rounded-xl',
  lg: 'min-h-[52px] px-6 text-base gap-2.5 rounded-xl',
};

export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: string) =>
  clsx(
    'inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none whitespace-nowrap',
    variants[variant], sizes[size], extra,
  );

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function Card({ className, children, strong, ...rest }: React.HTMLAttributes<HTMLDivElement> & { strong?: boolean }) {
  return <div className={clsx(strong ? 'glass-strong' : 'glass', className)} {...rest}>{children}</div>;
}

const toneClass = {
  cyan: 'bg-cyan/10 text-cyan border-cyan/30',
  orange: 'bg-safety/10 text-safety border-safety/30',
  red: 'bg-critical/10 text-critical border-critical/35',
  green: 'bg-success/10 text-success border-success/30',
  muted: 'bg-white/5 text-ink-2 border-line',
};
export function Badge({ tone = 'muted', children, className }: { tone?: keyof typeof toneClass; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', toneClass[tone], className)}>{children}</span>;
}

/** Severity uses colour AND a glyph + label, never colour alone. */
export function SeverityBadge({ level, score, preliminary }: { level: SeverityLevel; score?: number; preliminary?: boolean }) {
  const m = SEVERITY_META[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold"
      style={{ color: m.hex, borderColor: `${m.hex}55`, background: `${m.hex}14` }}
      title={preliminary ? 'Preliminary automated assessment' : undefined}
    >
      <span aria-hidden className="text-[9px] tracking-tighter">{m.glyph}</span>
      {m.label}
      {score !== undefined && <span className="font-mono font-medium opacity-80">{score}</span>}
      {preliminary && <span className="sr-only">(preliminary)</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: HazardStatus }) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', { cyan: 'bg-cyan', orange: 'bg-safety', red: 'bg-critical', green: 'bg-success', muted: 'bg-ink-3' }[m.tone])} aria-hidden />
      {m.label}
    </Badge>
  );
}

export function CategoryIcon({ category, className }: { category: Category; className?: string }) {
  const Icon = CATEGORY_META[category].icon;
  return <Icon className={clsx('h-5 w-5', className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-2">
      <Loader2 className="h-4 w-4 animate-spin text-cyan" aria-hidden />
      {label}…
    </span>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface-2 text-ink-2">{icon ?? <Inbox className="h-6 w-6" aria-hidden />}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {body && <p className="max-w-sm text-sm text-ink-2">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', error, onRetry }: { title?: string; error?: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-critical/30 bg-critical/10 text-critical"><CircleAlert className="h-6 w-6" aria-hidden /></div>
      <h3 className="text-lg font-bold">{title}</h3>
      {msg && <p className="max-w-md text-sm text-ink-2">{msg}</p>}
      {onRetry && <Button variant="secondary" onClick={onRetry} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>Try again</Button>}
    </div>
  );
}

export function Field({ label, error, hint, children, id, required }: { label: string; error?: string | null; hint?: ReactNode; children: (p: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode; id?: string; required?: boolean }) {
  const auto = useId();
  const fid = id ?? auto;
  const describedBy = [hint ? `${fid}-hint` : '', error ? `${fid}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={fid} className="label">
        {label} {required && <span className="text-critical" aria-hidden>*</span>}
      </label>
      {children({ id: fid, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && <p id={`${fid}-hint`} className="mt-1.5 text-xs text-ink-2">{hint}</p>}
      {error && <p id={`${fid}-err`} className="mt-1.5 flex items-center gap-1 text-xs font-medium text-critical"><CircleAlert className="h-3.5 w-3.5" aria-hidden />{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx('input min-h-[96px] resize-y', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={clsx('input appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%239AA8BD%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:18px] bg-[right_12px_center] bg-no-repeat pr-10', className)} {...p} />;
});

/** Accessible modal dialog with focus trap, Escape to close and focus restore. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Keep the latest onClose without re-running the open/close effect on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    setTimeout(() => (focusables().find((el) => el.dataset.autofocus !== undefined) ?? focusables()[1] ?? focusables()[0])?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab') {
        const els = focusables();
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);

  // Portal to <body>: page wrappers use transforms, which would trap position:fixed.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="pointer-events-auto fixed inset-0 z-[1000] flex items-end justify-center p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-midnight/75 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div
            ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
            className={clsx('glass-strong relative max-h-[92dvh] w-full overflow-y-auto rounded-b-none p-5 sm:rounded-2xl sm:p-6', size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md')}
            initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 20, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-lg font-bold">{title}</h2>
                {description && <div className="mt-1 text-sm text-ink-2">{description}</div>}
              </div>
              <button onClick={onClose} className="-m-2 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-white/5 hover:text-ink" aria-label="Close dialog"><X className="h-5 w-5" /></button>
            </div>
            {children}
            {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-midnight/60 p-1">
      {options.map((o) => (
        <button
          key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={clsx('min-h-[36px] rounded-lg px-3 text-sm font-semibold transition', value === o.value ? 'bg-surface-3 text-ink shadow' : 'text-ink-2 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-gradient-to-r from-cyan to-success transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'cyan', loading }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'cyan' | 'orange' | 'red' | 'green'; loading?: boolean }) {
  const color = { cyan: 'text-cyan', orange: 'text-safety', red: 'text-critical', green: 'text-success' }[tone];
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-ink-2">{label}</p>
      {loading ? <Skeleton className="mt-3 h-9 w-24" /> : <p className={clsx('mt-2 font-mono text-3xl font-semibold tracking-tight', color)}>{value}</p>}
      {hint && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
    </Card>
  );
}
