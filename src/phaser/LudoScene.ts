import Phaser from 'phaser'
import {
  homeColor,
  isCenter,
  isPath,
  isStar,
  PALETTE,
  startColor,
  yardColor,
  YARD_COLORS,
} from '../ludo/board'
import { tokenCell, cellOf } from '../ludo/path'
import type { ColorId, Token, TokenLoc } from '../ludo/types'
import { playSfx } from '../audio/sfx'
import { copyLoc, forwardLocs, homeLocs, sameLoc } from './pawnPath'

export type BoardSync = {
  tokens: Token[]
  movable: string[]
  selectedId: string | null
  pot: number
}

const SIZE = 840
const FRAME = 24

function yardCorner(color: ColorId): readonly [number, number] {
  if (color === 'green') return [0, 0]
  if (color === 'yellow') return [0, 9]
  if (color === 'red') return [9, 0]
  return [9, 9]
}

function tint(hex: string) {
  return Number.parseInt(hex.slice(1), 16)
}

function stackOffset(count: number, index: number) {
  if (count < 2) return { dx: 0, dy: 0 }
  if (count === 2) {
    return index === 0 ? { dx: -0.3, dy: 0.08 } : { dx: 0.3, dy: -0.08 }
  }
  const radius = count === 3 ? 0.28 : 0.32
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * 0.72 }
}

function drawStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number) {
  g.fillStyle(color, 1)
  g.beginPath()
  for (let i = 0; i < 10; i += 1) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5
    const rad = i % 2 === 0 ? r : r * 0.42
    const x = cx + Math.cos(ang) * rad
    const y = cy + Math.sin(ang) * rad
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.closePath()
  g.fillPath()
}

function drawSafeStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, fill: number) {
  g.fillStyle(0xffffff, 0.35)
  g.fillCircle(cx, cy, r * 1.15)
  drawStar(g, cx, cy + 0.4, r, 0x6b1a12)
  drawStar(g, cx, cy, r * 0.92, fill)
}

export class LudoScene extends Phaser.Scene {
  private onPick: (id: string) => void = () => undefined
  private pending: BoardSync | null = null
  private readyBoard = false
  private cell = (SIZE - FRAME * 2) / 15
  private pawns = new Map<string, Phaser.GameObjects.Container>()
  private lastLoc = new Map<string, TokenLoc>()
  private walkGen = new Map<string, number>()
  private potText?: Phaser.GameObjects.Text

  constructor() {
    super('LudoScene')
  }

  setSelect(fn: (id: string) => void) {
    this.onPick = fn
  }

  sync(view: BoardSync) {
    this.pending = view
    if (this.readyBoard) this.apply(view)
  }

