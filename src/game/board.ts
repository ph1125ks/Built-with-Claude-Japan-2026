// 盤面の描画（Phaser）。エンジンの状態を読んで描くだけで、ゲームのルールは持たない。
// 操作（カードとレーンの選択）は DOM（hud.ts）で受ける。座標は 1280×720 を基準にし、カメラの拡大で高解像度に描く。
import Phaser from "phaser";
import { loadGameData, susceptibility, type Bacterium, type GameEvent } from "../engine/index.ts";
import { FRAMES, LEVELS, STYLE, bugFrame, bugScale, levelForAmount, soldierFrame, soldierPx, toCanvas, type Frame } from "./pixel/index.ts";
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
const unitY = (lane: number) => laneTopY(lane) + 36;
const unitX = (slot: number) => LAYOUT.x0 + 48 + slot * 84;
/** 兵士の中心・名札の中心の高さ（unitY から）。兵士の大きさは作風で決まる（pixel/） */
const SOLDIER_Y = -4;
/** 呼び出したときに薬の粒が流れ込む時間（ms） */
const STREAM_MS = 900;
/** 攻撃のコマ：振りかぶり → 振り抜き（ms） */
const ATK0_MS = 110;
const ATK1_MS = 280;
/** 名札は兵士の足元より下に（内服のカプセルの台が隠れないように。試遊の指摘） */
const PLATE_Y = 40;
const PLATE_W = 60;

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

interface BugView {
  uid: number;
  c: Phaser.GameObjects.Container;
  /** 菌のドット絵（2コマでくねる） */
  body: Phaser.GameObjects.Image;
  hp: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  /** 近い位置での札：獲得耐性（赤）と、自然耐性・効かない扱い（紫）。菌の右に出す */
  tagA: Phaser.GameObjects.Text;
  tagB: Phaser.GameObjects.Text;
  /** 札を出したいか（重なるときは declutter が隠す） */
  want: { name: boolean; a: boolean; b: boolean };
  /** 菌の絵の幅と高さ */
  w: number;
  h: number;
  species: string;
  /** べん毛のない絵（菌名が分かるまで。グラム染色ではべん毛は見えない） */
  bare: boolean;
  frame: number;
  level: string;
  jitter: number;
  phase: number;
  dying: boolean;
  last: { x: number; y: number };
}

interface UnitView {
  uid: number;
  /** 兵士の絵の入れ物（菌より下の層） */
  c: Phaser.GameObjects.Container;
  /** 名札の入れ物（菌の名前と耐性の札より上の層） */
  p: Phaser.GameObjects.Container;
  /** 兵士のドット絵（pixel/ の作風。コマと濃さごとのテクスチャを差し替える） */
  body: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  slot: number;
  lane: number;
  fireIn: number;
  color: number;
  drug: string;
  /** いま出しているテクスチャ */
  key: string;
  /** 最後に撃った時刻（攻撃のコマ） */
  atkAt: number;
  /** 呼び出した時刻と、出てきたときの体内の薬の量（粒が流れ込む間は、届いたぶんだけ濃くする） */
  bornAt: number;
  start: number;
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

  private unitKey(drug: string, frame: Frame, level: number): string {
    return `px:${STYLE.id}:${drug}:${frame}:${level}`;
  }

  private bugKey(species: string, frame: number, bare: boolean): string {
    return `bug:${STYLE.id}:${species}:${frame}:${bare ? "bare" : "full"}`;
  }

