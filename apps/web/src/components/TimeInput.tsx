/**
 * Custom time input — two scrollable columns (jam & menit) dalam format 24 jam.
 * Lebih universal daripada <input type="time"> yang AM/PM-nya sering macet.
 */

function pad2(v: number): string {
  return String(v).padStart(2, '0');
}

interface TimeInputProps {
  value: string; // "HH:MM"
  onChange: (hhmm: string) => void;
  className?: string;
}

export default function TimeInput({ value, onChange, className = '' }: TimeInputProps) {
  const [hStr, mStr] = value.split(':');
  const hour = Math.min(23, Math.max(0, Number(hStr) || 0));
  const minute = Math.min(59, Math.max(0, Number(mStr) || 0));

  const setHour = (h: number) => onChange(`${pad2(h)}:${pad2(minute)}`);
  const setMinute = (m: number) => onChange(`${pad2(hour)}:${pad2(m)}`);

  // 12-hour display label
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

  return (
    <div className={`flex items-center gap-1 rounded-xl border border-line bg-white px-2 py-1.5 text-sm dark:bg-slate-900 ${className}`}>
      {/* Hour */}
      <select
        value={pad2(hour)}
        onChange={(e) => setHour(Number(e.target.value))}
        className="w-12 appearance-none bg-transparent text-center font-mono font-bold text-ink outline-none"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={pad2(i)}>{pad2(i)}</option>
        ))}
      </select>
      <span className="font-bold text-muted">:</span>
      {/* Minute */}
      <select
        value={pad2(minute)}
        onChange={(e) => setMinute(Number(e.target.value))}
        className="w-12 appearance-none bg-transparent text-center font-mono font-bold text-ink outline-none"
      >
        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
          <option key={m} value={pad2(m)}>{pad2(m)}</option>
        ))}
      </select>
      {/* AM/PM indicator (read-only, just for display) */}
      <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-muted dark:bg-slate-800">
        {period}
      </span>
    </div>
  );
}
