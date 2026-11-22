import { readSchedule, scheduleExpression, scheduleLabel, scheduleWeekDays, type ScheduleFrequency } from '../../nod/lib/schedules';

const frequencies = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

export function SchedulePicker({ cron, onChange }: { cron: string; onChange: (cron: string) => void }) {
  const cur = readSchedule(cron || '0 9 * * *');
  const set = (p: Partial<{ frequency: ScheduleFrequency; time: string; day: string }>) => {
    const n = { ...cur, ...p };
    try { onChange(scheduleExpression(n.frequency, n.time, n.day, cron)); } catch { /* keep */ }
  };
  const opts = cur.frequency === 'custom' ? [...frequencies, { value: 'custom', label: 'Custom schedule' }] : frequencies;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select className="text-input" value={cron ? cur.frequency : ''} onChange={(e) => set({ frequency: e.target.value as ScheduleFrequency, day: '1' })}>
          {!cron && <option value="">Run manually only</option>}
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {cron && cur.frequency === 'weekly' && (
          <select className="text-input" value={cur.day} onChange={(e) => set({ day: e.target.value })}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{scheduleWeekDays[d]}</option>)}
          </select>
        )}
        {cron && cur.frequency === 'monthly' && (
          <select className="text-input" value={cur.day} onChange={(e) => set({ day: e.target.value })}>
            {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        )}
        {cron && cur.frequency !== 'custom' && <input className="text-input" type="time" value={cur.time} onChange={(e) => set({ time: e.target.value })} />}
        {cron && <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => onChange('')}>Clear</button>}
      </div>
      {cron && <span className="muted" style={{ fontSize: 12 }}>{scheduleLabel(cron)}</span>}
    </div>
  );
}
