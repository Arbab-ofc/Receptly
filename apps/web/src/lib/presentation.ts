export const connectionStates: Record<string, { label: string; tone: string }> = {
  connected: { label: 'Connected', tone: 'connected' },
  connecting: { label: 'Connecting', tone: 'pending' },
  qr_required: { label: 'QR Required', tone: 'pending' },
  reconnecting: { label: 'Reconnecting', tone: 'pending' },
  disconnected: { label: 'Disconnected', tone: 'disconnected' },
  error: { label: 'Connection Error', tone: 'error' },
};
export function connectionPresentation(status?: string) {
  return status
    ? connectionStates[status] || connectionStates.error
    : { label: 'Checking connection', tone: 'pending' };
}
export function messageDay(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
export function messageDayLabel(timestamp: number, now = Date.now()) {
  if (messageDay(timestamp) === messageDay(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (messageDay(timestamp) === messageDay(yesterday.getTime())) return 'Yesterday';
  return new Date(timestamp).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
