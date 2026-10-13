/**
 * Shake-to-nudge: turns phone motion into left/right nudges, like shoving a pinball cabinet.
 *
 * `ShakeDetector` is pure (feed it samples, it says when a shove happened) so it can be tested;
 * `ShakeNudge` wires it to the browser's devicemotion events and the iOS permission prompt.
 */

export type NudgeDir = 'left' | 'right';

export interface ShakeConfig {
  /** sideways acceleration (m/s², gravity removed) that counts as a shove */
  threshold: number;
  /** ms to ignore motion after a shove: the phone's rebound swings the other way */
  cooldown: number;
}

export const DEFAULT_SHAKE: ShakeConfig = { threshold: 13, cooldown: 700 };

/**
 * Sideways acceleration in screen terms (+ = toward the screen's right edge), from the
 * device-fixed axes and the screen orientation angle (0, 90, 180, 270).
 */
export function screenX(ax: number, ay: number, angle: number): number {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      return -ay;
    case 180:
      return -ax;
    case 270:
      return ay;
    default:
      return ax;
  }
}

export class ShakeDetector {
  private quietUntil = -Infinity;
  /** low-pass estimate of gravity, for devices that only report acceleration including gravity */
  private gravity: [number, number] | null = null;

  constructor(private config: ShakeConfig = DEFAULT_SHAKE) {}

  /**
   * Feed one motion sample. `linear` is acceleration without gravity when the device provides
   * it; otherwise pass `withGravity` and gravity is filtered out here. Returns the direction of
   * a shove, or null.
   */
  sample(
    t: number,
    angle: number,
    linear: { x: number | null; y: number | null } | null,
    withGravity?: { x: number | null; y: number | null } | null,
  ): NudgeDir | null {
    let ax: number;
    let ay: number;
    if (linear && linear.x !== null && linear.y !== null) {
      ax = linear.x;
      ay = linear.y;
    } else if (withGravity && withGravity.x !== null && withGravity.y !== null) {
      const g = this.gravity ?? [withGravity.x, withGravity.y];
      this.gravity = [g[0] * 0.85 + withGravity.x * 0.15, g[1] * 0.85 + withGravity.y * 0.15];
      ax = withGravity.x - this.gravity[0];
      ay = withGravity.y - this.gravity[1];
    } else {
      return null;
    }
    if (t < this.quietUntil) return null;
    const x = screenX(ax, ay, angle);
    if (Math.abs(x) < this.config.threshold) return null;
    this.quietUntil = t + this.config.cooldown;
    return x > 0 ? 'right' : 'left';
  }
}

type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Listens to devicemotion and calls `onNudge` for each shove. */
export class ShakeNudge {
  private detector = new ShakeDetector();
  private listening = false;

  constructor(private onNudge: (dir: NudgeDir) => void) {}

  /** True when this browser can report motion at all. */
  static supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  /**
   * Start listening. On iOS this shows the motion permission prompt, so it must be called
   * from a tap. Resolves to false if motion is unavailable or permission was refused.
   */
  async enable(): Promise<boolean> {
    if (this.listening) return true;
    if (!ShakeNudge.supported()) return false;
    const ask = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
    if (ask) {
      try {
        if ((await ask()) !== 'granted') return false;
      } catch {
        return false; // not called from a gesture, or not a secure context
      }
    }
    window.addEventListener('devicemotion', this.onMotion);
    this.listening = true;
    return true;
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    const dir = this.detector.sample(performance.now(), angle, e.acceleration, e.accelerationIncludingGravity);
    if (dir) this.onNudge(dir);
  };
}
