import Phaser from 'phaser'
import { cardLabel, type Card, type PaquetColor, type PaquetState } from '../paquet/engine'
import { PAQUET_PALETTE } from '../paquet/palette'
import { formatLudo } from '../ludo/wallet'
import { playSfx } from '../audio/sfx'
import { bakeCardBack, bakeCardFace, cardTex, faceIndex, CARD_H, CARD_W } from './drawCard'

export type PaquetView = {
  state: PaquetState
  you: PaquetColor
  selectable: number[]
}

type Layout = {
  w: number
  h: number
  cx: number
  cy: number
  tableRx: number
  tableRy: number
  seatRx: number
  seatRy: number
  packRx: number
  packRy: number
  zoom: number
  seatScale: number
}

function tint(hex: string) {
  return Number.parseInt(hex.slice(1), 16)
}

function oval(i: number, n: number, cx: number, cy: number, rx: number, ry: number) {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2
  return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, a }
}

function along(pos: { x: number; y: number; a: number }, dist: number) {
  return { x: pos.x + Math.cos(pos.a) * dist, y: pos.y + Math.sin(pos.a) * dist }
}

function nameLift(a: number) {
  return Math.sin(a) < -0.25 ? -56 : 50
}

export class PaquetScene extends Phaser.Scene {
  private onPick: (id: number) => void = () => undefined
  private pending: PaquetView | null = null
  private readyTable = false
  private packets = new Map<number, Phaser.GameObjects.Container>()
  private flipped = new Set<number>()
  private shade?: Phaser.GameObjects.Graphics
  private felt?: Phaser.GameObjects.Graphics
  private potText?: Phaser.GameObjects.Text
  private hintText?: Phaser.GameObjects.Text
  private brandText?: Phaser.GameObjects.Text
  private zoom = 1
  private layoutBox: Layout | null = null
  private hand = 0

  constructor() {
    super('PaquetScene')
  }

  setSelect(fn: (id: number) => void) {
    this.onPick = fn
  }

  sync(view: PaquetView) {
    this.pending = view
    if (this.readyTable) this.apply(view)
  }

