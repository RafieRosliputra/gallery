const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const number = new Intl.NumberFormat('en-MY');

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return number.format(value);
}

function dateOf(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatShortDate(value: string | Date | null | undefined): string {
  const date = dateOf(value);
  if (!date) return '';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatDayMonth(value: string | Date | null | undefined): string {
  const date = dateOf(value);
  if (!date) return '';
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function formatDayLabel(value: string | Date | null | undefined): string {
  const date = dateOf(value);
  if (!date) return '';
  return `${DAYS[date.getUTCDay()]}, ${formatShortDate(date)}`;
}

export function formatMonthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? ''} ${year}`;
}

export function formatCameraCount(count: number): string {
  return `${formatCount(count)} kamera`;
}

/** "22 Nov 2026 · 1,102 gambar · 2 kamera" (portal/album card meta). */
export function albumMeta(album: {
  takenAt: string | null;
  assetCount: number;
  cameras: string[];
}): string {
  const parts: string[] = [];
  if (album.takenAt) parts.push(formatShortDate(album.takenAt));
  parts.push(`${formatCount(album.assetCount)} gambar`);
  if (album.cameras.length > 1) parts.push(formatCameraCount(album.cameras.length));
  return parts.join(' · ');
}

export function formatBytes(bytes: number | null | undefined, fraction = 0): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(fraction)} ${units[unit]}`;
}

export function formatClock(value: string | Date | null | undefined): string {
  const date = dateOf(value);
  if (!date) return '';
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
