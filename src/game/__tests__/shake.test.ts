import { describe, expect, it } from 'vitest';
import { screenX, ShakeDetector } from '../shake';

const lin = (x: number, y = 0) => ({ x, y });

describe('screenX', () => {
  it('maps device axes to the screen for each orientation', () => {
    expect(screenX(5, 1, 0)).toBe(5);
    expect(screenX(5, 1, 90)).toBe(-1); // turned counterclockwise: the device's top points left
    expect(screenX(5, 1, 180)).toBe(-5);
    expect(screenX(5, 1, 270)).toBe(1);
    expect(screenX(5, 1, -90)).toBe(1);
  });
});

describe('ShakeDetector', () => {
  it('turns a sharp sideways shove into a nudge that way', () => {
    const d = new ShakeDetector({ threshold: 13, cooldown: 700 });
    expect(d.sample(0, 0, lin(18))).toBe('right');
    const e = new ShakeDetector({ threshold: 13, cooldown: 700 });
    expect(e.sample(0, 0, lin(-18))).toBe('left');
  });

  it('ignores ordinary handling and tapping', () => {
    const d = new ShakeDetector({ threshold: 13, cooldown: 700 });
    for (let t = 0; t < 1000; t += 16) expect(d.sample(t, 0, lin(Math.sin(t) * 6, 4))).toBeNull();
  });

  it('ignores up-and-down jolts', () => {
    const d = new ShakeDetector({ threshold: 13, cooldown: 700 });
    expect(d.sample(0, 0, lin(2, 25))).toBeNull();
  });

  it('ignores the rebound, then accepts the next shove', () => {
    const d = new ShakeDetector({ threshold: 13, cooldown: 700 });
    expect(d.sample(0, 0, lin(20))).toBe('right');
    expect(d.sample(80, 0, lin(-22))).toBeNull(); // the phone swinging back
    expect(d.sample(690, 0, lin(-20))).toBeNull();
    expect(d.sample(720, 0, lin(-20))).toBe('left');
  });

  it('uses the screen direction in landscape', () => {
    const d = new ShakeDetector({ threshold: 13, cooldown: 700 });
    // landscape at 90°: a shove toward the screen's right is along the device's -y axis
    expect(d.sample(0, 90, lin(0, -18))).toBe('right');
  });

  it('filters gravity out when the device only reports acceleration including gravity', () => {
    const d = new ShakeDetector({ threshold: 13, cooldown: 700 });
    // held tilted: a steady 9.8 m/s² of gravity partly along x never triggers
    for (let t = 0; t < 2000; t += 16) expect(d.sample(t, 0, null, { x: 6, y: 7.7 })).toBeNull();
    // then a shove to the left on top of it
    expect(d.sample(2016, 0, null, { x: 6 - 20, y: 7.7 })).toBe('left');
  });
});