  create() {
    this.cameras.main.setBackgroundColor(0x071018)
    bakeCardBack(this)
    this.felt = this.add.graphics().setDepth(0)
    this.shade = this.add.graphics().setDepth(2)
    this.brandText = this.add
      .text(0, 0, 'PETIT PAQUET', {
        fontFamily: 'Nunito, system-ui, sans-serif',
        fontSize: '13px',
        color: '#d7c48a',
        fontStyle: '800',
      })
      .setOrigin(0.5)
      .setAlpha(0.55)
      .setDepth(1)
    this.hintText = this.add
      .text(0, 0, '', {
        fontFamily: 'Fredoka, Nunito, system-ui, sans-serif',
        fontSize: '22px',
        color: '#ffe7a3',
        fontStyle: '800',
        align: 'center',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(8)
      .setAlpha(0)
    this.potText = this.add
      .text(0, 0, '', {
        fontFamily: 'Fredoka, Nunito, system-ui, sans-serif',
        fontSize: '22px',
        color: '#ffe7a3',
        fontStyle: '700',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(4)

    this.scale.on('resize', this.onResize, this)
    this.relayout(true)
    this.readyTable = true
    if (this.pending) this.apply(this.pending)
  }

  private onResize() {
    this.relayout(true)
    if (this.pending) this.apply(this.pending)
  }

  private metrics(): Layout {
    const w = Math.max(this.scale.width, 280)
    const h = Math.max(this.scale.height, 420)
    const portrait = h >= w
    const padT = Math.max(118, h * 0.16)
    const padB = Math.max(86, h * 0.11)
    const cx = w / 2
    const cy = padT + (h - padT - padB) / 2
    const innerW = w
    const innerH = h - padT - padB
    const tableRx = portrait ? innerW * 0.492 : Math.min(innerW * 0.46, innerH * 0.72)
    const tableRy = portrait ? innerH * 0.5 : innerH * 0.48
    const zoom = Phaser.Math.Clamp(Math.min(w / 390, h / 760) * 0.9, 0.78, 1.06)
    return {
      w,
      h,
      cx,
      cy,
      tableRx,
      tableRy,
      seatRx: tableRx * 0.86,
      seatRy: tableRy * 0.84,
      packRx: Math.min(tableRx * 0.4, 96 * zoom),
      packRy: Math.min(tableRy * 0.28, 78 * zoom),
      zoom,
      seatScale: Phaser.Math.Clamp((Math.min(w, h) / 520) * 0.95, 0.7, 1.05),
    }
  }

  private relayout(force = false) {
    const next = this.metrics()
    const prev = this.layoutBox
    if (
      !force &&
      prev &&
      Math.abs(prev.w - next.w) < 1 &&
      Math.abs(prev.h - next.h) < 1
    ) {
      return
    }
    this.layoutBox = next
    this.zoom = next.zoom
    this.paintFelt(next)
    this.cameras.main.setSize(next.w, next.h)
    this.brandText?.setVisible(false)
    this.hintText
      ?.setPosition(next.cx, next.cy)
      .setFontSize(18 * next.zoom)
      .setDepth(20)
    this.potText
      ?.setPosition(next.cx, next.cy - 62 * next.zoom)
      .setFontSize(14 * next.zoom)
      .setDepth(20)
      .setAlpha(0.95)
    this.packets.forEach((node) => node.setData('dest', null))
  }

  private paintFelt(box: Layout) {
    const g = this.felt
    if (!g) return
    const { w, h, cx, cy, tableRx, tableRy } = box
    const ew = tableRx * 2
    const eh = tableRy * 2
    g.clear()
    g.fillStyle(0x071018, 1)
    g.fillRect(0, 0, w, h)
    g.fillStyle(0x120a06, 1)
    g.fillEllipse(cx, cy + 16, ew + 36, eh + 32)
    g.fillStyle(0x4a2a10, 1)
    g.fillEllipse(cx, cy + 10, ew + 18, eh + 16)
    g.fillStyle(0x8a5720, 1)
    g.fillEllipse(cx, cy + 6, ew + 8, eh + 8)
    g.fillStyle(0xd7b45c, 1)
    g.fillEllipse(cx, cy + 2, ew, eh)
    g.fillStyle(0x0b3324, 1)
    g.fillEllipse(cx, cy, ew - 28, eh - 26)
    g.fillStyle(0x146b45, 1)
    g.fillEllipse(cx, cy, ew - 52, eh - 48)
    g.fillStyle(0x1c8254, 1)
    g.fillEllipse(cx, cy, ew - 96, eh - 88)
    g.fillStyle(0x176b46, 1)
    g.fillEllipse(cx, cy, ew - 168, eh - 152)
    g.fillStyle(0xffffff, 0.05)
    g.fillEllipse(cx - ew * 0.16, cy - eh * 0.2, ew * 0.38, eh * 0.24)
    g.lineStyle(2.4, 0xe6c97a, 0.42)
    g.strokeEllipse(cx, cy, ew - 118, eh - 108)
    g.lineStyle(1, 0x0a2418, 0.5)
    g.strokeEllipse(cx, cy, ew - 128, eh - 118)
    g.lineStyle(1.6, 0xe6c97a, 0.22)
    g.strokeEllipse(cx, cy, 72, 46)
    g.fillStyle(0xe6c97a, 0.14)
    g.fillEllipse(cx, cy, 16, 10)
  }

  private apply(view: PaquetView) {
    if (!this.layoutBox) this.relayout(true)
    const { state, you, selectable } = view
    if (this.hand !== state.hand) {
      this.hand = state.hand
      this.flipped.clear()
      this.packets.forEach((node) => node.destroy())
      this.packets.clear()
      this.children.getAll().forEach((obj) => {
        if (typeof obj.name === 'string' && (obj.name.startsWith('elect-') || obj.name.startsWith('chip-'))) obj.destroy()
      })
    }
    this.drawSeats(state, you)
    this.drawElect(state)
    this.drawPackets(state, selectable)
    this.drawBets(state)
    const fight = state.phase === 'cover' || state.phase === 'duel'
    const named = state.phase === 'named'
    const box = this.layoutBox
    if (this.shade && box) {
      this.shade.clear()
      if (fight || named || state.phase === 'claim' || state.phase === 'runoff') {
        this.shade.fillStyle(0x020508, named || state.phase === 'claim' || state.phase === 'runoff' ? 0.36 : 0.55)
        this.shade.fillRect(0, 0, box.w, box.h)
      }
    }
    this.brandText
      ?.setPosition(box?.cx ?? 0, box?.cy ?? 0)
      .setVisible(state.phase === 'pick')
      .setAlpha(0.38)
      .setDepth(1)
    if (this.hintText) {
      if (state.phase === 'runoff') {
        this.hintText.setVisible(true).setText('Barrage · as')
      } else if (state.phase === 'claim') {
        const chefP = state.players.find((p) => p.color === state.chef)
        this.hintText.setVisible(true).setText(chefP ? `${chefP.name} est chef` : 'Chef')
      } else if (named) {
        const chefP = state.players.find((p) => p.color === state.chef)
        this.hintText.setVisible(true).setText(chefP ? `${chefP.name} est chef` : 'Chef')
        const namedKey = `${state.hand}-named`
        if (this.registry.get('pp-named') !== namedKey) {
          this.registry.set('pp-named', namedKey)
          this.hintText.setScale(0.72).setAlpha(0)
          this.tweens.add({
            targets: this.hintText,
            scale: 1,
            alpha: 1,
            duration: 720,
            delay: 220,
            ease: 'Cubic.out',
          })
        }
      } else {
        this.hintText.setVisible(fight).setText(fight ? 'VS' : '')
        const vsKey = `${state.hand}-${state.challenger}`
        if (fight && this.registry.get('pp-vs') !== vsKey) {
          this.registry.set('pp-vs', vsKey)
          this.hintText.setScale(0.55).setAlpha(0)
          this.tweens.add({
            targets: this.hintText,
            scale: 1,
            alpha: 1,
            duration: 320,
            ease: 'Back.out',
          })
        } else if (!fight) {
          this.hintText.setAlpha(0).setScale(1)
          this.registry.set('pp-vs', '')
        }
      }
    }
    if (this.potText) {
      const posted = state.players.filter((p) => p.bet > 0)
      const vs = state.players.find((p) => p.color === state.challenger)
      const amount = state.pot || (vs ? vs.bet * 2 : 0)
      const total = posted.reduce((sum, p) => sum + p.bet, 0)
      const pot = fight && amount
        ? `1 contre 1 · ${formatLudo(amount)}`
        : posted.length
          ? `${posted.length} mise${posted.length > 1 ? 's' : ''} · ${formatLudo(total)}`
          : ''
      this.potText.setText(pot).setVisible(Boolean(pot))
    }
  }

  private drawSeats(state: PaquetState, you: PaquetColor) {
    const box = this.layoutBox
    if (!box) return
    state.players.forEach((player, i) => {
      const key = `seat-${player.color}`
      let node = this.children.getByName(key) as Phaser.GameObjects.Container | null
      const pos = oval(i, 8, box.cx, box.cy, box.seatRx, box.seatRy)
      const tone = PAQUET_PALETTE[player.color]
      if (!node) {
        node = this.add.container(pos.x, pos.y).setName(key).setDepth(14)
        const shadow = this.add.ellipse(0, 18, 52, 16, 0x000000, 0.28)
        const disc = this.add.circle(0, 0, 30, tint(tone.hex)).setName('disc')
        disc.setStrokeStyle(3, state.chef === player.color ? 0xffe7a3 : player.color === you ? 0xf4e7c8 : tint(tone.deep), 1)
        const ny = nameLift(pos.a)
        const crown = this.add
          .text(0, ny - 22, 'CHEF', {
            fontFamily: 'Nunito, system-ui, sans-serif',
            fontSize: '10px',
            color: '#3a2a00',
            fontStyle: '800',
            backgroundColor: '#f0c400',
          })
          .setOrigin(0.5)
          .setPadding(5, 2, 5, 2)
          .setName('crown')
        const plate = this.add.rectangle(0, ny, 108, 36, 0x0b1220, 0.92).setStrokeStyle(1, 0xffffff, 0.14).setName('plate')
        const letter = this.add
          .text(0, -1, player.name.slice(0, 1).toUpperCase(), {
            fontFamily: 'Nunito, system-ui, sans-serif',
            fontSize: '18px',
            color: '#0b1220',
            fontStyle: '800',
          })
          .setOrigin(0.5)
        const label = this.add
          .text(0, ny - 7, player.color === you ? 'Toi' : player.name.slice(0, 10), {
            fontFamily: 'Nunito, system-ui, sans-serif',
            fontSize: '13px',
            color: '#f4e7c8',
            fontStyle: '800',
          })
          .setOrigin(0.5)
          .setName('name')
        const tag = this.add
          .text(0, ny + 9, '', {
            fontFamily: 'Nunito, system-ui, sans-serif',
            fontSize: '11px',
            color: '#ffe7a3',
            fontStyle: '800',
          })
          .setOrigin(0.5)
          .setName('tag')
        node.add([shadow, disc, crown, plate, letter, label, tag])
      } else {
        node.setPosition(pos.x, pos.y)
        const ny = nameLift(pos.a)
        const label = node.getByName('name') as Phaser.GameObjects.Text | null
        if (label) {
          label.setText(player.color === you ? 'Toi' : player.name.slice(0, 10))
          label.setPosition(0, ny - 7)
        }
        const plate = node.getByName('plate') as Phaser.GameObjects.Rectangle | null
        plate?.setPosition(0, ny)
        const tag = node.getByName('tag') as Phaser.GameObjects.Text | null
        tag?.setPosition(0, ny + 9)
        const crown = node.getByName('crown') as Phaser.GameObjects.Text | null
        crown?.setPosition(0, ny - 22)
        const disc = node.getByName('disc') as Phaser.GameObjects.Arc | null
        disc?.setStrokeStyle(3, state.chef === player.color ? 0xffe7a3 : player.color === you ? 0xf4e7c8 : tint(tone.deep), 1)
      }
      node.setDepth(14)
      const crown = node.getByName('crown') as Phaser.GameObjects.Text | null
      const plate = node.getByName('plate') as Phaser.GameObjects.Rectangle | null
      const tag = node.getByName('tag') as Phaser.GameObjects.Text | null
      crown?.setVisible(state.chef === player.color)
      plate?.setStrokeStyle(1.5, state.chef === player.color ? 0xe6c97a : player.color === you ? 0xf4e7c8 : 0xffffff, state.chef === player.color || player.color === you ? 0.85 : 0.16)
      if (tag) {
        const eaten = player.settled && state.chef !== player.color
        tag.setColor(
          state.chef === player.color || state.nextChef === player.color || player.bet || player.color === you
            ? '#ffe7a3'
            : '#b7c4b4',
        )
        tag.setText(
          (state.phase === 'elect' || state.phase === 'named') && player.electCard
            ? cardLabel(player.electCard)
            : player.bet
              ? formatLudo(player.bet)
            : state.chef === player.color
              ? 'Chef'
              : state.nextChef === player.color
                ? 'Ensuite'
                : eaten
                  ? 'Mangé'
                  : '',
        )
      }
      node.setScale(box.seatScale)
      const fight = state.phase === 'cover' || state.phase === 'duel'
      const hot = player.color === state.chef || player.color === state.challenger
      const eaten = player.settled && state.chef !== player.color
      node.setAlpha(fight && !hot && player.color !== you ? 0.22 : eaten ? 0.38 : 1)
      const disc = node.getByName('disc') as Phaser.GameObjects.Arc | null
      if (disc) disc.setScale(fight && hot ? 1.12 : 1)
      if (state.chef === player.color && this.registry.get('pp-chef') !== `${state.hand}-${state.chef}`) {
        this.registry.set('pp-chef', `${state.hand}-${state.chef}`)
        this.tweens.add({
          targets: node,
          scale: { from: node.scale, to: node.scale * 1.14 },
          yoyo: true,
          duration: 280,
          repeat: 1,
        })
      }
      if (state.lastDuel?.winner === player.color && this.registry.get('pp-win') !== `${state.hand}-${state.lastDuel.winner}`) {
        this.registry.set('pp-win', `${state.hand}-${state.lastDuel.winner}`)
        this.tweens.add({
          targets: node,
          scale: { from: node.scale, to: node.scale * 1.12 },
          yoyo: true,
          duration: 380,
          repeat: 2,
        })
      }
    })
  }

  private drawElect(state: PaquetState) {
    const box = this.layoutBox
    if (!box) return
    const showing = state.phase === 'elect' || state.phase === 'named'
    state.players.forEach((player, i) => {
      const key = `elect-${player.color}`
      const existing = this.children.getByName(key) as Phaser.GameObjects.Container | null
      if (!showing || !player.electCard) {
        if (existing && !existing.getData('out')) {
          existing.setData('out', true)
          this.tweens.killTweensOf(existing)
          this.tweens.add({
            targets: existing,
            alpha: 0,
            scale: existing.scale * 0.72,
            duration: 280,
            onComplete: () => existing.destroy(),
          })
        }
        return
      }
      const pos = oval(i, 8, box.cx, box.cy, box.seatRx, box.seatRy)
      const place = along(pos, -46 * this.zoom)
      const winner = state.phase === 'named' && state.chef === player.color
      const dest = winner ? along(pos, -78 * this.zoom) : place
      if (existing) {
        if (state.phase !== 'named') {
          const last = existing.getData('place') as { x: number; y: number } | undefined
          if (!last || Math.abs(last.x - place.x) > 2 || Math.abs(last.y - place.y) > 2) {
            existing.setData('place', place)
            existing.setPosition(place.x, place.y).setScale(this.zoom)
          }
          existing.setDepth(6 + place.y / 200)
          return
        }
        if (existing.getData('named')) {
          existing.setDepth(winner ? 16 : 5)
          return
        }
        existing.setData('named', true)
        existing.setData('place', dest)
        this.tweens.killTweensOf(existing)
        if (winner) {
          const halo = this.add.circle(0, 0, 48, 0xffe08a, 0.3).setName('halo')
          existing.addAt(halo, 0)
          const stamp = this.add
            .text(0, CARD_H * 0.42, 'CHEF', {
              fontFamily: 'Nunito, system-ui, sans-serif',
              fontSize: '11px',
              color: '#3a2a00',
              fontStyle: '800',
              backgroundColor: '#f0c400',
            })
            .setOrigin(0.5)
            .setPadding(6, 2, 6, 2)
            .setAlpha(0)
          existing.add(stamp)
          this.tweens.add({
            targets: existing,
            x: dest.x,
            y: dest.y,
            scale: this.zoom * 1.32,
            duration: 780,
            ease: 'Cubic.out',
          })
          this.tweens.add({
            targets: halo,
            alpha: { from: 0.16, to: 0.48 },
            scale: { from: 0.88, to: 1.2 },
            yoyo: true,
            duration: 700,
            repeat: -1,
          })
          this.tweens.add({
            targets: stamp,
            alpha: 1,
            y: CARD_H * 0.38,
            duration: 420,
            delay: 280,
            ease: 'Back.out',
          })
          existing.setDepth(16)
        } else {
          this.tweens.add({
            targets: existing,
            x: dest.x,
            y: dest.y + 10,
            alpha: 0.26,
            scale: this.zoom * 0.82,
            duration: 560,
            ease: 'Cubic.out',
          })
          existing.setDepth(5)
        }
        return
      }
      bakeCardFace(this, player.electCard)
      const node = this.add.container(box.cx, box.cy).setName(key).setDepth(6 + dest.y / 200).setScale(0.18)
      node.setRotation((i % 2 ? 1 : -1) * 0.55)
      node.setData('place', dest)
      const face = this.add.image(0, 0, cardTex(player.electCard)).setDisplaySize(CARD_W, CARD_H)
      node.add([face, ...faceIndex(this, player.electCard)])
      if (state.phase === 'named') {
        node.setRotation(0)
        node.setPosition(dest.x, dest.y)
        node.setScale(winner ? this.zoom * 1.32 : this.zoom * 0.82)
        node.setAlpha(winner ? 1 : 0.26)
        node.setData('named', true)
        node.setDepth(winner ? 16 : 5)
        if (winner) {
          node.addAt(this.add.circle(0, 0, 48, 0xffe08a, 0.3), 0)
          node.add(
            this.add
              .text(0, CARD_H * 0.38, 'CHEF', {
                fontFamily: 'Nunito, system-ui, sans-serif',
                fontSize: '11px',
                color: '#3a2a00',
                fontStyle: '800',
                backgroundColor: '#f0c400',
              })
              .setOrigin(0.5)
              .setPadding(6, 2, 6, 2),
          )
        }
        return
      }
      this.tweens.add({
        targets: node,
        x: place.x,
        y: place.y,
        scale: this.zoom,
        rotation: 0,
        duration: 520,
        delay: i * 60,
        ease: 'Cubic.out',
        onStart: () => playSfx('join'),
      })
    })
  }

  private drawPackets(state: PaquetState, selectable: number[]) {
    const box = this.layoutBox
    if (!box) return
    if (!state.packets.length) {
      this.packets.forEach((node) => node.setVisible(false))
      return
    }
    const canPick = new Set(selectable)
    const z = this.zoom
    state.packets.forEach((packet, i) => {
      let node = this.packets.get(packet.id)
      const n = Math.max(state.packets.length, 1)
      const home = oval(i, n, box.cx, box.cy - 4, box.packRx * (n <= 5 ? 1.15 : 1), box.packRy * (n <= 5 ? 1.08 : 1))
      const owner = state.players.find((p) => p.color === packet.takenBy)
      const ownerIndex = owner ? state.players.findIndex((p) => p.color === owner.color) : -1
      const seat = ownerIndex >= 0 ? oval(ownerIndex, 8, box.cx, box.cy, box.seatRx, box.seatRy) : home
      const fight = state.phase === 'cover' || state.phase === 'duel'
      const hot = Boolean(
        fight && owner && (owner.color === state.chef || owner.color === state.challenger),
      )
      const gap = 58 * z
      const dest = hot
        ? owner?.color === state.chef
          ? { x: box.cx - gap, y: box.cy + 8 }
          : { x: box.cx + gap, y: box.cy + 8 }
        : owner
          ? along(seat, -44 * z)
          : home
      if (!node) {
        if (i === 0 && this.registry.get('pp-riffle') !== state.hand) {
          this.registry.set('pp-riffle', state.hand)
          playSfx('roll')
        }
        node = this.makePacket(packet.id, home.x, home.y)
        this.packets.set(packet.id, node)
        playSfx('join', 90 + i * 36)
      }
      node.setVisible(true)
      node.setDepth((hot ? 18 : owner ? 8 : 3) + dest.y / 90 + i * 0.02)
      if (packet.card && !this.flipped.has(packet.id)) {
        this.flip(node, packet.card, this.flipped.size * 42)
        this.flipped.add(packet.id)
      }
      if (state.lastDuel && packet.takenBy === state.lastDuel.winner && !node.getData('glowed')) {
        node.setData('glowed', true)
        node.addAt(this.add.circle(0, 0, 48, 0xffe08a, 0.28), 0)
        const shakeKey = `${state.hand}-${state.log.length}`
        if (this.registry.get('pp-shake') !== shakeKey) {
          this.registry.set('pp-shake', shakeKey)
          this.cameras.main.shake(150, 0.006)
        }
      }
      const wager = node.getByName('wager') as Phaser.GameObjects.Text | null
      if (wager) wager.setText('')
      const num = node.getByName('num') as Phaser.GameObjects.Text | null
      num?.setVisible(!owner && !packet.card)
      node.setData('live', canPick.has(packet.id))
      node.setAlpha(fight ? (hot ? 1 : owner ? 0.22 : 0.12) : owner?.settled && owner.color !== state.chef ? 0.42 : 1)
      if (!node.getData('flipping')) node.setScale(hot ? z * 1.22 : z)
      const last = node.getData('dest') as { x: number; y: number } | undefined
      if (!last || Math.abs(last.x - dest.x) > 1 || Math.abs(last.y - dest.y) > 1) {
        node.setData('dest', dest)
        if (hot) playSfx('hop', owner?.color === state.chef ? 0 : 50)
        else if (owner) playSfx('hop')
        this.tweens.add({
          targets: node,
          x: dest.x,
          y: dest.y,
          duration: hot ? 480 : owner ? 420 : 160,
          ease: 'Cubic.out',
          onComplete: () => {
            if (hot) playSfx('land', owner?.color === state.chef ? 0 : 45)
          },
        })
      }
    })
  }

  private drawBets(state: PaquetState) {
    const box = this.layoutBox
    if (!box) return
    const z = this.zoom
    const fight = state.phase === 'cover' || state.phase === 'duel'
    state.players.forEach((player, i) => {
      const key = `chip-${player.color}`
      const existing = this.children.getByName(key) as Phaser.GameObjects.Container | null
      const hot = fight && (player.color === state.chef || player.color === state.challenger)
      if (player.bet <= 0 || hot) {
        existing?.destroy()
        return
      }
      const packet = state.packets.find((p) => p.takenBy === player.color)
      const packNode = packet ? this.packets.get(packet.id) : undefined
      const dest = packNode?.getData('dest') as { x: number; y: number } | undefined
      const seat = oval(i, 8, box.cx, box.cy, box.seatRx, box.seatRy)
      const home = dest ?? along(seat, -44 * z)
      const place = {
        x: home.x + Math.cos(seat.a) * -26 * z,
        y: home.y + Math.sin(seat.a) * -26 * z,
      }
      let node = existing
      if (!node) {
        node = this.add.container(place.x, place.y).setName(key)
        node.setData('place', place)
        const shadow = this.add.ellipse(6, 12, 78, 18, 0x000000, 0.32)
        const c3 = this.add.circle(-30, 5, 12, 0x8a5a12)
        const c2 = this.add.circle(-30, 1, 12, 0xd4a017)
        const c1 = this.add.circle(-30, -3, 12, 0xffe36a).setStrokeStyle(1.5, 0x3a2a00, 0.45)
        const plate = this.add.rectangle(10, 0, 78, 32, 0xffe36a).setStrokeStyle(2, 0x8a5a12)
        const amt = this.add
          .text(10, 0, formatLudo(player.bet), {
            fontFamily: 'Fredoka, Nunito, system-ui, sans-serif',
            fontSize: '15px',
            color: '#3a2a00',
            fontStyle: '800',
          })
          .setOrigin(0.5)
          .setName('amt')
        node.add([shadow, c3, c2, c1, plate, amt])
        node.setScale(0.45)
        this.tweens.add({
          targets: node,
          scale: z,
          duration: 280,
          ease: 'Back.out',
        })
      } else {
        const amt = node.getByName('amt') as Phaser.GameObjects.Text | null
        amt?.setText(formatLudo(player.bet))
        amt?.setFontSize(13 * Math.max(0.9, z))
        const last = node.getData('place') as { x: number; y: number } | undefined
        if (!last || Math.abs(last.x - place.x) > 1 || Math.abs(last.y - place.y) > 1) {
          node.setData('place', place)
          this.tweens.add({
            targets: node,
            x: place.x,
            y: place.y,
            duration: hot ? 480 : 280,
            ease: 'Cubic.out',
          })
        }
        if (!this.tweens.isTweening(node)) node.setScale(z)
      }
      node.setDepth(16)
      node.setAlpha(1)
      const pop = `${state.hand}-${player.color}-${player.bet}`
      if (this.registry.get(`pp-chip-${player.color}`) !== pop) {
        this.registry.set(`pp-chip-${player.color}`, pop)
        if (existing) {
          this.tweens.add({
            targets: node,
            scale: { from: z * 0.82, to: z },
            duration: 220,
            ease: 'Back.out',
          })
        }
      }
    })
  }

  private makePacket(id: number, x: number, y: number) {
    const node = this.add.container(x, y).setSize(CARD_W + 18, CARD_H + 18).setInteractive({ useHandCursor: true })
    const stack = [5, 2, 0].map((off, n) =>
      this.add
        .image(off * 0.3, -off * 0.24, 'card-back')
        .setName(`back-${n}`)
        .setDisplaySize(CARD_W - n * 1.5, CARD_H - n),
    )
    const num = this.add
      .text(0, 3, String(id + 1), {
        fontFamily: 'Fredoka, Nunito, system-ui, sans-serif',
        fontSize: '20px',
        color: '#f6de96',
        fontStyle: '800',
        stroke: '#4a0d1c',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setName('num')
    const face = this.add.image(0, 0, 'card-back').setName('face').setVisible(false).setDisplaySize(CARD_W, CARD_H)
    const wager = this.add
      .text(0, CARD_H * 0.42, '', {
        fontFamily: 'Nunito, system-ui, sans-serif',
        fontSize: '10px',
        color: '#ffe7a3',
        fontStyle: '800',
      })
      .setOrigin(0.5)
      .setName('wager')
    node.add([...stack, num, face, wager])
    node.on('pointerover', () => {
      if (!node.getData('live') || node.getData('flipping')) return
      node.setScale(this.zoom * 1.08)
    })
    node.on('pointerout', () => {
      if (node.getData('flipping')) return
      node.setScale(this.zoom)
    })
    node.on('pointerup', () => {
      if (!node.getData('live')) return
      playSfx('join')
      this.onPick(id)
    })
    return node
  }

  private flip(node: Phaser.GameObjects.Container, card: Card, delay = 0) {
    node.setData('flipping', true)
    const parked = node.getData('dest') as { x: number; y: number } | undefined
    if (parked) node.setPosition(parked.x, parked.y)
    const keep = Math.max(this.zoom, node.scaleY || this.zoom)
    this.tweens.killTweensOf(node)
    bakeCardFace(this, card)
    playSfx('land', delay)
    this.tweens.add({
      targets: node,
      scaleX: 0,
      duration: 150,
      onComplete: () => {
        ;(['back-0', 'back-1', 'back-2', 'num'] as const).forEach((name) => {
          const child = node.getByName(name) as Phaser.GameObjects.Image | Phaser.GameObjects.Text | null
          child?.setVisible(false)
        })
        const face = node.getByName('face') as Phaser.GameObjects.Image | null
        if (face) {
          face.setTexture(cardTex(card)).setDisplaySize(CARD_W, CARD_H).setVisible(true)
        }
        node.add(faceIndex(this, card))
        this.tweens.add({
          targets: node,
          scaleX: keep,
          scaleY: keep,
          duration: 180,
          ease: 'Back.out',
          onComplete: () => node.setData('flipping', false),
        })
      },
    })
  }
}
