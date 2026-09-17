// A monotonic local clock survives changes to the device's date/time while playing.
export function createServerClock(wall = Date.now, monotonic = () => performance.now()) {
  let anchor = wall(), anchorTick = monotonic();
  return {
    now: () => anchor + monotonic() - anchorTick,
    calibrate(serverMillis, start, end) {
      anchor = serverMillis + (end - start) / 2;
      anchorTick = monotonic();
    },
  };
}
