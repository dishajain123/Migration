export function RecordingIndicator({ seconds, interim }: { seconds: number; interim?: string }) {
  const mm = Math.floor(seconds / 60);
  const ss = (seconds % 60).toString().padStart(2, '0');
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-bad" role="status">
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-bad motion-reduce:animate-none" aria-hidden />
      <span className="shrink-0">Listening {mm}:{ss}</span>
      {interim && <span className="truncate text-muted">{interim}</span>}
    </div>
  );
}
