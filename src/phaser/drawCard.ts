import Phaser from 'phaser'
import { rankLabel, suitMark, suitRed, type Card, type Suit } from '../paquet/engine'

export const CARD_BAKE_W = 200
export const CARD_BAKE_H = 280
export const CARD_W = 64
export const CARD_H = 90

const FACE = 'Playfair Display, Georgia, serif'

function ink(suit: Suit) {
  return suitRed(suit) ? 0xb91c1c : 0x16161a
}

function inkCss(suit: Suit) {
  return suitRed(suit) ? '#b91c1c' : '#16161a'
}

export function cardTex(card: Card) {
  return `card-${card.rank}-${card.suit}`
}

function gfx(scene: Phaser.Scene) {
  return scene.add.graphics().setVisible(false)
}

function stamp(g: Phaser.GameObjects.Graphics, key: string, w: number, h: number) {
  g.generateTexture(key, w, h)
  g.destroy()
}

export function bakeCardBack(scene: Phaser.Scene) {
  if (scene.textures.exists('card-back')) return
  const w = CARD_BAKE_W
  const h = CARD_BAKE_H
  const g = gfx(scene)
  g.fillStyle(0x12080c, 0.4)
  g.fillRoundedRect(6, 10, w - 6, h - 6, 18)
  g.fillStyle(0x4a0d1c, 1)
  g.fillRoundedRect(0, 0, w, h, 18)
  g.fillStyle(0x6b1228, 1)
  g.fillRoundedRect(10, 10, w - 20, h - 20, 12)
  g.lineStyle(3, 0xd4a017, 1)
  g.strokeRoundedRect(16, 16, w - 32, h - 32, 10)
  g.lineStyle(1.2, 0xf0d78c, 0.55)
  g.strokeRoundedRect(22, 22, w - 44, h - 44, 8)
  g.fillStyle(0x4a0d1c, 1)
  g.fillRoundedRect(28, 28, w - 56, h - 56, 8)
  g.lineStyle(1, 0xd4a017, 0.22)
  for (let i = -h; i < w + h; i += 16) {
    g.lineBetween(i, 36, i + 72, h - 36)
    g.lineBetween(i, 36, i - 72, h - 36)
  }
  g.fillStyle(0xd4a017, 0.18)
  for (let y = 48; y < h - 48; y += 18) {
    for (let x = 48; x < w - 48; x += 18) {
      g.fillCircle(x + ((y / 18) % 2) * 9, y, 2.4)
    }
  }
  g.fillStyle(0x6b1228, 1)
  g.fillCircle(w / 2, h / 2, 36)
  g.lineStyle(2.4, 0xd4a017, 1)
  g.strokeCircle(w / 2, h / 2, 32)
  g.fillStyle(0xd4a017, 1)
  diamond(g, w / 2, h / 2, 14)
  stamp(g, 'card-back', w, h)
}

export function bakeCardFace(scene: Phaser.Scene, card: Card) {
  const key = cardTex(card)
  if (scene.textures.exists(key)) return key
  const w = CARD_BAKE_W
  const h = CARD_BAKE_H
  const color = ink(card.suit)
  const g = gfx(scene)
  g.fillStyle(0x1a1208, 0.28)
  g.fillRoundedRect(5, 8, w, h, 18)
  g.fillStyle(0xfbf6ea, 1)
  g.fillRoundedRect(0, 0, w, h, 16)
  g.lineStyle(2, 0xe2d3b3, 1)
  g.strokeRoundedRect(1.5, 1.5, w - 3, h - 3, 15)
  g.lineStyle(1.1, color, 0.18)
  g.strokeRoundedRect(11, 11, w - 22, h - 22, 10)

  if (card.rank === 14) {
    drawSuit(g, w / 2, h / 2 + 4, 38, card.suit, color, 1)
  } else if (card.rank >= 11) {
    paintCourt(g, card, w, h, color)
  } else {
    for (const pip of pips(card.rank)) {
      drawSuit(g, 46 + pip.x * (w - 92), 58 + pip.y * (h - 116), pip.s, card.suit, color, pip.flip)
    }
  }
  stamp(g, key, w, h)
  return key
}

export function faceIndex(scene: Phaser.Scene, card: Card) {
  return [indexCol(scene, card, -CARD_W / 2 + 11, -CARD_H / 2 + 7, 0), indexCol(scene, card, CARD_W / 2 - 11, CARD_H / 2 - 7, 180)]
}

function indexCol(scene: Phaser.Scene, card: Card, x: number, y: number, angle: number) {
  const color = inkCss(card.suit)
  const col = scene.add.container(x, y).setAngle(angle)
  col.add(
    scene.add
      .text(0, 0, rankLabel(card.rank), {
        fontFamily: FACE,
        fontSize: '13px',
        color,
        fontStyle: '700',
      })
      .setOrigin(0.5, 0),
  )
  col.add(
    scene.add
      .text(0, 14, suitMark(card.suit), {
        fontFamily: FACE,
        fontSize: '11px',
        color,
        fontStyle: '700',
      })
      .setOrigin(0.5, 0),
  )
  return col
}

