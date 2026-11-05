// 盤面の描画（Phaser）。エンジンの状態を読んで描くだけで、ゲームのルールは持たない。
// 操作（カードとレーンの選択）は DOM（hud.ts）で受ける。座標は 1280×720 を基準にし、カメラの拡大で高解像度に描く。
// 2026-11-04 作者の依頼「最近のインディーゲームらしく」：暗い盤面に、光る細菌と兵士。弾・当たり・倒れたときの粒、
// 膀胱のドット絵、波の知らせの帯、流れの粒などの演出を足した（効き目の計算はエンジンのまま。演出は見た目だけ）。
import Phaser from "phaser";
import { loadGameData, susceptibility, type Bacterium, type GameEvent } from "../engine/index.ts";
import { GRAM_COLORS } from "./bugs.ts";
import { FRAMES, LEVELS, STYLE, bugFrame, levelForAmount, soldierFrame, soldierPx, toCanvas, type Frame } from "./pixel/index.ts";
import { bladderSprite, floorTile, icon, membraneStrip, shotSprite, type ShotKind } from "./pixel/icons.ts";
import type { PlaySession } from "./session.ts";
import { lookOf } from "./soldiers.ts";
import { BODY_FONT, COLORS, PIXEL_FONT, hexNum } from "./theme.ts";

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

/** 分かることが増える境目（膀胱からの距離の割合）：[感受性が分かる, 菌名が分かる]。rules.json の board から */
export function zoneBounds(): [number, number] {
  const b = loadGameData().rules.board;
  return [b.revealSusceptibilityBelow, b.revealSpeciesBelow];
}
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
/** 膀胱のドット絵の大きさ（ドット）と拡大の倍率 */
const BLADDER = { w: 41, h: 138, z: 3, cx: 71, top: LAYOUT.laneTop + 3 } as const;
/** グラム染色の色の光（暗い盤面で見えるよう、絵の色より明るく） */
const GRAM_GLOW = { negative: 0xff6fa5, positive: 0xc4a3ff } as const;
/** 盤面の細菌の拡大の倍率（試遊の指摘：小さくて形と色が読み取りにくい。作風の 2 倍 → 3 倍） */
const BUG_Z = 3;
/** 札の文字（小さい字はドット絵のフォントだとにじむので、読みやすいゴシックの太字に。試遊の指摘） */
const TAG_FONT = { fontFamily: BODY_FONT, fontStyle: "bold" } as const;
/** 菌の名前と「効かない」の札の字の大きさ（2026-11-05 試遊の指摘：72歳の目では 12〜13px が読めない） */
const TAG_SIZE = 15;
/** 札をレーンの縁（粘膜の線）から離す余白 */
const TAG_MARGIN = 11;

interface BugView {
  uid: number;
  c: Phaser.GameObjects.Container;
  /** 菌のドット絵（2コマでくねる） */
  body: Phaser.GameObjects.Image;
  /** 菌のまわりの光（グラム染色の色） */
  glow: Phaser.GameObjects.Image;
  hp: Phaser.GameObjects.Graphics;
  name: Phaser.GameObjects.Text;
  /** 近い位置での札：効かない（獲得耐性。赤）と、もともと効かない（自然耐性）・効かない扱い（紫）。菌の右に出す */
  tagA: Phaser.GameObjects.Text;
  tagB: Phaser.GameObjects.Text;
  /** 札のまとまりの上端（菌の中心から）と高さ。レーンの縁に重ならないよう、毎フレームずらす */
  tagTop: number;
  tagH: number;
  /** 札を菌の左に出しているか（右に出すと盤面の右端で切れるとき） */
  tagLeft: boolean;
  /** 札を出したいか（重なるときは declutter が隠す） */
  want: { name: boolean; a: boolean; b: boolean };
  /** 菌の絵の幅と高さ */
  w: number;
  h: number;
  species: string;
  gram: "negative" | "positive";
  /** べん毛のない絵（菌名が分かるまで。グラム染色ではべん毛は見えない） */
  bare: boolean;
  frame: number;
  level: string;
  jitter: number;
  phase: number;
  dying: boolean;
  last: { x: number; y: number };
  /** 当たったときに白く光らせる終わりの時刻 */
  flashUntil: number;
  /** 弾かれたときの盾の印を出した時刻（出しすぎないように） */
  shieldAt: number;
  /** 当たったときに後ろへ押される量（見た目だけ） */
  knock: number;
}

interface UnitView {
  uid: number;
  /** 兵士の絵の入れ物（菌より下の層） */
  c: Phaser.GameObjects.Container;
  /** 名札の入れ物（菌の名前と耐性の札より上の層） */
  p: Phaser.GameObjects.Container;
  /** 兵士のドット絵（pixel/ の作風。コマと濃さごとのテクスチャを差し替える） */
  body: Phaser.GameObjects.Image;
  /** 足元の光の輪（系統の色） */
  aura: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  slot: number;
  lane: number;
  fireIn: number;
  color: number;
  drug: string;
  shot: ShotKind;
  /** いま出しているテクスチャ */
  key: string;
  /** 最後に撃った時刻（攻撃のコマ） */
  atkAt: number;
  /** 呼び出した時刻と、出てきたときの体内の薬の量（粒が流れ込む間は、届いたぶんだけ濃くする） */
  bornAt: number;
  start: number;
}

interface Speck {
  o: Phaser.GameObjects.Rectangle;
  vx: number;
  phase: number;
  baseY: number;
}

const hex = (s: string) => Number.parseInt(s.replace("#", ""), 16);

export class BoardScene extends Phaser.Scene {
  private R = 1;
  private session: PlaySession | null = null;
  private unsubscribe: (() => void) | null = null;
  private bugs = new Map<number, BugView>();
  private units = new Map<number, UnitView>();
  private bladder!: Phaser.GameObjects.Image;
  private bladderGlow!: Phaser.GameObjects.Image;
  private bladderFlash!: Phaser.GameObjects.Rectangle;
  private bladderShake = 0;
  private bladderStep = -1;
  private fx!: Phaser.GameObjects.Layer;
  /** 倒れたとき・当たったときの粒（1つの放出器を使い回す） */
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  /** 弾の尾 */
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;
  private floors: Phaser.GameObjects.TileSprite[] = [];
  private specks: Speck[] = [];
  private cells: { o: Phaser.GameObjects.Image; vx: number }[] = [];
  private zoneLines: Phaser.GameObjects.Graphics[] = [];
  /** 一時停止中の予約（半透明の兵士と「予約」の札） */
  private ghosts: Phaser.GameObjects.Container[] = [];
  private ghostKey = "";
  /** カードを選んでレーンにかざしたとき、兵士が立つ場所の見本 */
  private previewObj: Phaser.GameObjects.Container | null = null;
  private previewKey = "";
  /** 始まった波の数（波の知らせの帯を出すため） */
  private lastWave = 0;
  private bannerObj: Phaser.GameObjects.Container | null = null;
  private waveTag: Phaser.GameObjects.Container | null = null;
  private webgl = false;

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

