/** Data leggibile in italiano (gg/mm/aaaa) da ISO "YYYY-MM-DD" o timestamp ISO completo. */
export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