function paintCourt(g: Phaser.GameObjects.Graphics, card: Card, w: number, h: number, color: number) {
  const x = 48
  const y = 64
  const pw = w - 96
  const ph = h - 128
  g.fillStyle(0xf3e6c8, 1)
  g.fillRoundedRect(x, y, pw, ph, 10)
  g.lineStyle(2, color, 0.85)
  g.strokeRoundedRect(x, y, pw, ph, 10)
  g.lineStyle(1, 0xd4a017, 0.65)
  g.strokeRoundedRect(x + 6, y + 6, pw - 12, ph - 12, 7)
  drawSuit(g, w / 2, h / 2 + 6, 22, card.suit, color, 1)
}

function pips(rank: number): { x: number; y: number; s: number; flip: 1 | -1 }[] {
  const s = rank >= 9 ? 13 : 15
  const L = 0.16
  const R = 0.84
  const C = 0.5
  const t = 0.08
  const m = 0.5
  const b = 0.92
  const tm = 0.29
  const bm = 0.71
  const row = (xs: number[], y: number, flip: 1 | -1) => xs.map((x) => ({ x, y, s, flip }))
  if (rank === 2) return [...row([C], t, 1), ...row([C], b, -1)]
  if (rank === 3) return [...row([C], t, 1), ...row([C], m, 1), ...row([C], b, -1)]
  if (rank === 4) return [...row([L, R], t, 1), ...row([L, R], b, -1)]
  if (rank === 5) return [...row([L, R], t, 1), ...row([C], m, 1), ...row([L, R], b, -1)]
  if (rank === 6) return [...row([L, R], t, 1), ...row([L, R], m, 1), ...row([L, R], b, -1)]
  if (rank === 7) return [...row([L, R], t, 1), ...row([C], tm, 1), ...row([L, R], m, 1), ...row([L, R], b, -1)]
  if (rank === 8) {
    return [
      ...row([L, R], t, 1),
      ...row([C], tm, 1),
      ...row([L, R], m, 1),
      ...row([C], bm, -1),
      ...row([L, R], b, -1),
    ]
  }
  if (rank === 9) {
    return [
      ...row([L, R], t, 1),
      ...row([L, R], tm, 1),
      ...row([C], m, 1),
      ...row([L, R], bm, -1),
      ...row([L, R], b, -1),
    ]
  }
  return [
    ...row([L, R], t, 1),
    ...row([C], 0.2, 1),
    ...row([L, R], tm, 1),
    ...row([L, R], bm, -1),
    ...row([C], 0.8, -1),
    ...row([L, R], b, -1),
  ]
}

function diamond(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number) {
  g.beginPath()
  g.moveTo(x, y - s)
  g.lineTo(x + s * 0.72, y)
  g.lineTo(x, y + s)
  g.lineTo(x - s * 0.72, y)
  g.closePath()
  g.fillPath()
}

function drawSuit(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  s: number,
  suit: Suit,
  color: number,
  dir: 1 | -1,
) {
  g.fillStyle(color, 1)
  if (suit === 'diamonds') {
    diamond(g, x, y, s * 0.92)
    return
  }
  if (suit === 'hearts') {
    heart(g, x, y, s, dir)
    return
  }
  if (suit === 'spades') {
    spade(g, x, y, s, dir)
    return
  }
  club(g, x, y, s, dir)
}

function heart(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1) {
  const d = dir
  g.fillCircle(x - s * 0.34, y - d * s * 0.16, s * 0.38)
  g.fillCircle(x + s * 0.34, y - d * s * 0.16, s * 0.38)
  g.fillTriangle(x - s * 0.7, y - d * s * 0.08, x + s * 0.7, y - d * s * 0.08, x, y + d * s * 0.72)
}

function spade(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1) {
  const d = dir
  g.fillCircle(x - s * 0.3, y + d * s * 0.08, s * 0.34)
  g.fillCircle(x + s * 0.3, y + d * s * 0.08, s * 0.34)
  g.fillTriangle(x - s * 0.68, y + d * s * 0.02, x + s * 0.68, y + d * s * 0.02, x, y - d * s * 0.72)
  g.fillTriangle(x - s * 0.22, y + d * s * 0.72, x + s * 0.22, y + d * s * 0.72, x, y + d * s * 0.12)
}

function club(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, dir: 1 | -1) {
  const d = dir
  g.fillCircle(x, y - d * s * 0.28, s * 0.32)
  g.fillCircle(x - s * 0.34, y + d * s * 0.08, s * 0.32)
  g.fillCircle(x + s * 0.34, y + d * s * 0.08, s * 0.32)
  g.fillCircle(x, y + d * s * 0.02, s * 0.2)
  g.fillTriangle(x - s * 0.2, y + d * s * 0.7, x + s * 0.2, y + d * s * 0.7, x, y + d * s * 0.08)
}
