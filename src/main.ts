import './style.css';
import { Sfx } from './audio/sfx';
import type { ActivePiece } from './engine/board';
import { DANGER_HEAT, Game } from './engine/game';
import { attachTouch, Input, type Action } from './game/input';
import { Renderer } from './game/renderer';
import { ShakeNudge } from './game/shake';
import { TouchPad } from './game/touchpad';

const HS_KEY = 'tetris.highscore';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const overlayTitle = document.getElementById('overlay-title')!;
const overlayBody = document.getElementById('overlay-body')!;
const overlayHint = document.getElementById('overlay-hint')!;

const renderer = new Renderer(canvas);
const sfx = new Sfx();

let game = new Game();
let paused = false;
let started = false;
let highScore = Number(localStorage.getItem(HS_KEY) ?? 0);

function wire(g: Game): void {
  let colors = g.colorCount;
  let match = g.matchSize;
  let locked: ActivePiece | null = null;
  let groove = 0;
  // locks are judged against the music's beat clock
  g.beatClock = () => sfx.beatOffsetMs();
  g.on((e) => {
    switch (e.type) {
      case 'move':
        sfx.move();
        break;
      case 'rotate':
        if (e.tspin !== 'none') {
          sfx.tspin();
          renderer.onTSpin();
        } else sfx.rotate();
        break;
      case 'softdrop':
        sfx.softDrop();
        break;
      case 'harddrop':
        if (g.active) renderer.onHardDrop(g.active, e.distance);
        sfx.hardDrop();
        break;
      case 'hold':
        sfx.hold();
        break;
      case 'lock':
        locked = e.piece;
        renderer.onLock(e.piece);
        sfx.lock();
        break;
      case 'beat':
        renderer.onBeatLock(e.onBeat, e.groove, groove, locked);
        sfx.beatHit(e.onBeat, e.groove, groove);
        groove = e.groove;
        break;
      case 'tilt':
        renderer.onTilt(e.dir, e.nudge);
        if (e.nudge) sfx.nudge();
        else sfx.tilt();
        break;
      case 'tilted':
        renderer.onTilted();
        sfx.tilted();
        flashBadge('TILT');
        break;
      case 'clear': {
        const c = e.clear;
        renderer.onClear(c, g.level);
        const popped = c.pops.reduce((n, p) => n + p.cells.length, 0);
        if (popped > 0) sfx.pop(popped, c.chain);
        if (c.perfect) sfx.perfectClear();
        else if (c.chain >= 2) sfx.chain(c.chain);
        else if (c.count > 0) sfx.clear(c.count, c.tspin !== 'none' || c.b2b);
        else if (popped === 0) sfx.tspin();
        break;
      }
      case 'cascade':
        renderer.onCascade(e.maxDrop);
        sfx.cascade(e.maxDrop);
        break;
      case 'landed':
        renderer.onLanded(e.cells, e.chain);
        sfx.landed(e.chain);
        break;
      case 'garbage':
        renderer.onGarbage(e.rows);
        sfx.garbage(e.rows);
        break;
      case 'levelup': {
        renderer.onLevelUp(e.level);
        sfx.levelUp();
        sfx.setTempo(e.level);
        const news: string[] = [];
        if (g.colorCount > colors) news.push(`${g.colorCount} COLORS`);
        if (g.matchSize > match) news.push(`MATCH ${g.matchSize} NOW`);
        if (news.length) renderer.onRuleChange(news.join(' · '));
        colors = g.colorCount;
        match = g.matchSize;
        break;
      }
      case 'gameover':
        renderer.onGameOver();
        sfx.gameOver();
        onGameOver();
        break;
    }
  });
}

function showOverlay(title: string, body: string, hint: string): void {
  overlayTitle.textContent = title;
  overlayBody.innerHTML = body;
  overlayHint.textContent = hint;
  overlay.classList.remove('hidden');
}

function hideOverlay(): void {
  overlay.classList.add('hidden');
}

function overlayVisible(): boolean {
  return !overlay.classList.contains('hidden');
}

function newGame(): void {
  game = new Game();
  wire(game);
  input.setGame(game);
  paused = false;
  started = true;
  sfx.setTempo(1);
  sfx.startMusic();
  game.start();
  hideOverlay();
  input.setEnabled(true);
}

function onGameOver(): void {
  const over = game;
  input.setEnabled(false);
  const isRecord = game.score > highScore;
  if (isRecord) {
    highScore = game.score;
    localStorage.setItem(HS_KEY, String(highScore));
  }
  setTimeout(() => {
    if (game !== over) return; // a new game started meanwhile
    showOverlay(
      'GAME OVER',
      `<div class="stat-row"><span>Score</span><b>${game.score.toLocaleString()}</b></div>
       <div class="stat-row"><span>Lines</span><b>${game.lines}</b></div>
       <div class="stat-row"><span>Level</span><b>${game.level}</b></div>
       <div class="stat-row"><span>Blocks matched</span><b>${game.popped}</b></div>
       ${game.maxChain >= 2 ? `<div class="stat-row"><span>Max chain</span><b>${game.maxChain}</b></div>` : ''}
       ${game.bestGroove >= 2 ? `<div class="stat-row"><span>Best groove</span><b>${game.bestGroove}</b></div>` : ''}
       ${isRecord ? '<div class="record">★ NEW RECORD ★</div>' : `<div class="stat-row"><span>Best</span><b>${highScore.toLocaleString()}</b></div>`}`,
      touch ? 'Tap to play again' : 'Press R or tap to play again',
    );
  }, 900);
}

function togglePause(): void {
  if (!started || game.phase === 'over') return;
  paused = !paused;
  input.setEnabled(!paused);
}

