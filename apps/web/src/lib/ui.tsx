import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect, useState } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import { cn } from './format';

// ===== Button =====
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-primary text-white hover:opacity-90 shadow-sm active:scale-[.98]',
    secondary: 'bg-primary-soft text-primary-dark hover:brightness-95 active:scale-[.98]',
    ghost: 'text-ink hover:bg-slate-100 dark:hover:bg-slate-800',
    danger: 'bg-red-500 text-white hover:bg-red-600 active:scale-[.98]',
    outline: 'border border-line text-ink hover:bg-slate-50 dark:hover:bg-slate-800',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 disabled:pointer-events-none',
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ===== Card =====
export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn('rounded-2xl border border-line/60 bg-surface p-4 shadow-card dark:bg-slate-800/70', onClick && 'cursor-pointer active:scale-[.99]', className)}
    >
      {children}
    </div>
  );
}

// ===== Input =====
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-slate-900';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputCls, className)} {...props} />;
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputCls, 'min-h-24', className)} {...props} />;
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputCls, 'appearance-none', className)} {...props}>
      {children}
    </select>
  );
}

// ===== Badge =====
const BADGE_COLORS: Record<string, string> = {
  PRESENT: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  LATE: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  EXCUSED: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  SICK: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  OFFICIAL_DUTY: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  DISPENSATION: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  ABSENT: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  LEAVE: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  PENDING: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  APPROVED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  REJECTED: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  ONLINE: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  OFFLINE: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  BLOCKED: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  UNKNOWN: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300',
};

export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE_COLORS[status] || 'bg-slate-100 text-slate-600')}>
      {label || status}
    </span>
  );
}

// ===== Bottom Sheet (mobile pattern) =====
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-fade-in rounded-t-3xl bg-surface p-5 pb-8 shadow-float dark:bg-slate-800">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ===== Skeleton =====
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-700/60', className)} />;
}

export function LoadingCard() {
  return (
    <Card className="space-y-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </Card>
  );
}

// ===== Empty state =====
export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center">
      <div className="rounded-2xl bg-primary-soft p-4">
        <Icon className="h-8 w-8 text-primary" />
      </div>
      <p className="mt-2 font-semibold text-ink">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
    </div>
  );
}

// ===== Stat card =====
export function StatCard({ label, value, icon: Icon, color, suffix }: { label: string; value: string | number; icon: LucideIcon; color: string; suffix?: string }) {
  return (
    <Card className="flex h-full items-center gap-3 p-3 sm:p-4">
      <div className="shrink-0 rounded-2xl p-2 sm:p-2.5" style={{ backgroundColor: `${color}1a`, color }}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold leading-tight text-ink sm:text-2xl">
          {value}
          {suffix && <span className="ml-0.5 text-xs font-semibold text-muted">{suffix}</span>}
        </p>
        <p className="truncate text-[10px] font-medium text-muted sm:text-xs">{label}</p>
      </div>
    </Card>
  );
}

// ===== Modal =====
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn('relative max-h-[90vh] w-full animate-fade-in overflow-y-auto rounded-3xl bg-surface p-6 shadow-float dark:bg-slate-800', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ===== Segmented =====
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-all',
            value === o.value ? 'bg-surface text-ink shadow-sm dark:bg-slate-700' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export { useState };
