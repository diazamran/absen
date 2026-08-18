/**
 * Custom time input — dua dropdown jam & menit format 24 jam.
 * Tidak pakai appearance-none supaya dropdown native selalu berfungsi.
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

  const period = hour < 12 ? 'AM' : 'PM';

  const selectClass = 'bg-transparent text-center font-mono font-bold text-ink outline-none cursor-pointer';

  return (
    <div className={`flex items-center gap-0.5 rounded-xl border border-line bg-white px-2 py-1.5 text-sm dark:bg-slate-900 ${className}`}>
      {/* Jam */}
      <select
        value={pad2(hour)}
        onChange={(e) => setHour(Number(e.target.value))}
        className={selectClass}
        style={{ width: 44, WebkitAppearance: 'menulist' as any }}
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={pad2(i)}>{pad2(i)}</option>
        ))}
      </select>
      <span className="font-bold text-muted">:</span>
      {/* Menit */}
      <select
        value={pad2(minute)}
        onChange={(e) => setMinute(Number(e.target.value))}
        className={selectClass}
        style={{ width: 44, WebkitAppearance: 'menulist' as any }}
      >
        {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
          <option key={m} value={pad2(m)}>{pad2(m)}</option>
        ))}
      </select>
      {/* Label AM/PM */}
      <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-muted dark:bg-slate-800">
        {period}
      </span>
    </div>
  );
}