  /**
   * 兵士と細菌のドット絵を、カタログの全部についてテクスチャにする。
   * 兵士はコマ（待機2・攻撃2）× 濃さ（体内の薬の量、8段）。等倍で作り、拡大はぼかさない（NEAREST）
   */
  private makeTextures(): void {
    const data = loadGameData();
    const add = (key: string, c: HTMLCanvasElement) => {
      if (this.textures.exists(key)) return;
      this.textures.addCanvas(key, c)?.setFilter(Phaser.Textures.FilterMode.NEAREST);
    };
    for (const d of data.drugs)
      for (const f of FRAMES) for (let l = 1; l <= LEVELS; l++) add(this.unitKey(d.id, f, l), toCanvas(soldierFrame(data, d, f, l)));
    for (const def of data.bacteria) for (const fr of [0, 1]) for (const bare of [true, false]) add(this.bugKey(def.id, fr, bare), toCanvas(bugFrame(def, fr, bare)));
  }

  create(): void {
    this.makeTextures();
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
    for (const v of this.units.values()) {
      v.c.destroy();
      v.p.destroy();
    }
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
      // 2コマでくねる
      const fr = Math.floor(t / 260 + v.phase) % 2;
      if (fr !== v.frame) {
        v.frame = fr;
        v.body.setTexture(this.bugKey(v.species, fr, v.bare));
      }
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
    // 菌名が分かるまでは、べん毛のない絵（グラム染色ではべん毛は見えない。動きの速さは最初から見える）
    const body = this.add.image(0, 0, this.bugKey(def.id, 0, true)).setScale(bugScale());
    const hp = this.add.graphics();
    const w = body.displayWidth;
    const h = body.displayHeight;
    const name = this.text(0, -h / 2 - 10, "", 13, "#3b0a24", { fontStyle: "bold", backgroundColor: "rgba(255,255,255,0.82)", padding: { x: 4, y: 1 } }).setOrigin(0.5, 1);
    const tagStyle = { fontStyle: "bold", backgroundColor: "#ffffff", padding: { x: 4, y: 1 } };
    const tagA = this.text(w / 2 + 8, 0, "", 12, "#b91c1c", tagStyle).setOrigin(0, 0.5);
    const tagB = this.text(w / 2 + 8, 0, "", 12, "#5b21b6", tagStyle).setOrigin(0, 0.5);
    name.setVisible(false);
    tagA.setVisible(false);
    tagB.setVisible(false);
    c.add([body, hp, name, tagA, tagB]);
    const v: BugView = { uid: b.uid, c, body, hp, name, tagA, tagB, want: { name: false, a: false, b: false }, w, h, species: def.id, bare: true, frame: 0, level: "gram", jitter: ((b.uid * 37) % 29) - 14, phase: b.uid, dying: false, last: { x: c.x, y: c.y } };
    this.bugs.set(b.uid, v);
    if (b.level !== "gram") this.updateLevel(v, b, this.session!);
    return v;
  }

