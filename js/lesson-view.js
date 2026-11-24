// Draws the lesson "ribbon": the song's notes sliding toward a now-line in the
// pitch zone. Landscape: pitch runs left-right, so notes fall from the top.
// Portrait: pitch runs up-down, so notes slide in from the right.

import { midiToAxis, axisToScreen } from './theremin-map.js';
import { clamp } from './pitch.js';

const TARGET_PX_PER_BEAT = 48;

/** Where the now-line sits and how beats map to pixels. */
export function ribbonGeometry(L) {
  const p = L.pitch, land = L.axis === 'x';
  const nowC = land ? p.y + p.h * 0.62 : p.x + 14;
  const farC = land ? p.y + 30 : p.x + p.w - 40;
  const dist = Math.abs(farC - nowC);
  const look = clamp(dist / TARGET_PX_PER_BEAT, 2.5, 4); // beats visible ahead
  return { land, nowC, farC, look, ppb: dist / look, dir: land ? -1 : 1 };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

/**
 * @param range   {low, high} the lesson's pitch range
 * @param song    from buildSong
 * @param view    from Lesson.view()
 * @param reading from ThereminState.step
 * @param hueFor  (midi, range) -> hue, shared with the rest of the theremin
 */
export function drawRibbon(ctx, L, range, song, view, reading, hueFor) {
  const g = ribbonGeometry(L), p = L.pitch, land = g.land;
  const cOf = (m) => axisToScreen(midiToAxis(m, range.low, range.high), L);
  const tOf = (beat) => g.nowC + g.dir * (beat - view.pos) * g.ppb;
  const thick = clamp(Math.abs(cOf(range.low + 1) - cOf(range.low)) * 0.85, 14, 30);

  ctx.save();

  // Progress through the song, along the top of the zone.
  const done = view.done ? 1 : view.index / view.total;
  const barY = land ? p.y + 22 : p.y + 1; // portrait: above the zone's labels
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(p.x + 12, barY, p.w - 24, 3);
  ctx.fillStyle = 'rgba(125,255,176,0.8)';
  ctx.fillRect(p.x + 12, barY, (p.w - 24) * done, 3);

  // Keep the ribbon inside the play area (clear of note labels and the toolbar).
  ctx.beginPath();
  if (land) ctx.rect(p.x, p.y + 28, p.w, p.h - 50);
  else ctx.rect(p.x - 56, p.y + 28, p.w + 56 - 34, p.h - 28);
  ctx.clip();

  // The lane of the note to find.
  if (view.target) {
    const c = cOf(view.target.midi), hue = hueFor(view.target.midi, range);
    ctx.fillStyle = `hsla(${hue}, 90%, 62%, ${view.onPitch ? 0.2 : 0.11})`;
    if (land) ctx.fillRect(c - thick / 2, p.y, thick, p.h); else ctx.fillRect(p.x, c - thick / 2, p.w, thick);
  }

  // Now-line.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (land) { ctx.moveTo(p.x + 6, g.nowC); ctx.lineTo(p.x + p.w - 6, g.nowC); }
  else { ctx.moveTo(g.nowC, p.y + 28); ctx.lineTo(g.nowC, p.y + p.h); }
  ctx.stroke();

  // Notes.
  ctx.font = '700 11px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < song.notes.length; i++) {
    const n = song.notes[i];
    if (n.start > view.pos + g.look + 1) break;
    if (n.start + n.beats < view.pos - 1.2) continue;
    const a = tOf(n.start), b = tOf(n.start + n.beats);
    const lo = Math.min(a, b) + 1.5, len = Math.max(4, Math.abs(b - a) - 3);
    const c = cOf(n.midi), hue = hueFor(n.midi, range);
    const current = !view.done && i === view.index && view.pos >= n.start - 1e-6;
    const past = i < view.index || view.done;
    let fill, text = 'rgba(8,10,18,0.85)';
    if (past) {
      fill = view.hit[i] ? 'rgba(125,255,176,0.38)' : 'rgba(255,255,255,0.12)';
      text = 'rgba(238,241,248,0.55)';
    } else if (current) fill = view.onPitch ? `hsl(${hue}, 100%, 74%)` : `hsla(${hue}, 90%, 64%, 0.78)`;
    else fill = `hsla(${hue}, 85%, 62%, 0.5)`;
    const [x, y, w, h] = land ? [c - thick / 2, lo, thick, len] : [lo, c - thick / 2, len, thick];
    roundRect(ctx, x, y, w, h, Math.min(8, w / 2, h / 2));
    ctx.fillStyle = fill;
    ctx.fill();
    if (current) { ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2; ctx.stroke(); }
    if (len >= 15) { ctx.fillStyle = text; ctx.fillText(n.name, x + w / 2, y + h / 2 + 0.5); }
  }

  // The player's pitch on the now-line, with an arrow toward the note to find.
  if (reading && reading.pitchPresent && reading.midi != null) {
    const c = cOf(reading.midi);
    const [x, y] = land ? [c, g.nowC] : [g.nowC, c];
    if (view.target && !view.onPitch && view.direction) {
      const tc = cOf(view.target.midi);
      const s = Math.sign(tc - c);
      const edge = tc - s * (thick / 2 + 2); // stop at the lane's edge
      if (Math.abs(edge - c) > 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        if (land) { ctx.moveTo(c + s * 12, y); ctx.lineTo(edge - s * 8, y); }
        else { ctx.moveTo(x, c + s * 12); ctx.lineTo(x, edge - s * 8); }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        if (land) { ctx.moveTo(edge, y); ctx.lineTo(edge - s * 11, y - 7); ctx.lineTo(edge - s * 11, y + 7); }
        else { ctx.moveTo(x, edge); ctx.lineTo(x - 7, edge - s * 11); ctx.lineTo(x + 7, edge - s * 11); }
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = view.onPitch ? '#7dffb0' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,10,18,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Count-in before a timed run.
  if (view.countIn) {
    ctx.font = '800 84px ui-rounded, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(String(view.countIn), p.x + p.w / 2, land ? p.y + p.h * 0.3 : p.y + p.h * 0.5);
  }
  ctx.restore();
}