  private addPixelTexture(key: string, c: HTMLCanvasElement): void {
    if (this.textures.exists(key)) return;
    this.textures.addCanvas(key, c)?.setFilter(Phaser.Textures.FilterMode.NEAREST);
  }

  /**
   * 兵士と細菌のドット絵を、カタログの全部についてテクスチャにする。
   * 兵士はコマ（待機2・攻撃2）× 濃さ（体内の薬の量、8段）。等倍で作り、拡大はぼかさない（NEAREST）
   */
  private makeTextures(): void {
    const data = loadGameData();
    const add = (key: string, c: HTMLCanvasElement) => this.addPixelTexture(key, c);
    for (const d of data.drugs)
      for (const f of FRAMES) for (let l = 1; l <= LEVELS; l++) add(this.unitKey(d.id, f, l), toCanvas(soldierFrame(data, d, f, l)));
    for (const def of data.bacteria) for (const fr of [0, 1]) for (const bare of [true, false]) add(this.bugKey(def.id, fr, bare), toCanvas(bugFrame(def, fr, bare)));
    // 光（なめらかなぼかし。ドット絵の上に重ねる）
    const glow = document.createElement("canvas");
    glow.width = glow.height = 64;
    const g = glow.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.3, "rgba(255,255,255,0.5)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    if (!this.textures.exists("glow")) this.textures.addCanvas("glow", glow);
    // 奥にぼんやり見える細胞（ピントの外れた丸。奥行きを出す）
    const cell = document.createElement("canvas");
    cell.width = cell.height = 64;
    const cg = cell.getContext("2d")!;
    const cgr = cg.createRadialGradient(32, 32, 0, 32, 32, 32);
    cgr.addColorStop(0, "rgba(255,255,255,0.18)");
    cgr.addColorStop(0.7, "rgba(255,255,255,0.32)");
    cgr.addColorStop(0.86, "rgba(255,255,255,0.6)");
    cgr.addColorStop(1, "rgba(255,255,255,0)");
    cg.fillStyle = cgr;
    cg.fillRect(0, 0, 64, 64);
    if (!this.textures.exists("cell")) this.textures.addCanvas("cell", cell);
    // 呼び出したときの光の柱
    const beam = document.createElement("canvas");
    beam.width = 32;
    beam.height = 128;
    const b = beam.getContext("2d")!;
    const hg = b.createLinearGradient(0, 0, 32, 0);
    hg.addColorStop(0, "rgba(255,255,255,0)");
    hg.addColorStop(0.5, "rgba(255,255,255,1)");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    b.fillStyle = hg;
    b.fillRect(0, 0, 32, 128);
    b.globalCompositeOperation = "destination-in";
    const vg = b.createLinearGradient(0, 0, 0, 128);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(0.5, "rgba(0,0,0,1)");
    vg.addColorStop(1, "rgba(0,0,0,0.6)");
    b.fillStyle = vg;
    b.fillRect(0, 0, 32, 128);
    if (!this.textures.exists("beam")) this.textures.addCanvas("beam", beam);
    // 粒（2×2 の白）
    const px = document.createElement("canvas");
    px.width = px.height = 2;
    const p = px.getContext("2d")!;
    p.fillStyle = "#fff";
    p.fillRect(0, 0, 2, 2);
    add("px", px);
    add("membrane", toCanvas(membraneStrip(48, 8)));
    add("floor0", toCanvas(floorTile(160, 70, 7)));
    add("floor1", toCanvas(floorTile(160, 70, 19)));
    add("ico:shield", toCanvas(icon("shield")));
  }

