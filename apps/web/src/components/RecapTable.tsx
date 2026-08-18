import { Card } from '../lib/ui';

/* Status letter → display info */
const LETTER_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  H: { bg: '#dcfce7', color: '#166534', label: 'H' },
  S: { bg: '#fef9c3', color: '#854d0e', label: 'S' },
  I: { bg: '#dbeafe', color: '#1e40af', label: 'I' },
  A: { bg: '#fecaca', color: '#991b1b', label: 'A' },
  D: { bg: '#e0e7ff', color: '#3730a3', label: 'D' },
  P: { bg: '#d1fae5', color: '#065f46', label: 'P' },
};

interface RecapRow {
  no: number;
  className: string;
  nis: string;
  name: string;
  semester: { S: number; I: number; A: number; D: number; P: number; total: number };
  last30Days: { S: number; I: number; A: number; D: number; P: number; total: number };
  daily: Record<string, string>;
}

interface RecapData {
  today: string;
  semesterName: string;
  fromDate?: string;
  toDate?: string;
  dateColumns: string[];
  rows: RecapRow[];
}

function DayHeader({ dateStr }: { dateStr: string }) {
  const d = new Date(dateStr + 'T12:00:00+07:00');
  const dayName = d.toLocaleDateString('id-ID', { weekday: 'short' });
  const dayNum = d.getDate();
  const monthShort = d.toLocaleDateString('id-ID', { month: 'short' });
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-[10px] font-medium text-muted">{dayName}</span>
      <span className="text-xs font-bold text-ink">{dayNum}</span>
      <span className="text-[10px] text-muted">{monthShort}</span>
    </div>
  );
}

const STAT_COLS = ['S', 'I', 'A', 'D', 'P'] as const;

export default function RecapTable({ data }: { data: RecapData }) {
  if (!data?.rows?.length) return null;
  const todayKey = data.today;

  return (
    <Card className="mt-4 overflow-hidden">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-ink">Rekap Absensi Siswa</h3>
          <p className="text-xs text-muted">
            Smt. {data.semesterName} · {data.fromDate && data.toDate ? `${data.fromDate} s/d ${data.toDate} (${data.dateColumns.length} hari)` : `${data.dateColumns.length} hari terakhir`} · {data.rows.length} siswa
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {Object.entries(LETTER_STYLE).map(([k, v]) => (
            <span key={k} className="rounded px-1.5 py-0.5 font-bold" style={{ backgroundColor: v.bg, color: v.color }}>
              {v.label} = {k === 'H' ? 'Hadir' : k === 'S' ? 'Sakit' : k === 'I' ? 'Izin' : k === 'A' ? 'Alpha' : k === 'D' ? 'Dinas' : 'Dispensasi'}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs" style={{ minWidth: 600 }}>
          <thead>
            {/* Header row 1: group labels */}
            <tr className="bg-slate-100 dark:bg-slate-800">
              <th className="px-2 py-1 text-center font-bold text-ink" rowSpan={2}>No</th>
              <th className="px-2 py-1 text-center font-bold text-ink" rowSpan={2}>Kelas</th>
              <th className="sticky left-0 z-20 border-r-2 border-slate-400 bg-slate-100 px-2 py-1 text-center font-bold text-ink dark:bg-slate-800 dark:border-slate-600" rowSpan={2}>Nama</th>
              <th className="border border-slate-300 bg-slate-200 px-3 py-1 text-center font-bold text-ink dark:bg-slate-700" colSpan={6}>{'Smt. ' + data.semesterName}</th>
              <th className="border border-slate-300 bg-slate-200 px-3 py-1 text-center font-bold text-ink dark:bg-slate-700" colSpan={6}>Last 30 Day</th>
              <th className="border border-slate-300 bg-slate-200 px-3 py-1 text-center font-bold text-ink dark:bg-slate-700" colSpan={data.dateColumns.length}>Detail Harian</th>
            </tr>
            {/* Header row 2: sub-column labels */}
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              {STAT_COLS.map((k) => (
                <th key={`sem-${k}`} className="border border-slate-300 px-2 py-0.5 text-center text-[11px] font-semibold text-muted">{k}</th>
              ))}
              <th className="border border-slate-300 bg-slate-100 px-2 py-0.5 text-center text-[11px] font-bold text-ink dark:bg-slate-700">Tot</th>
              {STAT_COLS.map((k) => (
                <th key={`l30-${k}`} className="border border-slate-300 px-2 py-0.5 text-center text-[11px] font-semibold text-muted">{k}</th>
              ))}
              <th className="border border-slate-300 bg-slate-100 px-2 py-0.5 text-center text-[11px] font-bold text-ink dark:bg-slate-700">Tot</th>
              {data.dateColumns.map((dk) => (
                <th key={dk} className={`border border-slate-300 px-1 py-0.5 text-center ${dk === todayKey ? 'bg-amber-100 dark:bg-amber-900/30' : ''}`}>
                  <DayHeader dateStr={dk} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.nis} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-2 py-1.5 text-center text-muted">{row.no}</td>
                <td className="px-2 py-1.5 font-semibold text-ink">{row.className}</td>
                <td className="sticky left-0 z-10 border-r-2 border-slate-300 bg-white px-2 py-1.5 font-medium text-ink dark:bg-slate-900 dark:border-slate-600" style={{ minWidth: 130 }}>{row.name}</td>
                {STAT_COLS.map((k) => (
                  <td key={`sem-${k}`} className="border border-slate-200 px-2 py-1.5 text-center font-semibold" style={{ color: LETTER_STYLE[k]?.color ?? '#374151' }}>
                    {row.semester[k] || ''}
                  </td>
                ))}
                <td className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-bold text-ink dark:bg-slate-800">{row.semester.total || ''}</td>
                {STAT_COLS.map((k) => (
                  <td key={`l30-${k}`} className="border border-slate-200 px-2 py-1.5 text-center font-semibold" style={{ color: LETTER_STYLE[k]?.color ?? '#374151' }}>
                    {row.last30Days[k] || ''}
                  </td>
                ))}
                <td className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-center font-bold text-ink dark:bg-slate-800">{row.last30Days.total || ''}</td>
                {data.dateColumns.map((dk) => {
                  const letter = row.daily[dk] ?? '';
                  const style = LETTER_STYLE[letter];
                  return (
                    <td
                      key={dk}
                      className={`border border-slate-200 px-1 py-1.5 text-center font-bold ${dk === todayKey ? 'ring-1 ring-amber-400' : ''}`}
                      style={style ? { backgroundColor: style.bg, color: style.color } : undefined}
                    >
                      {letter}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Signature area */}
      <div className="mt-6 flex justify-end gap-12 pr-8 text-xs text-muted">
        <div className="text-center">
          <p className="mb-8">Mengetahui,</p>
          <p className="font-semibold text-ink">_________________________</p>
          <p>Kepala Sekolah</p>
        </div>
        <div className="text-center">
          <p className="mb-8">{data.today}</p>
          <p className="font-semibold text-ink">_________________________</p>
          <p>Petugas Piket</p>
        </div>
      </div>
    </Card>
  );
}
