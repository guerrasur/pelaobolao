// A missing/unresolved serverTimestamp must never reset the clock to Unix epoch.
const validEpoch = value => typeof value === 'number' && Number.isFinite(value)
  && value >= Date.UTC(2000, 0, 1) && value < Date.UTC(2100, 0, 1);

export function clockSample(snapshot, start, end) {
  if (!snapshot.exists() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return null;
  const timestamp = snapshot.data()?.clockAt;
  if (typeof timestamp?.toMillis !== 'function') return null;
  const server = timestamp.toMillis();
  if (!validEpoch(server) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return { server, start, end, rtt: end - start };
}

// A monotonic local clock survives changes to the device's date/time while playing.
export function createServerClock(wall = Date.now, monotonic = () => performance.now()) {
  let anchor = wall(), anchorTick = monotonic();
  return {
    now: () => anchor + monotonic() - anchorTick,
    calibrate(serverMillis, start, end) {
      if (!validEpoch(serverMillis) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return false;
      anchor = serverMillis + (end - start) / 2;
      anchorTick = monotonic();
      return true;
    },
  };
}