  create(): void {
    this.makeTextures();
    this.webgl = this.renderer.type === Phaser.WEBGL;
    const cam = this.cameras.main;
    cam.setOrigin(0, 0);
    cam.setZoom(this.R);
    cam.setBackgroundColor(COLORS.void);
    this.drawStatic();
    this.drawBladderParts();
    this.drawBladder(1);
    this.fx = this.add.layer();
    this.fx.setDepth(50);
    this.burst = this.add.particles(0, 0, "px", {
      lifespan: { min: 260, max: 620 },
      speed: { min: 50, max: 190 },
      scale: { start: 1.6, end: 0 },
      alpha: { start: 1, end: 0.2 },
      gravityY: 140,
      emitting: false,
    });
    this.burst.setDepth(55);
    this.trail = this.add.particles(0, 0, "px", {
      lifespan: 240,
      speed: { min: 0, max: 12 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 0.75, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.trail.setDepth(49);
    // 画面の四隅を少し暗く（WebGL のときだけ）
    if (this.webgl) cam.postFX.addVignette(0.5, 0.5, 0.92, 0.28);
    this.game.events.emit("board-ready", this);
  }

  text(x: number, y: number, s: string, size: number, color: string, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
    return this.add.text(x, y, s, { fontFamily: PIXEL_FONT, fontSize: `${size}px`, color, resolution: this.R * 1.25, ...extra });
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
    for (const g of this.ghosts) g.destroy();
    this.ghosts = [];
    this.ghostKey = "";
    this.preview(null, 0);
    this.bannerObj?.destroy();
    this.bannerObj = null;
    this.waveTag?.destroy();
    this.waveTag = null;
    this.lastWave = 0;
    this.session = session;
    this.bladderStep = -1;
    if (session) this.unsubscribe = session.onEvents((events) => this.handle(events));
    this.drawBladder(1);
  }

  // ---------- 動かない部分 ----------

  private drawStatic(): void {
    const { laneTop, laneH, x0, x1 } = LAYOUT;
    const bottom = laneTop + 3 * laneH;
    const g = this.add.graphics().setDepth(0);
    // レーンの床：上から下へ暗くなる
    for (let i = 0; i < 3; i++) {
      const y = laneTopY(i);
      const [t, b] = i % 2 === 0 ? [COLORS.laneTop, COLORS.laneBottom] : [COLORS.laneAltTop, COLORS.laneAltBottom];
      g.fillGradientStyle(t, t, b, b, 1);
      g.fillRect(x0, y, W - x0, laneH);
      // 流れの中の粒の模様（右へゆっくり流れる：尿は膀胱から尿道へ流れ、細菌はそれに逆らって上ってくる）
      const f = this.add.tileSprite(x0, y, W - x0, laneH, `floor${i % 2}`).setOrigin(0, 0).setTileScale(2).setAlpha(0.9).setDepth(0.5);
      this.floors.push(f);
    }
    // 分かることが増える3つの区間（遠い＝グラム染色、中ほど＝菌名、近い＝感受性）。色はゾーンの見出しのアイコンと同じ
    const zone = (x: number, w: number, color: number, a: number) => {
      const z = this.add.graphics().setDepth(0.6);
      z.fillGradientStyle(color, color, color, color, a, a, a * 0.35, a * 0.35);
      z.fillRect(x, laneTop, w, 3 * laneH);
    };
    // 境目は rules.json の値（感受性が分かる距離・菌名が分かる距離。膀胱からの割合）
    const [near, far] = zoneBounds();
    const L = x1 - x0;
    zone(x0, L * near, COLORS.zoneNear, 0.07);
    zone(x0 + L * near, L * (far - near), COLORS.zoneMid, 0.06);
    zone(x0 + L * far, L * (1 - far) + (W - x1), COLORS.zoneFar, 0.1);
    // 区間の境目：光る点線（ゆっくり明滅）
    for (const [f, color] of [
      [near, COLORS.zoneMid],
      [far, COLORS.zoneFar],
    ] as const) {
      const x = Math.round(x0 + (x1 - x0) * f);
      const line = this.add.graphics().setDepth(0.7);
      line.fillStyle(color, 0.12);
      line.fillRect(x - 3, laneTop, 6, 3 * laneH);
      line.fillStyle(color, 0.75);
      for (let y = laneTop; y < bottom; y += 10) line.fillRect(x - 1, y, 2, 5);
      this.zoneLines.push(line);
    }
    // 尿道側の入口（右の端）：暗い口
    const mouth = this.add.graphics().setDepth(0.8);
    mouth.fillGradientStyle(0x0b0812, 0x05030a, 0x0b0812, 0x05030a, 0.0, 1, 0.0, 1);
    mouth.fillRect(x1 - 30, laneTop, W - x1 + 30, 3 * laneH);
    for (let i = 0; i < 3; i++) this.text(W - 14, laneTopY(i) + laneH / 2, `レーン${i + 1}`, 12, COLORS.inkDim).setOrigin(0.5).setAngle(90).setDepth(3).setAlpha(0.85);
    // 粘膜の壁（レーンの境目のひだ）
    for (let k = 0; k <= 3; k++) {
      const y = laneTop + k * laneH;
      this.add.tileSprite(x0 - 6, y - 8, W - x0 + 6, 16, "membrane").setOrigin(0, 0).setTileScale(2).setDepth(2).setTilePosition(k * 13, 0);
    }
    // 奥の細胞（ゆっくり右へ流れる）
    for (let i = 0; i < 11; i++) {
      const r = 40 + Math.random() * 70;
      const o = this.add
        .image(x0 + Math.random() * (W - x0), laneTop + Math.random() * 3 * laneH, "cell")
        .setDisplaySize(r * 2, r * 2 * (0.8 + Math.random() * 0.3))
        .setTint(Math.random() < 0.5 ? 0x4a3a86 : 0x6a2f63)
        .setAlpha(0.22 + Math.random() * 0.12)
        .setDepth(0.55);
      this.cells.push({ o, vx: 1.5 + Math.random() * 3 });
    }
    // 漂う粒（流れの中のちり。見た目だけ）
    for (let i = 0; i < 46; i++) {
      const lane = i % 3;
      const y = laneTopY(lane) + 14 + Math.random() * (laneH - 28);
      const size = Math.random() < 0.18 ? 3 : 2;
      const o = this.add.rectangle(x0 + Math.random() * (W - x0), y, size, size, Math.random() < 0.5 ? 0x8a7ab8 : 0xc78bb0, 0.18 + Math.random() * 0.22).setDepth(1);
      this.specks.push({ o, vx: 6 + Math.random() * 14, phase: Math.random() * 6.28, baseY: y });
    }
  }

  private drawBladderParts(): void {
    const top = BLADDER.top;
    const hgt = BLADDER.h * BLADDER.z;
    // 膀胱の後ろの温かい光
    this.bladderGlow = this.add.image(BLADDER.cx, top + hgt / 2, "glow").setDisplaySize(260, 520).setTint(0xffb347).setAlpha(0.16).setDepth(1);
    if (this.webgl) this.bladderGlow.setBlendMode(Phaser.BlendModes.ADD);
    this.bladder = this.add.image(BLADDER.cx, top + hgt / 2, "px").setDepth(4);
    // 粘膜の壁（膀胱とレーンの境目）
    const wall = this.add.graphics().setDepth(3);
    wall.fillGradientStyle(0x8f2f5f, 0x2a0a1c, 0x8f2f5f, 0x2a0a1c, 0.9, 0, 0.9, 0);
    wall.fillRect(LAYOUT.x0 - 6, LAYOUT.laneTop, 26, 3 * LAYOUT.laneH);
    // 入ってこられたときの赤い光
    this.bladderFlash = this.add.rectangle(0, LAYOUT.laneTop, LAYOUT.x0 + 40, 3 * LAYOUT.laneH, 0xff2448, 0).setOrigin(0, 0).setDepth(6);
    if (this.webgl) this.bladderFlash.setBlendMode(Phaser.BlendModes.ADD);
    this.text(BLADDER.cx, top + hgt / 2 + 6, "膀胱", 24, "#3a1204", { stroke: "#fff1b0", strokeThickness: 4 }).setOrigin(0.5).setDepth(7);
  }

  private drawBladder(frac: number): void {
    const step = Math.round(Math.max(0, Math.min(1, frac)) * 20);
    if (step === this.bladderStep) return;
    this.bladderStep = step;
    const key = `bladder:${step}`;
    if (!this.textures.exists(key)) {
      const top = BLADDER.top;
      const hgt = BLADDER.h * BLADDER.z;
      const gates = [0, 1, 2].map((i) => (bugY(i) - top) / hgt);
      this.addPixelTexture(key, toCanvas(bladderSprite(BLADDER.w, BLADDER.h, step / 20, gates)));
    }
    this.bladder.setTexture(key).setScale(BLADDER.z);
    this.bladderGlow.setTint(Phaser.Display.Color.GetColor(255, Math.round(80 + 100 * (step / 20)), Math.round(70 * (step / 20))));
  }

  // ---------- 毎フレーム ----------

  override update(time: number, delta: number): void {
    // 流れと漂う粒（遊んでいないときも動かす）
    for (const f of this.floors) f.tilePositionX -= delta * 0.004;
    for (const c of this.cells) {
      c.o.x += (c.vx * delta) / 1000;
      if (c.o.x - c.o.displayWidth / 2 > W) c.o.x = LAYOUT.x0 - c.o.displayWidth / 2;
    }
    for (const s of this.specks) {
      s.o.x += (s.vx * delta) / 1000;
      if (s.o.x > W + 4) s.o.x = LAYOUT.x0 - 4;
      s.o.y = s.baseY + Math.sin(time / 900 + s.phase) * 4;
    }
    const pulse = 0.55 + 0.45 * Math.sin(time / 700);
    this.zoneLines.forEach((l, i) => l.setAlpha(0.65 + 0.35 * Math.sin(time / 600 + i * 1.7)));
    this.bladder.setScale(BLADDER.z, BLADDER.z * (1 + 0.006 * Math.sin(time / 520)));
    // 耐久が3割を切ったら、膀胱の光が赤く速く脈打つ
    const low = this.bladderStep >= 0 && this.bladderStep <= 8;
    this.bladderGlow.setAlpha(low ? 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(time / 160)) : 0.13 + 0.06 * pulse);
    if (this.bladderShake > 0) {
      this.bladderShake = Math.max(0, this.bladderShake - delta);
      const k = this.bladderShake / 300;
      this.bladder.x = BLADDER.cx + Math.sin(this.bladderShake / 18) * 6 * k;
    } else this.bladder.x = BLADDER.cx;

    const s = this.session;
    if (!s) return;
    s.advance(delta);
    this.syncBugs(s);
    this.syncUnits(s, delta);
    this.syncReservations(s);
    this.syncWaves(s);
    this.drawBladder(s.state.bladderHp / s.state.stage.bladderHp);
  }

  private px(x: number): number {
    const L = this.session?.state.data.rules.board.laneLength ?? 1000;
    return LAYOUT.x0 + (Math.max(0, x) / L) * (LAYOUT.x1 - LAYOUT.x0);
  }

  /** 新しい波が始まったら、盤面の上に知らせの帯を出す */
  private syncWaves(s: PlaySession): void {
    const st = s.state;
    const started = st.spawnIndex > 0 ? (st.spawnPlan[st.spawnIndex - 1]?.wave ?? 0) + 1 : 0;
    if (started <= this.lastWave) return;
    this.lastWave = started;
    const total = st.stage.waves.length;
    // 波の始まりは上の帯（HUD）が光って知らせる。盤面の札は最後の波だけ（試遊の指摘：札がレーン1の菌を隠す）
    this.events.emit("wave", started, total);
    if (started === total && total > 1) this.waveTagShow(`最後の波　${started} / ${total}`, true);
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
      v.knock *= 0.82;
      const x = this.px(prev + (b.x - prev) * (s.paused ? 1 : s.alpha)) + v.knock;
      const y = bugY(b.lane) + v.jitter + Math.sin(t / 260 + v.phase) * 2.5;
      v.c.setPosition(x, y);
      this.placeTags(v, b.lane, x, y);
      // 膀胱に近い菌の札を上に重ねる
      v.c.setDepth(10 + (1 - b.x / s.state.data.rules.board.laneLength));
      v.last = { x, y };
      // 当たったときの白い光
      if (v.body.isTinted && t > v.flashUntil && !v.dying) v.body.clearTint();
      v.glow.setAlpha((v.gram === "positive" ? 0.5 : 0.34) + 0.12 * Math.sin(t / 300 + v.phase));
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
   * 札をレーンの中に収める（粘膜の線に重ならないように上下にずらす）。菌の名前は、膀胱の壁より右に出す
   * （試遊の指摘：膀胱やレーンの線と重なって読めない）
   */
  private placeTags(v: BugView, lane: number, x: number, y: number): void {
    if (v.want.name) {
      const left = LAYOUT.x0 + 6 + v.name.width / 2;
      v.name.setX(Math.max(0, left - x));
    }
    if (!v.want.a && !v.want.b) return;
    // 右に出すと盤面の右端（レーンの番号）で切れるときは、菌の左に出す
    const tagW = Math.max(v.want.a ? v.tagA.width : 0, v.want.b ? v.tagB.width : 0);
    const left = x + v.w / 2 + 8 + tagW > W - 28;
    if (left !== v.tagLeft) {
      v.tagLeft = left;
      for (const t of [v.tagA, v.tagB]) t.setOrigin(left ? 1 : 0, 0.5).setX(left ? -v.w / 2 - 8 : v.w / 2 + 8);
    }
    const top = y + v.tagTop;
    const minTop = laneTopY(lane) + TAG_MARGIN;
    const maxBottom = laneTopY(lane) + LAYOUT.laneH - TAG_MARGIN;
    const dy = top < minTop ? minTop - top : top + v.tagH > maxBottom ? maxBottom - top - v.tagH : 0;
    const hA = v.want.a ? v.tagA.height : 0;
    v.tagA.setY(v.tagTop + dy + hA / 2);
    v.tagB.setY(v.tagTop + dy + (v.want.a ? hA + 3 : 0) + v.tagB.height / 2);
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
        const leftTagW = v.tagLeft ? Math.max(v.want.a ? v.tagA.width : 0, v.want.b ? v.tagB.width : 0) : 0;
        const show = v.last.x - Math.max(half, nameHalf, leftTagW > 0 ? half + 8 + leftTagW : 0) > right + 4;
        v.name.setVisible(show && v.want.name);
        v.tagA.setVisible(show && v.want.a);
        v.tagB.setVisible(show && v.want.b);
        if (!show) continue;
        const tagW = v.tagLeft ? 0 : Math.max(v.want.a ? v.tagA.width : 0, v.want.b ? v.tagB.width : 0);
        right = v.last.x + Math.max(half, nameHalf, tagW > 0 ? half + 8 + tagW : 0);
      }
    }
  }

  private createBug(b: Bacterium): BugView {
    const def = this.session!.state.data.bacteriumById.get(b.species)!;
    const c = this.add.container(this.px(b.x), bugY(b.lane));
    c.setDepth(10);
    // 菌名が分かるまでは、べん毛のない絵（グラム染色ではべん毛は見えない。動きの速さは最初から見える）
    const body = this.add.image(0, 0, this.bugKey(def.id, 0, true)).setScale(BUG_Z);
    const w = body.displayWidth;
    const h = body.displayHeight;
    const shadow = this.add.ellipse(2, h / 2 + 3, w * 0.85, 7, 0x000000, 0.45);
    const glow = this.add.image(0, 0, "glow").setDisplaySize(w * 2, h * 3.2).setTint(GRAM_GLOW[def.gram]).setAlpha(0.4);
    if (this.webgl) glow.setBlendMode(Phaser.BlendModes.ADD);
    const hp = this.add.graphics();
    const name = this.text(0, -h / 2 - 8, "", TAG_SIZE, "#ffffff", { ...TAG_FONT, backgroundColor: "rgba(16,10,26,0.9)", padding: { x: 6, y: 2 } }).setOrigin(0.5, 1);
    const tagStyle = { ...TAG_FONT, backgroundColor: "rgba(16,10,26,0.92)", padding: { x: 6, y: 2 }, lineSpacing: 2 };
    const tagA = this.text(w / 2 + 8, 0, "", TAG_SIZE, COLORS.bad, tagStyle).setOrigin(0, 0.5);
    const tagB = this.text(w / 2 + 8, 0, "", TAG_SIZE, COLORS.intrinsic, tagStyle).setOrigin(0, 0.5);
    name.setVisible(false);
    tagA.setVisible(false);
    tagB.setVisible(false);
    c.add([shadow, glow, body, hp, name, tagA, tagB]);
    // 尿道側の入口から現れる
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 360 });
    body.setScale(BUG_Z * 0.5);
    this.tweens.add({ targets: body, scale: BUG_Z, duration: 360, ease: "Back.Out" });
    const v: BugView = {
      uid: b.uid,
      c,
      body,
      glow,
      hp,
      name,
      tagA,
      tagB,
      want: { name: false, a: false, b: false },
      tagTop: 0,
      tagH: 0,
      tagLeft: false,
      w,
      h,
      species: def.id,
      gram: def.gram,
      bare: true,
      frame: 0,
      level: "gram",
      jitter: ((b.uid * 37) % 29) - 14,
      phase: b.uid,
      dying: false,
      last: { x: c.x, y: c.y },
      flashUntil: 0,
      shieldAt: -1e9,
      knock: 0,
    };
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
        v.tagA.setColor("#ffffff").setBackgroundColor("#c81e3a");
        a = "手札すべて効かない";
      } else if (ng.length === 0) {
        v.tagA.setColor(COLORS.good).setBackgroundColor("rgba(10,40,26,0.92)");
        a = "手札すべて効く";
      } else {
        v.tagA.setColor(COLORS.bad).setBackgroundColor("rgba(16,10,26,0.9)");
        // 2026-11-05 作者の判断（docs/PLAIN-LANGUAGE.md）：「耐性：」→「効かない：」、「自然耐性：」→「もともと効かない：」
        if (acquired.length) a = `効かない：${list(acquired)}`;
        // もともと効かない（自然耐性）と「効かない扱い」は紫の札に1行ずつ（「効かない扱い」は遊び方と結果の表で説明する）
        const parts: string[] = [];
        if (intrinsic.length) parts.push(`もともと効かない：${list(intrinsic)}`);
        if (fixed.length) parts.push(`効かない扱い：${list(fixed)}`);
        bText = parts.join("\n");
      }
      v.tagA.setText(a).setVisible(a !== "");
      v.tagB.setText(bText).setVisible(bText !== "");
      v.want.a = a !== "";
      v.want.b = bText !== "";
      // 上下に並べる（菌の中心にそろえ、レーンの縁に重なるときは placeTags がずらす）
      v.tagH = (v.want.a ? v.tagA.height : 0) + (v.want.a && v.want.b ? 3 : 0) + (v.want.b ? v.tagB.height : 0);
      v.tagTop = -v.tagH / 2;
      this.placeTags(v, b.lane, v.last.x, v.last.y);
    }
    // 分かったときの合図：輪が広がる
    const ring = this.add.circle(v.last.x, v.last.y, 10).setStrokeStyle(2, b.level === "susceptibility" ? hexNum(COLORS.gold) : COLORS.zoneMid, 0.9);
    this.fx.add(ring);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 420, ease: "Quad.Out", onComplete: () => ring.destroy() });
    this.tweens.add({ targets: v.c, scale: { from: 1.25, to: 1 }, duration: 220, ease: "Back.Out" });
  }

  private drawHp(v: BugView, b: Bacterium): void {
    const g = v.hp;
    g.clear();
    if (b.hp >= b.maxHp) return;
    const w = 32;
    const y = v.h / 2 + 4;
    const f = Math.max(0, b.hp) / b.maxHp;
    g.fillStyle(0x07040c, 0.85);
    g.fillRect(-w / 2 - 1, y - 1, w + 2, 6);
    g.fillStyle(f > 0.6 ? hexNum(COLORS.good) : f > 0.3 ? hexNum(COLORS.gold) : hexNum(COLORS.bad), 1);
    g.fillRect(-w / 2, y, Math.max(1, Math.round(w * f)), 4);
    g.fillStyle(0xffffff, 0.35);
    g.fillRect(-w / 2, y, Math.max(1, Math.round(w * f)), 1);
  }

  private syncUnits(s: PlaySession, delta: number): void {
    const data = s.state.data;
    const full = data.rules.units.fullHp;
    // 先に消えた兵士を片付ける（同じ描画のあいだに召喚された兵士が、空いた場所に入れるように）
    const alive = new Set(s.state.units.map((u) => u.uid));
    for (const [uid, v] of this.units) {
      if (!alive.has(uid)) {
        // 薬が切れた：光の粒になって消える
        this.burst.setParticleTint(v.color);
        this.burst.explode(10, v.c.x, v.c.y + SOLDIER_Y);
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
      bar.fillStyle(0x000000, 0.55);
      bar.fillRect(-bw / 2, PLATE_Y + 4, bw, 4);
      bar.fillStyle(v.color, 1);
      bar.fillRect(-bw / 2, PLATE_Y + 4, Math.max(1, Math.round(bw * f)), 4);
      bar.fillStyle(0xffffff, 0.4);
      bar.fillRect(-bw / 2, PLATE_Y + 4, Math.max(1, Math.round(bw * f)), 1);
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
      v.aura.setAlpha((0.22 + 0.1 * Math.sin(now / 400 + v.uid)) * Math.min(1, 0.3 + f));
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

  /**
   * 一時停止中の予約を、召喚される場所に半透明の兵士で出す（試遊の指摘：予約しても盤面に何も出なかった）。
   * 再開すると予約が召喚に変わり、ここは消える
   */
  private syncReservations(s: PlaySession): void {
    const list = s.paused ? s.pending : [];
    const key = list.map((p) => `${p.drug}@${p.lane}`).join(",");
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    for (const g of this.ghosts) g.destroy();
    this.ghosts = [];
    const used = new Map<number, Set<number>>();
    for (const u of this.units.values()) {
      const set = used.get(u.lane) ?? new Set<number>();
      set.add(u.slot);
      used.set(u.lane, set);
    }
    const S = soldierPx();
    for (const p of list) {
      const set = used.get(p.lane) ?? new Set<number>();
      let slot = 0;
      while (set.has(slot)) slot++;
      set.add(slot);
      used.set(p.lane, set);
      const c = this.add.container(unitX(slot), unitY(p.lane));
      c.setDepth(8);
      const body = this.add.image(0, SOLDIER_Y, this.unitKey(p.drug, "idle0", LEVELS)).setDisplaySize(S, S).setAlpha(0.45);
      const tag = this.text(0, PLATE_Y, "予約", 12, "#06231f", { ...TAG_FONT, backgroundColor: COLORS.teal, padding: { x: 6, y: 2 } }).setOrigin(0.5);
      c.add([body, tag]);
      this.tweens.add({ targets: body, alpha: { from: 0.25, to: 0.6 }, duration: 600, yoyo: true, repeat: -1 });
      this.ghosts.push(c);
    }
  }

  /** レーンで次に空いている場所（兵士と予約を数える） */
  nextSlot(lane: number): number {
    const used = new Set([...this.units.values()].filter((u) => u.lane === lane).map((u) => u.slot));
    const s = this.session;
    if (s?.paused) {
      let extra = s.pending.filter((p) => p.lane === lane).length;
      for (let slot = 0; extra > 0; slot++) {
        if (!used.has(slot)) {
          used.add(slot);
          extra--;
        }
      }
    }
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  /**
   * カードを選んでレーンにかざしたとき、兵士が立つ場所に半透明の見本を出す（drug が null なら消す）。
   * 試遊の指摘：札がレーンの右端に出て、どこに立つのか分からない
   */
  preview(drug: string | null, lane: number): void {
    const slot = drug ? this.nextSlot(lane) : -1;
    const key = drug ? `${drug}@${lane}#${slot}` : "";
    if (key === this.previewKey) return;
    this.previewKey = key;
    this.previewObj?.destroy();
    this.previewObj = null;
    if (!drug || slot >= (this.session?.state.data.rules.board.maxUnitsPerLane ?? 3)) return;
    const S = soldierPx();
    const c = this.add.container(unitX(slot), unitY(lane)).setDepth(9);
    const ring = this.add.ellipse(0, SOLDIER_Y + S / 2 - 3, 46, 12).setStrokeStyle(2, hexNum(COLORS.teal), 0.9);
    const body = this.add.image(0, SOLDIER_Y, this.unitKey(drug, "idle0", LEVELS)).setDisplaySize(S, S).setAlpha(0.5);
    c.add([ring, body]);
    this.tweens.add({ targets: body, alpha: { from: 0.3, to: 0.65 }, duration: 500, yoyo: true, repeat: -1 });
    this.tweens.add({ targets: ring, scale: { from: 0.9, to: 1.15 }, duration: 500, yoyo: true, repeat: -1 });
    this.previewObj = c;
  }

  private createUnit(uid: number, drugId: string, lane: number, start: number, fresh: boolean): UnitView {
    const data = this.session!.state.data;
    const drug = data.drugById.get(drugId)!;
    const color = hex(data.classById.get(drug.class)?.color ?? "#64748b");
    const look = lookOf(data, drug);
    const shot: ShotKind = look.body === "mech" ? "beam" : look.weapon === "bow" ? "arrow" : look.weapon === "hammer" ? "orb" : "slash";
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
    const shadow = this.add.ellipse(0, SOLDIER_Y + S / 2 - 3, 40, 9, 0x000000, 0.5);
    const aura = this.add.image(0, SOLDIER_Y + S / 2 - 4, "glow").setDisplaySize(70, 22).setTint(color).setAlpha(0.3);
    if (this.webgl) aura.setBlendMode(Phaser.BlendModes.ADD);
    const body = this.add.image(0, SOLDIER_Y, key).setDisplaySize(S, S);
    // 名札：略号と、下に体内の薬の量の帯
    const g = this.add.graphics();
    g.fillStyle(0x0f0a18, 0.94);
    g.fillRect(-PLATE_W / 2, PLATE_Y - 10, PLATE_W, 21);
    g.fillStyle(color, 1);
    g.fillRect(-PLATE_W / 2, PLATE_Y - 10, PLATE_W, 2);
    g.lineStyle(1, color, 0.8);
    g.strokeRect(-PLATE_W / 2 + 0.5, PLATE_Y - 9.5, PLATE_W - 1, 20);
    const label = this.text(0, PLATE_Y - 2.5, drug.abbr, drug.abbr.length > 5 ? 11 : 13, COLORS.ink, TAG_FONT).setOrigin(0.5);
    const bar = this.add.graphics();
    c.add([aura, shadow, body]);
    p.add([g, label, bar]);
    c.setScale(0.4);
    p.setScale(0.4);
    this.tweens.add({ targets: [c, p], scale: 1, duration: 260, ease: "Back.Out" });
    const now = this.time.now;
    const v: UnitView = { uid, c, p, body, aura, bar, slot, lane, fireIn: 120, color, drug: drugId, shot, key, atkAt: -1e9, bornAt: fresh ? now : now - STREAM_MS, start };
    this.units.set(uid, v);
    if (fresh) {
      this.summonFlash(unitX(slot), unitY(lane) + SOLDIER_Y, color);
      this.stream(unitX(slot), unitY(lane) + SOLDIER_Y, lane, start, color, drug.route === "po");
    }
    return v;
  }

  /** 呼び出したときの光の柱と輪 */
  private summonFlash(x: number, y: number, color: number): void {
    const beam = this.add.image(x, y - 10, "beam").setDisplaySize(46, 150).setTint(color).setAlpha(0.85);
    if (this.webgl) beam.setBlendMode(Phaser.BlendModes.ADD);
    this.fx.add(beam);
    this.tweens.add({ targets: beam, scaleX: 0, alpha: 0, duration: 520, ease: "Quad.In", onComplete: () => beam.destroy() });
    const ring = this.add.ellipse(x, y + 30, 30, 9).setStrokeStyle(2, color, 1);
    this.fx.add(ring);
    this.tweens.add({ targets: ring, scale: 2.6, alpha: 0, duration: 480, ease: "Quad.Out", onComplete: () => ring.destroy() });
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
      const a = oral ? this.add.rectangle(-2.5, 0, 5, 4, color).setStrokeStyle(1, 0x0b0712, 0.9) : this.add.circle(0, 0, 3, color).setStrokeStyle(1, 0xffffff, 0.9);
      const b = oral ? this.add.rectangle(2.5, 0, 5, 4, 0xffffff).setStrokeStyle(1, 0x0b0712, 0.9) : null;
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
            a.setFillStyle(0x6b6275);
            b?.setFillStyle(0x8f8698);
            this.tweens.add({ targets: g, y: bottom + 10, alpha: 0, delay: 180, duration: 800, ease: "Quad.In", onComplete: () => g.destroy() });
          },
        });
      }
    }
  }

  private shotKey(v: UnitView): string {
    const key = `shot:${v.drug}:${v.shot}`;
    if (!this.textures.exists(key)) {
      const color = `#${v.color.toString(16).padStart(6, "0")}`;
      this.addPixelTexture(key, toCanvas(shotSprite(v.shot, color)));
    }
    return key;
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
    const sx = v.c.x + 24;
    const sy = v.c.y - 14;
    const tx = tv.last.x - 8;
    const ty = tv.last.y;
    const angle = Math.atan2(ty - sy, tx - sx);
    const shot = this.add.container(sx, sy);
    const halo = this.add.image(0, 0, "glow").setDisplaySize(30, 30).setTint(v.color).setAlpha(0.7);
    if (this.webgl) halo.setBlendMode(Phaser.BlendModes.ADD);
    const img = this.add.image(0, 0, this.shotKey(v)).setScale(2).setRotation(angle);
    shot.add([halo, img]);
    this.fx.add(shot);
    if (v.shot === "orb") this.tweens.add({ targets: img, angle: 360, duration: 400, repeat: -1 });
    const speed = v.shot === "beam" ? 0.11 : v.shot === "arrow" ? 0.16 : 0.22;
    let n = 0;
    this.tweens.add({
      targets: shot,
      x: tx,
      y: ty,
      duration: 140 + Math.abs(tx - sx) * speed,
      ease: v.shot === "orb" ? "Quad.In" : "Sine.In",
      onUpdate: () => {
        if (n++ % 2) return;
        this.trail.setParticleTint(v.color);
        this.trail.emitParticleAt(shot.x, shot.y, 1);
      },
      onComplete: () => {
        if (resisted) {
          // はじかれる：灰色の火花と、盾の印
          this.burst.setParticleTint(0xc9c3d6);
          this.burst.explode(4, shot.x, shot.y);
          img.setTint(0x9a93a8);
          this.tweens.add({ targets: shot, x: shot.x - 26, y: shot.y - 26 - Math.random() * 20, alpha: 0, angle: -120, duration: 300, ease: "Quad.Out", onComplete: () => shot.destroy() });
          const now = this.time.now;
          if (!tv.dying && now - tv.shieldAt > 700) {
            tv.shieldAt = now;
            const ico = this.add.image(tv.last.x - tv.w / 2 - 4, tv.last.y - 10, "ico:shield").setScale(1.5);
            this.fx.add(ico);
            this.tweens.add({ targets: ico, y: ico.y - 16, alpha: { from: 1, to: 0 }, duration: 620, ease: "Quad.Out", onComplete: () => ico.destroy() });
          }
        } else {
          // 当たった：系統の色の火花と、菌が白く光って少し押される
          this.burst.setParticleTint(v.color);
          this.burst.explode(5, shot.x, shot.y);
          // 白く光らせるのは短く、間を空けて（試遊の指摘：何体にも当たられると白いままで、グラム染色の色が分からない）
          if (!tv.dying && this.time.now - tv.flashUntil > 220) {
            tv.body.setTintFill(0xffffff);
            tv.flashUntil = this.time.now + 45;
            tv.knock = 5;
          }
          this.tweens.add({ targets: shot, scale: 1.8, alpha: 0, duration: 140, onComplete: () => shot.destroy() });
        }
      },
    });
  }

  // ---------- 知らせの帯 ----------

  /**
   * 盤面の真ん中に帯を出す（ステージの始まり・終わり）。title は大きく、sub は小さく。hold の間出してから消える
   */
  banner(title: string, sub = "", color: string = COLORS.accent, hold = 1300): void {
    this.bannerObj?.destroy();
    const cx = (LAYOUT.x0 + W) / 2;
    const cy = LAYOUT.laneTop + 1.5 * LAYOUT.laneH;
    const c = this.add.container(cx, cy).setDepth(90);
    const h = sub ? 96 : 78;
    const band = this.add.rectangle(0, 0, W - LAYOUT.x0 + 40, h, 0x07040c, 0.82);
    const lineT = this.add.rectangle(0, -h / 2, W - LAYOUT.x0 + 40, 3, hexNum(color), 1);
    const lineB = this.add.rectangle(0, h / 2, W - LAYOUT.x0 + 40, 3, hexNum(color), 1);
    const t = this.text(0, sub ? -12 : 0, title, 40, "#ffffff", { stroke: color, strokeThickness: 2, shadow: { offsetX: 0, offsetY: 4, color: "#000000", blur: 0, fill: true } }).setOrigin(0.5);
    const parts: Phaser.GameObjects.GameObject[] = [band, lineT, lineB, t];
    if (sub) parts.push(this.text(0, 28, sub, 16, COLORS.inkDim).setOrigin(0.5));
    c.add(parts);
    band.setScale(1, 0);
    t.setAlpha(0).setX(70);
    this.tweens.add({ targets: band, scaleY: 1, duration: 160, ease: "Quad.Out" });
    this.tweens.add({ targets: t, x: 0, alpha: 1, duration: 260, delay: 80, ease: "Back.Out" });
    this.tweens.add({
      targets: c,
      alpha: 0,
      delay: hold,
      duration: 260,
      onComplete: () => {
        c.destroy();
        if (this.bannerObj === c) this.bannerObj = null;
      },
    });
    this.bannerObj = c;
  }

  /** 波の始まり：盤面の上の小さな札 */
  private waveTagShow(text: string, last: boolean): void {
    this.waveTag?.destroy();
    const cx = (LAYOUT.x0 + LAYOUT.x1) / 2;
    const y = LAYOUT.laneTop + 22;
    const c = this.add.container(cx, y - 20).setDepth(85).setAlpha(0);
    const color = last ? COLORS.bad : COLORS.gold;
    const t = this.text(0, 0, text, 20, "#ffffff", { stroke: "#07040c", strokeThickness: 4 }).setOrigin(0.5);
    const w = t.width + 56;
    const bg = this.add.rectangle(0, 0, w, 32, 0x07040c, 0.86).setStrokeStyle(2, hexNum(color), 1);
    const pip = this.add.image(-w / 2 + 18, 0, "glow").setDisplaySize(16, 16).setTint(hexNum(color));
    c.add([bg, pip, t]);
    this.tweens.add({ targets: c, y, alpha: 1, duration: 260, ease: "Back.Out" });
    this.tweens.add({ targets: c, alpha: 0, y: y - 12, delay: 1600, duration: 360, onComplete: () => c.destroy() });
    this.waveTag = c;
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
          const label = e.intrinsic ? `もともと効かない（${abbr}）` : fixed ? `効かない扱い（${abbr}）` : `効かない（${abbr}）`;
          // 菌名の札より上に出す（試遊の指摘：札と重なって両方読めない）
          this.float(v.last.x, v.last.y - v.h / 2 - 42, label, e.intrinsic || fixed ? COLORS.intrinsic : COLORS.bad);
          break;
        }
        case "killed": {
          const v = this.bugs.get(e.uid);
          if (!v) break;
          v.dying = true;
          v.name.setVisible(false);
          v.tagA.setVisible(false);
          v.tagB.setVisible(false);
          // はじける：グラム染色の色の粒と白い粒、広がる輪
          const gc = GRAM_COLORS[v.gram];
          this.burst.setParticleTint(gc.fill);
          this.burst.explode(12, v.last.x, v.last.y);
          this.burst.setParticleTint(0xffffff);
          this.burst.explode(5, v.last.x, v.last.y);
          const ring = this.add.circle(v.last.x, v.last.y, 8).setStrokeStyle(3, GRAM_GLOW[v.gram], 1);
          this.fx.add(ring);
          this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 360, ease: "Quad.Out", onComplete: () => ring.destroy() });
          v.body.setTintFill(0xffffff);
          this.tweens.add({ targets: v.c, scale: 0.2, alpha: 0, angle: 40, duration: 300, ease: "Quad.In", onComplete: () => this.dropBug(e.uid) });
          break;
        }
        case "leaked": {
          const v = this.bugs.get(e.uid);
          if (v) {
            v.dying = true;
            this.tweens.add({ targets: v.c, x: LAYOUT.x0 - 30, alpha: 0, duration: 260, onComplete: () => this.dropBug(e.uid) });
          }
          this.bladderShake = 300;
          this.cameras.main.shake(180, 0.004);
          this.bladderFlash.setAlpha(0.45);
          this.tweens.add({ targets: this.bladderFlash, alpha: 0, duration: 480, ease: "Quad.Out" });
          this.bladder.setTintFill(0xffffff);
          this.time.delayedCall(70, () => this.bladder.clearTint());
          this.float(LAYOUT.x0 / 2, LAYOUT.laneTop + 28, `−${e.damage}`, "#ffffff", 32, "#9a0f24", 10);
          break;
        }
        case "summon": {
          const drug = data.drugById.get(e.drug);
          if (drug?.bioavailability != null) {
            // 3つめの兵士の右に出す
            this.float(unitX(2) + 170, unitY(e.lane), `内服：体に届くのは ${Math.round(drug.bioavailability * 100)}%（吸収率）`, COLORS.teal, 14);
          }
          break;
        }
        case "end": {
          if (e.outcome === "won") {
            this.banner("守り切った！", "すべての波をしのいだ", COLORS.good, 1000);
            this.celebrate();
          } else {
            this.banner("膀胱が破られた", "", COLORS.bad, 1000);
            this.cameras.main.shake(380, 0.008);
            this.bladderFlash.setAlpha(0.7);
            this.tweens.add({ targets: this.bladderFlash, alpha: 0, duration: 1200, ease: "Quad.Out" });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /** 守り切ったときの紙吹雪（系統の色とグラム染色の色の粒が、盤面の上から降る） */
  private celebrate(): void {
    const colors = [0x5ef0a0, 0xffcf3f, 0xff4f8b, 0x3be0c6, 0xa983ff, 0xffffff];
    for (let i = 0; i < 70; i++) {
      const x = LAYOUT.x0 + Math.random() * (W - LAYOUT.x0);
      const r = this.add.rectangle(x, LAYOUT.laneTop - 10, 4, 6, colors[i % colors.length]!).setDepth(88);
      this.fx.add(r);
      this.tweens.add({
        targets: r,
        y: LAYOUT.laneTop + 3 * LAYOUT.laneH + 10,
        x: x + (Math.random() - 0.5) * 120,
        angle: (Math.random() - 0.5) * 720,
        delay: Math.random() * 500,
        duration: 1300 + Math.random() * 900,
        ease: "Sine.In",
        onComplete: () => r.destroy(),
      });
    }
  }

  private dropBug(uid: number): void {
    const v = this.bugs.get(uid);
    if (!v) return;
    v.c.destroy();
    this.bugs.delete(uid);
  }

  float(x: number, y: number, s: string, color: string, size = 15, stroke: string = COLORS.outline, minLeft: number = LAYOUT.x0 + 6): void {
    // 盤面の端で切れないように、内側に寄せる。膀胱の絵にも重ねない（膀胱の耐久が減ったときの数字だけ、膀胱の上に出す）
    const big = size >= 24;
    const t = this.text(0, y, s, size, color, { ...(big ? {} : TAG_FONT), stroke, strokeThickness: big ? 7 : 5 }).setOrigin(0.5);
    const half = t.width / 2 + 6;
    t.setX(Math.min(W - 30 - half, Math.max(minLeft + half, x)));
    t.setDepth(60);
    t.setScale(0.6);
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: "Back.Out" });
    this.tweens.add({ targets: t, y: y - 30, alpha: { from: 1, to: 0 }, delay: 120, duration: 1500, ease: "Quad.Out", onComplete: () => t.destroy() });
  }
}
