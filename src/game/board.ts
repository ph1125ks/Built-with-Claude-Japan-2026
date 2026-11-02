// 盤面の描画（Phaser）。エンジンの状態を読んで描くだけで、ゲームのルールは持たない。
// 操作（カードとレーンの選択）は DOM（hud.ts）で受ける。座標は 1280×720 を基準にし、カメラの拡大で高解像度に描く。
import Phaser from "phaser";
import { susceptibility, type Bacterium, type GameEvent } from "../engine/index.ts";
import { bugExtent, drawBug } from "./bugs.ts";
import type { PlaySession } from "./session.ts";

export const W = 1280;
export const H = 720;
export const LAYOUT = {
  hudH: 52,
  zoneTop: 52,
  zoneH: 24,
  laneTop: 78,
  laneH: 140,
  /** レーンの下の知らせの帯（盤面に重ならないように） */
  msgTop: 500,
  msgH: 22,
  /** 膀胱の壁（距離 0） */
  x0: 150,
  /** 尿道側の入口（距離 = レーンの長さ） */
  x1: 1246,
  cardsTop: 524,
} as const;

export const laneTopY = (lane: number) => LAYOUT.laneTop + lane * LAYOUT.laneH;
const bugY = (lane: number) => laneTopY(lane) + 86;
const unitY = (lane: number) => laneTopY(lane) + 26;
const unitX = (slot: number) => LAYOUT.x0 + 52 + slot * 80;

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

interface BugView {
  uid: number;
  c: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  hp: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  /** 近い位置での札：獲得耐性（赤）と、自然耐性・効かない扱い（紫）。菌の右に出す */
  tagA: Phaser.GameObjects.Text;
  tagB: Phaser.GameObjects.Text;
  /** 札を出したいか（重なるときは declutter が隠す） */
  want: { name: boolean; a: boolean; b: boolean };
  /** 菌の絵の幅 */
  w: number;
  level: string;
  jitter: number;
  phase: number;
  dying: boolean;
  last: { x: number; y: number };
}

interface UnitView {
  uid: number;
  c: Phaser.GameObjects.Container;
  bar: Phaser.GameObjects.Graphics;
  slot: number;
  lane: number;
  fireIn: number;
  color: number;
}

const hex = (s: string) => Number.parseInt(s.replace("#", ""), 16);

export class BoardScene extends Phaser.Scene {
  private R = 1;
  private session: PlaySession | null = null;
  private unsubscribe: (() => void) | null = null;
  private bugs = new Map<number, BugView>();
  private units = new Map<number, UnitView>();
  private bladder!: Phaser.GameObjects.Graphics;
  private bladderShake = 0;
  private lastBladderFrac = -1;
  private fx!: Phaser.GameObjects.Layer;

  constructor() {
    super("board");
  }

  init(data: { R: number }): void {
    this.R = data.R;
  }

  create(): void {
    const cam = this.cameras.main;
    cam.setOrigin(0, 0);
    cam.setZoom(this.R);
    cam.setBackgroundColor("#f5edf1");
    this.drawStatic();
    this.bladder = this.add.graphics();
    this.drawBladder(1);
    this.fx = this.add.layer();
    this.fx.setDepth(50);
    this.game.events.emit("board-ready", this);
  }