  create() {
    this.cameras.main.setBackgroundColor(0x4a2d0c)
    this.input.setTopOnly(false)
    this.bakePawns()
    this.bakeBoard()
    this.add.image(SIZE / 2, SIZE / 2, 'ludo-board').setDepth(0)
    this.potText = this.add
      .text(SIZE / 2, SIZE / 2 + this.cell * 0.12, '', {
        fontFamily: 'Fredoka, Nunito, system-ui, sans-serif',
        fontSize: `${Math.round(this.cell * 0.55)}px`,
        color: '#3a2408',
        fontStyle: '700',
        align: 'center',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1)
    this.add
      .text(SIZE / 2, SIZE / 2 - this.cell * 0.28, 'POT', {
        fontFamily: 'Nunito, system-ui, sans-serif',
        fontSize: `${Math.round(this.cell * 0.28)}px`,
        color: '#5c3a12',
        fontStyle: '800',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1)

    this.readyBoard = true
    if (this.pending) this.apply(this.pending)
  }

  private cellLeft(col: number) {
    return FRAME + col * this.cell
  }

  private cellTop(row: number) {
    return FRAME + row * this.cell
  }

  private cellCenter(row: number, col: number) {
    return {
      x: this.cellLeft(col) + this.cell / 2,
      y: this.cellTop(row) + this.cell / 2,
    }
  }

  private yardWell(color: ColorId) {
    const [r0, c0] = yardCorner(color)
    const c = this.cell
    return {
      x: this.cellLeft(c0) + c * 0.72,
      y: this.cellTop(r0) + c * 0.72,
      w: c * 4.56,
    }
  }

  private yardSocket(color: ColorId, slot: number) {
    const well = this.yardWell(color)
    const col = slot % 2
    const row = Math.floor(slot / 2)
    return {
      x: well.x + well.w * (0.29 + col * 0.42),
      y: well.y + well.w * (0.29 + row * 0.42),
    }
  }

  private pointFor(color: ColorId, loc: TokenLoc, dx = 0, dy = 0) {
    if (loc.kind === 'yard') return this.yardSocket(color, loc.slot)
    const [row, col] = cellOf(color, loc)
    return this.cellCenter(row + dy, col + dx)
  }

  private hopAlong(
    id: string,
    pawn: Phaser.GameObjects.Container,
    points: { x: number; y: number }[],
    endScale: number,
    inYard: boolean,
    hot: boolean,
  ) {
    const gen = (this.walkGen.get(id) ?? 0) + 1
    this.walkGen.set(id, gen)
    this.tweens.killTweensOf(pawn)
    const body = pawn.getByName('body') as Phaser.GameObjects.Image
    this.tweens.killTweensOf(body)
    body.y = 0
    pawn.setData('walking', true)
    pawn.setDepth(50)

    const duration = points.length > 18 ? 70 : 95
    const lift = this.cell * 0.24

    const step = (index: number) => {
      if (this.walkGen.get(id) !== gen) return
      if (index >= points.length) {
        pawn.setData('walking', false)
        body.setScale(endScale)
        body.setOrigin(0.5, inYard ? 0.78 : 0.82)
        this.setPawnHot(pawn, hot)
        return
      }
      const to = points[index]
      const fromY = pawn.y
      playSfx('hop')
      this.tweens.add({
        targets: pawn,
        x: to.x,
        duration,
        ease: 'Sine.Out',
        onUpdate: (tween) => {
          if (this.walkGen.get(id) !== gen) return
          const t = typeof tween.totalProgress === 'number' ? tween.totalProgress : tween.progress
          pawn.y = fromY + (to.y - fromY) * t - Math.sin(t * Math.PI) * lift
        },
        onComplete: () => {
          if (this.walkGen.get(id) !== gen) return
          pawn.x = to.x
          pawn.y = to.y
          step(index + 1)
        },
      })
    }
    step(0)
  }

  private setPawnHot(pawn: Phaser.GameObjects.Container, hot: boolean) {
    const body = pawn.getByName('body') as Phaser.GameObjects.Image
    if (pawn.getData('hot') === hot) return
    pawn.setData('hot', hot)
    this.tweens.killTweensOf(body)
    body.y = 0
    if (!hot) return
    this.tweens.add({
      targets: body,
      y: -10,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
  }

  private bakePawns() {
    for (const color of YARD_COLORS) {
      const g = this.add.graphics().setVisible(false)
      const fill = tint(PALETTE[color].hex)
      const deep = tint(PALETTE[color].deep)
      g.fillStyle(0x000000, 0.4)
      g.fillEllipse(48, 122, 34, 8)
      g.fillStyle(deep, 1)
      g.fillEllipse(48, 104, 30, 11)
      g.fillStyle(fill, 1)
      g.fillEllipse(48, 99, 26, 8)
      g.fillStyle(deep, 1)
      g.fillTriangle(26, 46, 70, 46, 48, 102)
      g.fillStyle(fill, 1)
      g.fillTriangle(30, 44, 66, 44, 48, 96)
      g.fillStyle(0xffffff, 0.22)
      g.fillTriangle(40, 48, 50, 48, 48, 88)
      g.fillStyle(deep, 1)
      g.fillCircle(48, 36, 27)
      g.fillStyle(fill, 1)
      g.fillCircle(48, 34, 24)
      g.fillStyle(0xffffff, 0.55)
      g.fillCircle(40, 26, 8)
      g.fillStyle(0xffffff, 0.2)
      g.fillCircle(54, 40, 5)
      g.generateTexture(`pawn-${color}`, 96, 132)
      g.destroy()
    }
  }

  private bakeBoard() {
    const g = this.add.graphics().setVisible(false)
    const c = this.cell
    const inset = Math.max(1.5, c * 0.06)

    g.fillStyle(0xe8c36a, 1)
    g.fillRoundedRect(0, 0, SIZE, SIZE, 38)
    g.fillStyle(0xb8862b, 1)
    g.fillRoundedRect(7, 9, SIZE - 14, SIZE - 16, 34)
    g.fillStyle(0x6b3e12, 1)
    g.fillRoundedRect(13, 13, SIZE - 26, SIZE - 26, 30)
    g.fillStyle(0x24150a, 1)
    g.fillRoundedRect(FRAME - 5, FRAME - 5, c * 15 + 10, c * 15 + 10, 18)

    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        const x = this.cellLeft(col)
        const y = this.cellTop(row)
        const start = startColor(row, col)
        const home = homeColor(row, col)
        const yard = yardColor(row, col)
        const path = isPath(row, col)
        const center = isCenter(row, col)
        const star = isStar(row, col)
        if (center) continue

        if (start) {
          g.fillStyle(tint(PALETTE[start].hex), 1)
          g.fillRoundedRect(x + 1, y + 1, c - 2, c - 2, 5)
          g.fillStyle(0xffffff, 0.22)
          g.fillRoundedRect(x + inset, y + inset, c - inset * 2, (c - inset * 2) * 0.42, 4)
          g.lineStyle(2.5, 0xffffff, 0.9)
          g.strokeRoundedRect(x + 3, y + 3, c - 6, c - 6, 4)
          drawSafeStar(g, x + c / 2, y + c / 2, c * 0.26, 0xfff6d2)
          continue
        }

        if (star) {
          g.fillStyle(0xfffaf0, 1)
          g.fillRoundedRect(x + 1, y + 1, c - 2, c - 2, 4)
          g.lineStyle(1.5, 0xd4b57a, 1)
          g.strokeRoundedRect(x + 1, y + 1, c - 2, c - 2, 4)
          drawSafeStar(g, x + c / 2, y + c / 2, c * 0.24, 0xe53935)
          continue
        }

        if (path) {
          g.fillStyle(0xfff8ea, 1)
          g.fillRoundedRect(x + 1, y + 1, c - 2, c - 2, 3)
          g.lineStyle(1, 0xd9c49a, 0.95)
          g.strokeRoundedRect(x + 1, y + 1, c - 2, c - 2, 3)
          continue
        }

        if (home) {
          g.fillStyle(tint(PALETTE[home].hex), 1)
          g.fillRect(x, y, c, c)
          g.fillStyle(0xffffff, 0.16)
          g.fillRect(x, y, c, c * 0.35)
          continue
        }

        if (yard) {
          g.fillStyle(tint(PALETTE[yard].hex), 1)
          g.fillRect(x, y, c, c)
        }
      }
    }

    for (const color of YARD_COLORS) {
      const well = this.yardWell(color)
      g.fillStyle(0xffffff, 0.22)
      g.fillRoundedRect(well.x - 6, well.y - 6, well.w + 12, well.w + 12, this.cell * 0.62)
      g.fillStyle(0xffffff, 0.55)
      g.fillRoundedRect(well.x, well.y, well.w, well.w, this.cell * 0.52)
      g.lineStyle(5, 0xffffff, 0.92)
      g.strokeRoundedRect(well.x, well.y, well.w, well.w, this.cell * 0.52)
    }

    for (const color of YARD_COLORS) {
      for (const slot of [0, 1, 2, 3]) {
        const { x, y } = this.yardSocket(color, slot)
        const r = this.cell * 0.4
        g.fillStyle(tint(PALETTE[color].deep), 0.28)
        g.fillCircle(x, y + 2, r)
        g.fillStyle(0xffffff, 0.88)
        g.fillCircle(x, y, r)
        g.lineStyle(2.5, tint(PALETTE[color].hex), 0.45)
        g.strokeCircle(x, y, r * 0.92)
      }
    }

    const box = {
      x: this.cellLeft(6),
      y: this.cellTop(6),
      s: c * 3,
    }
    const midX = box.x + box.s / 2
    const midY = box.y + box.s / 2
    g.fillStyle(tint(PALETTE.yellow.hex), 1)
    g.fillTriangle(box.x, box.y, box.x + box.s, box.y, midX, midY)
    g.fillStyle(tint(PALETTE.blue.hex), 1)
    g.fillTriangle(box.x + box.s, box.y, box.x + box.s, box.y + box.s, midX, midY)
    g.fillStyle(tint(PALETTE.red.hex), 1)
    g.fillTriangle(box.x, box.y + box.s, box.x + box.s, box.y + box.s, midX, midY)
    g.fillStyle(tint(PALETTE.green.hex), 1)
    g.fillTriangle(box.x, box.y, box.x, box.y + box.s, midX, midY)
    g.lineStyle(2, 0xffffff, 0.35)
    g.lineBetween(box.x, box.y, box.x + box.s, box.y + box.s)
    g.lineBetween(box.x + box.s, box.y, box.x, box.y + box.s)

    g.fillStyle(0xc49200, 1)
    g.fillCircle(midX, midY, c * 0.78)
    g.fillStyle(0xe2b039, 1)
    g.fillCircle(midX, midY, c * 0.7)
    g.fillStyle(0xfff0b8, 1)
    g.fillCircle(midX - c * 0.14, midY - c * 0.16, c * 0.28)

    g.generateTexture('ludo-board', SIZE, SIZE)
    g.destroy()
  }

  private apply(view: BoardSync) {
    const stacks = new Map<string, Token[]>()
    for (const token of view.tokens) {
      const [row, col] = tokenCell(token)
      const key = `${row}:${col}`
      const group = stacks.get(key)
      if (group) group.push(token)
      else stacks.set(key, [token])
    }

    const seen = new Set<string>()
    for (const token of view.tokens) {
      seen.add(token.id)
      const inYard = token.loc.kind === 'yard'
      const [row, col] = tokenCell(token)
      const group = stacks.get(`${row}:${col}`) ?? [token]
      const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id))
      const index = ordered.findIndex((item) => item.id === token.id)
      const { dx, dy } = inYard ? { dx: 0, dy: 0 } : stackOffset(ordered.length, index)
      const pos = inYard
        ? this.yardSocket(token.color, token.loc.kind === 'yard' ? token.loc.slot : 0)
        : this.cellCenter(row + dy, col + dx)
      const { x, y } = pos
      const hot = view.movable.includes(token.id)
      const selected = view.selectedId === token.id
      const stacked = !inYard && ordered.length > 1
      const scale = ((this.cell * (inYard ? 0.72 : 0.98)) / 96) * (stacked ? 0.86 : 1)
      const prev = this.lastLoc.get(token.id)
      this.lastLoc.set(token.id, copyLoc(token.loc))
      let pawn = this.pawns.get(token.id)
      if (!pawn) {
        pawn = this.add.container(x, y)
        const sprite = this.add.image(0, 0, `pawn-${token.color}`).setOrigin(0.5, inYard ? 0.78 : 0.82)
        sprite.setName('body')
        sprite.setScale(scale)
        pawn.add(sprite)
        const hitW = this.cell * 1.05
        const hitH = this.cell * 1.25
        pawn.setInteractive(
          new Phaser.Geom.Rectangle(-hitW / 2, -hitH * 0.82, hitW, hitH),
          Phaser.Geom.Rectangle.Contains,
        )
        pawn.on('pointerdown', () => this.onPick(token.id))
        pawn.setData('hot', false)
        pawn.setData('walking', false)
        this.pawns.set(token.id, pawn)
      } else {
        const body = pawn.getByName('body') as Phaser.GameObjects.Image
        const sentHome = Boolean(prev && prev.kind !== 'yard' && token.loc.kind === 'yard')
        const moved = Boolean(prev && !sameLoc(prev, token.loc))
        if (moved && prev) {
          const locs = sentHome
            ? homeLocs(prev, token.loc.kind === 'yard' ? token.loc.slot : 0)
            : forwardLocs(prev, token.loc)
          const points = locs.map((loc, i) => {
            const last = i === locs.length - 1
            return last ? { x, y } : this.pointFor(token.color, loc)
          })
          if (points.length) {
            body.setScale(((this.cell * 0.98) / 96) * (sentHome ? 0.92 : 1))
            body.setOrigin(0.5, 0.82)
            this.hopAlong(token.id, pawn, points, scale, inYard, hot)
          } else {
            pawn.x = x
            pawn.y = y
            body.setScale(scale)
          }
        } else if (!pawn.getData('walking')) {
          body.setScale(scale)
          body.setOrigin(0.5, inYard ? 0.78 : 0.82)
          if (Math.abs(pawn.x - x) > 1 || Math.abs(pawn.y - y) > 1) {
            this.tweens.killTweensOf(pawn)
            this.tweens.add({
              targets: pawn,
              x,
              y,
              duration: 180,
              ease: 'Cubic.Out',
            })
          }
        }
      }

      if (!pawn.getData('walking')) {
        pawn.setDepth(selected ? 40 : hot ? 30 : 2 + row)
        this.setPawnHot(pawn, hot)
      }
    }

    for (const [id, pawn] of this.pawns) {
      if (seen.has(id)) continue
      this.walkGen.set(id, (this.walkGen.get(id) ?? 0) + 1)
      this.walkGen.delete(id)
      this.lastLoc.delete(id)
      pawn.destroy()
      this.pawns.delete(id)
    }

    this.potText?.setText(view.pot.toLocaleString('fr-FR'))
  }
}

export const LUDO_SIZE = SIZE