const input = new Input(game, {
  onPause: togglePause,
  onRestart: () => newGame(),
  onMute: () => {
    sfx.toggleMute();
    flashBadge(sfx.muted ? 'SFX OFF' : 'SFX ON');
  },
  onMusic: () => {
    sfx.toggleMusic();
    flashBadge(sfx.musicOn ? 'MUSIC ON' : 'MUSIC OFF');
  },
  onAnyKey: () => {
    sfx.unlock();
    if (!started) newGame();
    else if (game.phase === 'over' && overlay.classList.contains('hidden') === false) {
      /* R handled above; other keys ignored on game over */
    }
  },
});
wire(game);
attachTouch(canvas, input, () => renderer.cellSize);

overlay.addEventListener('click', () => {
  sfx.unlock();
  if (overlayVisible()) newGame();
});
canvas.addEventListener(
  'touchstart',
  () => {
    sfx.unlock();
    if (overlayVisible()) newGame();
  },
  { passive: true },
);

// ------------------------------------------------------------- touch controls

const pad = new TouchPad((action: Action, down: boolean) => {
  sfx.unlock();
  if (down && overlayVisible()) {
    if (action !== 'pause') newGame();
    return;
  }
  if (down) input.press(action);
  else input.release(action);
});

let touch = false;

// Shove the phone to nudge. iOS asks for motion permission, which it only allows from a
// tap's touchend/click, so the first tap release asks.
const shake = new ShakeNudge((dir) => {
  if (!started || paused) return;
  if (game.nudge(dir)) navigator.vibrate?.(30);
});
let shakeAsked = false;
function askForShake(): void {
  if (shakeAsked || !touch || !ShakeNudge.supported()) return;
  shakeAsked = true;
  void shake.enable().then((on) => flashBadge(on ? 'SHAKE TO NUDGE' : 'SHAKE OFF · USE NUDGE'));
}
window.addEventListener('touchend', askForShake, { capture: true });
window.addEventListener('click', askForShake, { capture: true });

function layoutPad(): void {
  document.body.classList.toggle('portrait', window.innerWidth < window.innerHeight * 0.9);
  if (touch) renderer.setInsets(pad.insets());
}

function enableTouch(): void {
  if (touch) return;
  touch = true;
  document.body.classList.add('touch');
  renderer.touchMode = true;
  layoutPad();
  if (!started) showTitle();
}

window.addEventListener('resize', layoutPad);
window.addEventListener('touchstart', enableTouch, { passive: true, capture: true });
if (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')) enableTouch();
layoutPad();

const badge = document.getElementById('badge')!;
let badgeTimer = 0;
function flashBadge(text: string): void {
  badge.textContent = text;
  badge.classList.add('show');
  clearTimeout(badgeTimer);
  badgeTimer = window.setTimeout(() => badge.classList.remove('show'), 900);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && started && game.phase === 'falling' && !paused) togglePause();
});

function showTitle(): void {
  const best = highScore > 0 ? `<div class="stat-row"><span>Best</span><b>${highScore.toLocaleString()}</b></div>` : '';
  const nudgeHow = touch ? '<b>a shove of your phone</b>, left or right (or the NUDGE buttons)' : '<kbd>Q</kbd> / <kbd>E</kbd>';
  const rules = `<p class="tagline">NUDGE IT. DON'T TILT IT.</p>
    <p><b>Match colors:</b> touch 8+ blocks of one color and they explode. Lines clear too. Whatever falls into the gap can set off a <b>chain</b>, worth double each time.</p>
    <p><b>Nudge the machine</b> with ${nudgeHow}: the board swings 90° and everything slides to that wall. Nudge too hard and the meter hits <b>DANGER</b>, then <b>TILT</b>: dead controls and a garbage row. It also tilts on its own every 12 pieces, so watch the arrow.</p>
    <p><b>Drop on the beat</b> for a groove multiplier, up to ×3. <b>Gray garbage</b> rises from below and breaks when a match pops beside it. Higher levels bring a 5th color, then matches of 10.</p>`;
  if (touch) {
    showOverlay(
      'ON TILT',
      `${rules}
       <p class="touch">On the board: swipe to move · tap to rotate · flick down to drop · swipe up to hold</p>
       ${best}`,
      'Tap to start',
    );
    return;
  }
  showOverlay(
    'ON TILT',
    `${rules}
   <div class="keys">
     <span><kbd>←</kbd><kbd>→</kbd> move</span>
     <span><kbd>↑</kbd><kbd>X</kbd> rotate</span>
     <span><kbd>Z</kbd> ccw · <kbd>F</kbd> 180</span>
     <span><kbd>↓</kbd> soft drop</span>
     <span><kbd>SPACE</kbd> hard drop</span>
     <span><kbd>SHIFT</kbd><kbd>C</kbd> hold</span>
     <span><kbd>Q</kbd><kbd>E</kbd> nudge</span>
     <span><kbd>ESC</kbd> pause · <kbd>R</kbd> restart</span>
     <span><kbd>M</kbd> sfx · <kbd>N</kbd> music</span>
   </div>
   ${best}`,
    'Press any key to start',
  );
}
if (!touch) showTitle();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(50, now - last);
  last = now;
  if (started && !paused) {
    input.update(dt);
    game.tick(dt);
  }
  if (started && !paused && game.phase !== 'over') sfx.updateMusic();
  renderer.update(dt);
  renderer.draw(game, { paused, highScore, beat: started && !paused ? sfx.beatPhase() : -1 });
  pad.el.classList.toggle('danger', game.heat >= DANGER_HEAT);
  pad.el.classList.toggle('dead', game.tiltedFor > 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