  text(x: number, y: number, s: string, size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
    return this.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color, resolution: this.R * 1.25, ...extra });
  }

  /** 遊ぶステージを差し替える（null で空の盤面） */
  setSession(session: PlaySession | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const v of this.bugs.values()) v.c.destroy();
    for (const v of this.units.values()) v.c.destroy();
    this.bugs.clear();
    this.units.clear();
    this.fx.removeAll(true);
    this.session = session;
    this.lastBladderFrac = -1;
    if (session) this.unsubscribe = session.onEvents((events) => this.handle(events));
    this.drawBladder(1);
  }

  private drawStatic(): void {
    const g = this.add.graphics();
    const { laneTop, laneH, x0, x1 } = LAYOUT;
    for (let i = 0; i < 3; i++) {
      const y = laneTopY(i);
      g.fillStyle(i % 2 === 0 ? 0xfbf5f8 : 0xf6ebf0, 1);
      g.fillRect(x0, y, W - x0, laneH);
      g.lineStyle(1, 0xe6d3dc, 1);
      g.lineBetween(x0, y, W, y);
    }
    g.lineBetween(x0, laneTop + 3 * laneH, W, laneTop + 3 * laneH);
    // 情報が明らかになる境目（距離の 1/3 と 2/3）
    g.lineStyle(1.5, 0xc9b3c0, 0.9);
    for (const f of [1 / 3, 2 / 3]) {
      const x = x0 + (x1 - x0) * f;
      for (let y = laneTop; y < laneTop + 3 * laneH; y += 12) g.lineBetween(x, y, x, y + 6);
    }
    // 尿道側の入口
    g.fillStyle(0xead7e0, 1);
    g.fillRect(x1 + 14, laneTop, W - x1 - 14, 3 * laneH);
    for (let i = 0; i < 3; i++) this.text(W - 14, laneTopY(i) + laneH / 2, `レーン${i + 1}`, 12, "#8a6b7b").setOrigin(0.5).setAngle(90);
  }

  private drawBladder(frac: number): void {
    if (Math.abs(frac - this.lastBladderFrac) < 1e-4) return;
    this.lastBladderFrac = frac;
    const g = this.bladder;
    g.clear();
    const top = LAYOUT.laneTop + 4;
    const h = 3 * LAYOUT.laneH - 8;
    // 膀胱：耐久が減るほど赤くなる
    const healthy = Phaser.Display.Color.ValueToColor(0xfde68a);
    const hurt = Phaser.Display.Color.ValueToColor(0xf87171);
    const mix = Phaser.Display.Color.Interpolate.ColorWithColor(hurt, healthy, 100, Math.round(frac * 100));
    g.fillStyle(Phaser.Display.Color.GetColor(mix.r, mix.g, mix.b), 1);
    g.fillRoundedRect(8, top, LAYOUT.x0 - 16, h, 40);
    g.lineStyle(3, 0xd4a017, 1);
    g.strokeRoundedRect(8, top, LAYOUT.x0 - 16, h, 40);
    // 粘膜の壁
    g.lineStyle(4, 0xe8a0b4, 1);
    g.lineBetween(LAYOUT.x0 - 4, LAYOUT.laneTop, LAYOUT.x0 - 4, LAYOUT.laneTop + 3 * LAYOUT.laneH);
    if (!this.bladderLabel) {
      this.bladderLabel = this.text(LAYOUT.x0 / 2, LAYOUT.laneTop + (3 * LAYOUT.laneH) / 2, "膀胱", 22, "#7c4a03", { fontStyle: "bold" }).setOrigin(0.5);
      this.bladderLabel.setDepth(2);
    }
  }
  private bladderLabel?: Phaser.GameObjects.Text;

  // ---------- 毎フレーム ----------

  override update(_time: number, delta: number): void {
    const s = this.session;
    if (!s) return;
    s.advance(delta);
    this.syncBugs(s);
    this.syncUnits(s, delta);
    const frac = s.state.bladderHp / s.state.stage.bladderHp;
    this.drawBladder(frac);
    if (this.bladderShake > 0) {
      this.bladderShake = Math.max(0, this.bladderShake - delta);
      const k = this.bladderShake / 300;
      this.bladder.x = Math.sin(this.bladderShake / 18) * 6 * k;
    } else this.bladder.x = 0;
  }

  private px(x: number): number {
    const L = this.session?.state.data.rules.board.laneLength ?? 1000;
    return LAYOUT.x0 + (Math.max(0, x) / L) * (LAYOUT.x1 - LAYOUT.x0);
  }

  private syncBugs(s: PlaySession): void {
    const alive = new Set<number>();
    const t = this.time.now;
    for (const b of s.state.bacteria) {
      alive.add(b.uid);
      const v = this.bugs.get(b.uid) ?? this.createBug(b);
      const prev = s.prevX.get(b.uid) ?? b.x;
      const x = this.px(prev + (b.x - prev) * (s.paused ? 1 : s.alpha));
      const y = bugY(b.lane) + v.jitter + Math.sin(t / 260 + v.phase) * 2.5;
      v.c.setPosition(x, y);
      // 膀胱に近い菌の札を上に重ねる
      v.c.setDepth(10 + (1 - b.x / s.state.data.rules.board.laneLength));
      v.last = { x, y };
      if (v.level !== b.level) this.updateLevel(v, b, s);
      this.drawHp(v, b);
    }
    this.declutter(s);
    for (const [uid, v] of this.bugs) {
      if (!alive.has(uid) && !v.dying) {
        v.c.destroy();
        this.bugs.delete(uid);
      }
    }
  }

  /**
   * 同じレーンで札が重なるときは、膀胱に近い菌の札だけを出す。遠い菌の札は、手前の菌が片付くか離れると出る
   * （試遊の指摘：菌名と耐性の札が重なって読めない）
   */
  private declutter(s: PlaySession): void {
    const byLane = new Map<number, BugView[]>();
    for (const b of s.state.bacteria) {
      const v = this.bugs.get(b.uid);
      if (!v || v.dying || !(v.want.name || v.want.a || v.want.b)) continue;
      const list = byLane.get(b.lane);
      if (list) list.push(v);
      else byLane.set(b.lane, [v]);
    }
    for (const list of byLane.values()) {
      list.sort((p, q) => p.last.x - q.last.x);
      let right = -Infinity;
      for (const v of list) {
        const half = v.w / 2;
        const nameHalf = v.want.name ? v.name.width / 2 : 0;
        const show = v.last.x - Math.max(half, nameHalf) > right + 4;
        v.name.setVisible(show && v.want.name);
        v.tagA.setVisible(show && v.want.a);
        v.tagB.setVisible(show && v.want.b);
        if (!show) continue;
        const tagW = Math.max(v.want.a ? v.tagA.width : 0, v.want.b ? v.tagB.width : 0);
        right = v.last.x + Math.max(half, nameHalf, tagW > 0 ? half + 8 + tagW : 0);
      }
    }
  }

  private createBug(b: Bacterium): BugView {
    const def = this.session!.state.data.bacteriumById.get(b.species)!;
    const c = this.add.container(this.px(b.x), bugY(b.lane));
    c.setDepth(10);
    const body = this.add.graphics();
    drawBug(body, def, false);
    const hp = this.add.graphics();
    const { h } = bugExtent(def);
    const name = this.text(0, -h / 2 - 10, "", 13, "#3b0a24", { fontStyle: "bold", backgroundColor: "rgba(255,255,255,0.82)", padding: { x: 4, y: 1 } }).setOrigin(0.5, 1);
    const { w } = bugExtent(def);
    const tagStyle = { fontStyle: "bold", backgroundColor: "#ffffff", padding: { x: 4, y: 1 } };
    const tagA = this.text(w / 2 + 8, 0, "", 12, "#b91c1c", tagStyle).setOrigin(0, 0.5);
    const tagB = this.text(w / 2 + 8, 0, "", 12, "#5b21b6", tagStyle).setOrigin(0, 0.5);
    name.setVisible(false);
    tagA.setVisible(false);
    tagB.setVisible(false);
    c.add([body, hp, name, tagA, tagB]);
    const v: BugView = { uid: b.uid, c, body, hp, name, tagA, tagB, want: { name: false, a: false, b: false }, w, level: "gram", jitter: ((b.uid * 37) % 29) - 14, phase: b.uid, dying: false, last: { x: c.x, y: c.y } };
    this.bugs.set(b.uid, v);
    if (b.level !== "gram") this.updateLevel(v, b, this.session!);
    return v;
  }

  private updateLevel(v: BugView, b: Bacterium, s: PlaySession): void {
    const data = s.state.data;
    const def = data.bacteriumById.get(b.species)!;
    v.level = b.level;
    if (b.level === "species" || b.level === "susceptibility") {
      drawBug(v.body, def, true);
      v.name.setText(def.name).setVisible(true);
      v.want.name = true;
    }
    if (b.level === "susceptibility") {
      const hand = s.state.stage.hand.map((h) => h.drug);
      const ng = hand.filter((d) => b.resistant.has(d));
      const abbr = (d: string) => data.drugById.get(d)?.abbr ?? d;
      const kind = (d: string) => susceptibility(data, s.state.region, b.species, d).basis;
      const acquired = ng.filter((d) => kind(d) !== "intrinsic" && kind(d) !== "fixed");
      const intrinsic = ng.filter((d) => kind(d) === "intrinsic");
      const fixed = ng.filter((d) => kind(d) === "fixed");
      // 1行に4つまで。残りは「ほかN」
      const list = (ds: string[]) => (ds.length > 4 ? `${ds.slice(0, 4).map(abbr).join(" ")} ほか${ds.length - 4}` : ds.map(abbr).join(" "));
      let a = "";
      let bText = "";
      if (ng.length === hand.length) {
        v.tagA.setColor("#ffffff").setBackgroundColor("#b91c1c");
        a = "手札すべて効かない";
      } else if (ng.length === 0) {
        v.tagA.setColor("#166534").setBackgroundColor("#ffffff");
        a = "手札すべて効く";
      } else {
        v.tagA.setColor("#b91c1c").setBackgroundColor("#ffffff");
        if (acquired.length) a = `耐性：${list(acquired)}`;
        // 自然耐性と「効かない扱い」は紫の行にまとめる（「効かない扱い」は遊び方と結果の表で説明する）
        const parts: string[] = [];
        if (intrinsic.length) parts.push(`自然耐性：${list(intrinsic)}`);
        if (fixed.length) parts.push(`効かない扱い：${list(fixed)}`);
        bText = parts.join("／");
      }
      v.tagA.setText(a).setVisible(a !== "");
      v.tagB.setText(bText).setVisible(bText !== "");
      v.want.a = a !== "";
      v.want.b = bText !== "";
      // 2行のときは上下に並べる
      const two = a !== "" && bText !== "";
      v.tagA.setY(two ? -10 : 0);
      v.tagB.setY(two ? 10 : 0);
    }
    this.tweens.add({ targets: v.c, scale: { from: 1.25, to: 1 }, duration: 220, ease: "Back.Out" });
  }

  private drawHp(v: BugView, b: Bacterium): void {
    const g = v.hp;
    g.clear();
    if (b.hp >= b.maxHp) return;
    const w = 30;
    const def = this.session!.state.data.bacteriumById.get(b.species)!;
    const y = bugExtent(def).h / 2 + 3;
    g.fillStyle(0x000000, 0.18);
    g.fillRect(-w / 2, y, w, 3);
    g.fillStyle(0x16a34a, 1);
    g.fillRect(-w / 2, y, (w * Math.max(0, b.hp)) / b.maxHp, 3);
  }

  private syncUnits(s: PlaySession, delta: number): void {
    const data = s.state.data;
    const alive = new Set<number>();
    const full = data.rules.units.fullHp;
    for (const u of s.state.units) {
      alive.add(u.uid);
      let v = this.units.get(u.uid);
      if (!v) v = this.createUnit(u.uid, u.drug, u.lane);
      const f = Math.max(0, u.hp / full);
      const bar = v.bar;
      bar.clear();
      bar.fillStyle(0x000000, 0.15);
      bar.fillRoundedRect(-32, 14, 64, 6, 3);
      bar.fillStyle(v.color, 1);
      bar.fillRoundedRect(-32, 14, Math.max(2, 64 * f), 6, 3);
      v.c.setAlpha(0.55 + 0.45 * Math.min(1, f * 3));
      // 弾（見た目だけ。効き目はエンジンが毎ティック計算している）
      if (!s.paused) {
        v.fireIn -= delta * s.speed;
        if (v.fireIn <= 0) {
          v.fireIn = 420 + Math.random() * 160;
          this.fire(v, u.drug, s);
        }
      }
    }
    for (const [uid, v] of this.units) {
      if (!alive.has(uid)) {
        this.tweens.add({ targets: v.c, alpha: 0, scale: 0.6, duration: 260, onComplete: () => v.c.destroy() });
        this.units.delete(uid);
      }
    }
  }

  private createUnit(uid: number, drugId: string, lane: number): UnitView {
    const data = this.session!.state.data;
    const drug = data.drugById.get(drugId)!;
    const color = hex(data.classById.get(drug.class)?.color ?? "#64748b");
    const used = new Set([...this.units.values()].filter((u) => u.lane === lane).map((u) => u.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const c = this.add.container(unitX(slot), unitY(lane));
    c.setDepth(20);
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(-34, -16, 68, 30, 9);
    g.lineStyle(2.5, color, 1);
    g.strokeRoundedRect(-34, -16, 68, 30, 9);
    g.fillStyle(color, 1);
    g.fillRoundedRect(-34, -16, 10, 30, { tl: 9, bl: 9, tr: 0, br: 0 });
    const label = this.text(5, -1, drug.abbr, drug.abbr.length > 5 ? 11 : 14, "#1f2937", { fontStyle: "bold" }).setOrigin(0.5);
    const bar = this.add.graphics();
    c.add([g, label, bar]);
    c.setScale(0.4);
    this.tweens.add({ targets: c, scale: 1, duration: 260, ease: "Back.Out" });
    const v: UnitView = { uid, c, bar, slot, lane, fireIn: 120, color };
    this.units.set(uid, v);
    return v;
  }

  private fire(v: UnitView, drugId: string, s: PlaySession): void {
    // 同じレーンで、まだ倒れていない菌のうち膀胱に近いものを狙う
    const target = s.state.bacteria.filter((b) => b.lane === v.lane && b.hp > 0).sort((a, b) => a.x - b.x)[0];
    if (!target) return;
    const tv = this.bugs.get(target.uid);
    if (!tv) return;
    const resisted = target.resistant.has(drugId);
    const dot = this.add.circle(v.c.x + 30, v.c.y + 4, 4, v.color, 1);
    dot.setStrokeStyle(1.2, 0xffffff, 1);
    this.fx.add(dot);
    const tx = tv.last.x;
    const ty = tv.last.y;
    this.tweens.add({
      targets: dot,
      x: tx - 10,
      y: ty,
      duration: 160 + Math.abs(tx - dot.x) * 0.22,
      ease: "Sine.In",
      onComplete: () => {
        if (resisted) {
          // はじかれる
          this.tweens.add({ targets: dot, x: dot.x - 26, y: dot.y - 26 - Math.random() * 20, alpha: 0, duration: 300, ease: "Quad.Out", onComplete: () => dot.destroy() });
        } else {
          this.tweens.add({ targets: dot, scale: 2.4, alpha: 0, duration: 160, onComplete: () => dot.destroy() });
        }
      },
    });
  }

  // ---------- イベント ----------

  private handle(events: GameEvent[]): void {
    const s = this.session;
    if (!s) return;
    const data = s.state.data;
    for (const e of events) {
      switch (e.type) {
        case "resisted": {
          const v = this.bugs.get(e.uid);
          if (!v) break;
          const abbr = data.drugById.get(e.drug)?.abbr ?? e.drug;
          const sp = s.state.bacteria.find((b) => b.uid === e.uid)?.species;
          const fixed = sp !== undefined && susceptibility(data, s.state.region, sp, e.drug).basis === "fixed";
          const label = e.intrinsic ? `自然耐性（${abbr}）` : fixed ? `効かない扱い（${abbr}）` : `耐性（${abbr}）`;
          this.float(v.last.x, v.last.y - 26, label, e.intrinsic || fixed ? "#5b21b6" : "#b91c1c");
          break;
        }
        case "killed": {
          const v = this.bugs.get(e.uid);
          if (!v) break;
          v.dying = true;
          v.name.setVisible(false);
          v.tagA.setVisible(false);
          v.tagB.setVisible(false);
          this.tweens.add({ targets: v.c, scale: 0.2, alpha: 0, angle: 40, duration: 320, ease: "Quad.In", onComplete: () => this.dropBug(e.uid) });
          break;
        }
        case "leaked": {
          const v = this.bugs.get(e.uid);
          if (v) {
            v.dying = true;
            this.tweens.add({ targets: v.c, x: LAYOUT.x0 - 30, alpha: 0, duration: 260, onComplete: () => this.dropBug(e.uid) });
          }
          this.bladderShake = 300;
          this.float(LAYOUT.x0 / 2, LAYOUT.laneTop + 60, `−${e.damage}`, "#b91c1c", 22);
          break;
        }
        case "summon": {
          const drug = data.drugById.get(e.drug);
          if (drug?.bioavailability != null) {
            this.float(unitX(2) + 110, unitY(e.lane), `内服：吸収率 ${Math.round(drug.bioavailability * 100)}% のぶん弱く出る`, "#0f766e", 13);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private dropBug(uid: number): void {
    const v = this.bugs.get(uid);
    if (!v) return;
    v.c.destroy();
    this.bugs.delete(uid);
  }

  float(x: number, y: number, s: string, color: string, size = 14): void {
    // 盤面の端で切れないように、内側に寄せる
    const t = this.text(0, y, s, size, color, { fontStyle: "bold", stroke: "#ffffff", strokeThickness: 4 }).setOrigin(0.5);
    const half = t.width / 2 + 6;
    t.setX(Math.min(W - 30 - half, Math.max(10 + half, x)));
    t.setDepth(60);
    this.tweens.add({ targets: t, y: y - 28, alpha: { from: 1, to: 0 }, duration: 1500, ease: "Quad.Out", onComplete: () => t.destroy() });
  }
}