  private updateLevel(v: BugView, b: Bacterium, s: PlaySession): void {
    const data = s.state.data;
    const def = data.bacteriumById.get(b.species)!;
    v.level = b.level;
    if (b.level === "species" || b.level === "susceptibility") {
      v.bare = false;
      v.body.setTexture(this.bugKey(def.id, v.frame, false));
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
    const y = v.h / 2 + 3;
    g.fillStyle(0x000000, 0.18);
    g.fillRect(-w / 2, y, w, 3);
    g.fillStyle(0x16a34a, 1);
    g.fillRect(-w / 2, y, (w * Math.max(0, b.hp)) / b.maxHp, 3);
  }

  private syncUnits(s: PlaySession, delta: number): void {
    const data = s.state.data;
    const full = data.rules.units.fullHp;
    // 先に消えた兵士を片付ける（同じ描画のあいだに召喚された兵士が、空いた場所に入れるように）
    const alive = new Set(s.state.units.map((u) => u.uid));
    for (const [uid, v] of this.units) {
      if (!alive.has(uid)) {
        this.tweens.add({
          targets: [v.c, v.p],
          alpha: 0,
          scale: 0.6,
          duration: 260,
          onComplete: () => {
            v.c.destroy();
            v.p.destroy();
          },
        });
        this.units.delete(uid);
      }
    }
    const now = this.time.now;
    for (const u of s.state.units) {
      let v = this.units.get(u.uid);
      // 呼び出したばかりの兵士には、薬の粒が流れ込む演出を付ける
      if (!v) v = this.createUnit(u.uid, u.drug, u.lane, u.hp / full, s.state.tick - u.bornTick < 5);
      const f = Math.max(0, u.hp / full);
      // 体内の薬の量（名札の下の帯）
      const bar = v.bar;
      const bw = PLATE_W - 10;
      bar.clear();
      bar.fillStyle(0x000000, 0.13);
      bar.fillRoundedRect(-bw / 2, PLATE_Y + 3.5, bw, 4, 2);
      bar.fillStyle(v.color, 1);
      bar.fillRoundedRect(-bw / 2, PLATE_Y + 3.5, Math.max(2, bw * f), 4, 2);
      // 兵士の濃さ＝いま体内にある薬の量（点描）。吸収率の低い内服は、はじめの量が少ないので薄く出て、早く尽きる。粒が流れ込む間は、届いたぶんだけ濃くする
      const age = now - v.bornAt;
      const shown = age < STREAM_MS ? Math.min(f, v.start * Math.max(1 / LEVELS, Math.min(1, (age - 150) / (STREAM_MS - 250)))) : f;
      const level = levelForAmount(shown);
      const since = now - v.atkAt;
      const frame: Frame = since < ATK0_MS ? "attack0" : since < ATK1_MS ? "attack1" : Math.floor(now / 480 + v.uid * 0.37) % 2 ? "idle1" : "idle0";
      const key = this.unitKey(v.drug, frame, level);
      if (key !== v.key) {
        v.key = key;
        v.body.setTexture(key);
      }
      v.p.setAlpha(0.75 + 0.25 * Math.min(1, f * 3));
      // 弾（見た目だけ。効き目はエンジンが毎ティック計算している）
      if (!s.paused) {
        v.fireIn -= delta * s.speed;
        if (v.fireIn <= 0) {
          v.fireIn = 420 + Math.random() * 160;
          this.fire(v, u.drug, s);
        }
      }
    }
  }

  private createUnit(uid: number, drugId: string, lane: number, start: number, fresh: boolean): UnitView {
    const data = this.session!.state.data;
    const drug = data.drugById.get(drugId)!;
    const color = hex(data.classById.get(drug.class)?.color ?? "#64748b");
    const used = new Set([...this.units.values()].filter((u) => u.lane === lane).map((u) => u.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    // 兵士の絵は菌（深さ 10〜11）より下：膀胱の近くで、菌の名前と耐性の札を兵士の絵で隠さない。
    // 名札だけは菌の札より上：どの薬の兵士かが、菌が近づいても読める（試遊の指摘）
    const c = this.add.container(unitX(slot), unitY(lane));
    c.setDepth(8);
    const p = this.add.container(unitX(slot), unitY(lane));
    p.setDepth(30);
    const S = soldierPx();
    const key = this.unitKey(drugId, "idle0", fresh ? 1 : levelForAmount(start));
    const body = this.add.image(0, SOLDIER_Y, key).setDisplaySize(S, S);
    // 名札：略号と、下に体内の薬の量の帯
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.94);
    g.fillRoundedRect(-PLATE_W / 2, PLATE_Y - 9, PLATE_W, 19, 6);
    g.lineStyle(1.6, color, 1);
    g.strokeRoundedRect(-PLATE_W / 2, PLATE_Y - 9, PLATE_W, 19, 6);
    const label = this.text(0, PLATE_Y - 2.5, drug.abbr, drug.abbr.length > 5 ? 10.5 : 12, "#1f2937", { fontStyle: "bold" }).setOrigin(0.5);
    const bar = this.add.graphics();
    c.add(body);
    p.add([g, label, bar]);
    c.setScale(0.4);
    p.setScale(0.4);
    this.tweens.add({ targets: [c, p], scale: 1, duration: 260, ease: "Back.Out" });
    const now = this.time.now;
    const v: UnitView = { uid, c, p, body, bar, slot, lane, fireIn: 120, color, drug: drugId, key, atkAt: -1e9, bornAt: fresh ? now : now - STREAM_MS, start };
    this.units.set(uid, v);
    if (fresh) this.stream(unitX(slot), unitY(lane) + SOLDIER_Y, lane, start, color, drug.route === "po");
    return v;
  }

  /**
   * 呼び出したときの演出：薬の粒が20個、レーンの下から兵士に流れ込む（内服はカプセル、注射は丸い粒）。
   * 内服は、体に届かなかった粒（吸収率の残り）が途中で灰色になって落ちる（作者の判断：点描の濃さ＋この演出）。
   * 20個にしたのは、CFDN（吸収率25%）がちょうど5粒になるように（10個だと四捨五入で3粒＝30%になり、出典の 20〜25% から外れる。data-auditor の指摘）
   */
  private stream(x: number, y: number, lane: number, start: number, color: number, oral: boolean): void {
    const n = 20;
    const ok = Math.round(n * start);
    const bottom = laneTopY(lane) + LAYOUT.laneH - 6;
    for (let i = 0; i < n; i++) {
      const sx = x - 38 + i * 4;
      const g = this.add.container(sx, bottom);
      const a = oral ? this.add.rectangle(-2.5, 0, 5, 4, color).setStrokeStyle(1, 0x3b0a24, 0.7) : this.add.circle(0, 0, 3, color).setStrokeStyle(1, 0xffffff, 0.9);
      const b = oral ? this.add.rectangle(2.5, 0, 5, 4, 0xffffff).setStrokeStyle(1, 0x3b0a24, 0.7) : null;
      g.add(b ? [a, b] : [a]);
      g.setAlpha(0);
      this.fx.add(g);
      const delay = i * 20;
      if (i < ok) {
        this.tweens.add({ targets: g, alpha: 1, duration: 120, delay });
        this.tweens.add({ targets: g, x, y, duration: 520, delay: delay + 80, ease: "Quad.In", onComplete: () => g.destroy() });
      } else {
        // 体に届かなかった粒：途中で止まり、灰色になって落ちる
        this.tweens.add({ targets: g, alpha: 1, duration: 120, delay });
        this.tweens.add({
          targets: g,
          x: sx + (x - sx) * 0.4,
          y: bottom + (y - bottom) * 0.45,
          duration: 300,
          delay: delay + 80,
          ease: "Quad.Out",
          onComplete: () => {
            a.setFillStyle(0xb8aab2);
            b?.setFillStyle(0xddd3d8);
            this.tweens.add({ targets: g, y: bottom + 10, alpha: 0, delay: 180, duration: 800, ease: "Quad.In", onComplete: () => g.destroy() });
          },
        });
      }
    }
  }

  private fire(v: UnitView, drugId: string, s: PlaySession): void {
    // 同じレーンで、まだ倒れていない菌のうち膀胱に近いものを狙う
    const target = s.state.bacteria.filter((b) => b.lane === v.lane && b.hp > 0).sort((a, b) => a.x - b.x)[0];
    if (!target) return;
    const tv = this.bugs.get(target.uid);
    if (!tv) return;
    const resisted = target.resistant.has(drugId);
    // 攻撃のコマ（振りかぶり → 振り抜き）と、少し前に出る動き
    v.atkAt = this.time.now;
    this.tweens.add({ targets: v.body, x: 3, duration: 90, yoyo: true, ease: "Quad.Out" });
    const dot = this.add.circle(v.c.x + 24, v.c.y - 16, 4, v.color, 1);
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
            // 3つめの兵士の右に出す
            this.float(unitX(2) + 170, unitY(e.lane), `内服：体に届くのは ${Math.round(drug.bioavailability * 100)}%（吸収率）`, "#0f766e", 13);
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
