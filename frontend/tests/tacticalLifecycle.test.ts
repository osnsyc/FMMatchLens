import { describe, expect, it, vi } from "vitest"
import { Container, Graphics, Sprite, Texture } from "pixi.js"
import { MotionRenderer } from "@/components/tactical/shared/renderer/MotionRenderer"
import { PixiTacticalRenderer } from "@/components/tactical/PixiTacticalRenderer"
import type { TacticalPlayback } from "@/components/tactical/playback/core/types"

function motionRenderer() {
  return new MotionRenderer(100, 100, Texture.EMPTY, {
    home: 0xff0000,
    away: 0x0000ff,
    foreground: 0xffffff,
  })
}

function addPlayer(renderer: MotionRenderer, playerId = 1) {
  renderer.renderFrame({
    tick: playerId,
    players: [
      {
        playerId,
        team: "home",
        x: 50,
        y: 50,
        velocityXPerTick: 0,
        velocityYPerTick: 0,
      },
    ],
  })
  const playerLayer = renderer.container.children[0] as Container
  const marker = playerLayer.children[0] as Container
  const contexts = marker.children
    .filter((child): child is Graphics => child instanceof Graphics)
    .map((graphic) => graphic.context)
  expect(contexts).toHaveLength(2)
  return { marker, contexts, playerLayer }
}

describe("motion renderer resource lifecycle with real Pixi objects", () => {
  it("updates existing and new marker sizes on resize and preserves ball elevation", () => {
    const renderer = motionRenderer()
    try {
      const { marker } = addPlayer(renderer)
      expect(marker.scale.x).toBeCloseTo(14 / 20)
      renderer.resize(800, 400)
      expect(marker.scale.x).toBeCloseTo(18 / 20)
      const frame = {
        tick: 2,
        players: [],
        ball: { x: 50, y: 50, zCentimeters: 300 },
      }
      renderer.renderFrame(frame)
      const ball = renderer.container.children[1] as Sprite
      expect(ball.width).toBeCloseTo(18 * 0.6 * (1 + 300 / 900))
      renderer.resize(600, 300)
      expect(ball.width).toBeCloseTo(15 * 0.6 * (1 + 300 / 900))
      const next = addPlayer(renderer, 2).marker
      expect(next.scale.x).toBeCloseTo(15 / 20)
    } finally {
      renderer.destroy()
    }
  })

  it.each(["clear", "remove", "replace", "destroy"] as const)(
    "releases unused graphics contexts on %s",
    (action) => {
      const renderer = motionRenderer()
      const { marker, contexts, playerLayer } = addPlayer(renderer)
      try {
        if (action === "clear") renderer.clear()
        else if (action === "remove")
          renderer.renderFrame({ tick: 2, players: [] })
        else if (action === "replace") addPlayer(renderer, 2)
        else renderer.destroy()
        expect(marker.destroyed).toBe(true)
        expect(contexts.every((context) => context.destroyed)).toBe(
          action !== "replace"
        )
        if (action !== "destroy")
          expect(playerLayer.children).toHaveLength(
            action === "replace" ? 1 : 0
          )
        expect(Texture.EMPTY.destroyed).toBe(false)
      } finally {
        if (action !== "destroy") renderer.destroy()
      }
    }
  )

  it("shares geometry and keeps it alive until the last player is removed", () => {
    const renderer = motionRenderer()
    try {
      const { contexts, playerLayer } = addPlayer(renderer)
      const player = {
        team: "home" as const,
        x: 50,
        y: 50,
        velocityXPerTick: 0,
        velocityYPerTick: 0,
      }
      renderer.renderFrame({
        tick: 2,
        players: [
          { ...player, playerId: 1 },
          { ...player, playerId: 2 },
        ],
      })
      const second = playerLayer.children[1] as Container
      const shared = second.children
        .filter((child): child is Graphics => child instanceof Graphics)
        .map((graphic) => graphic.context)
      expect(shared).toEqual(contexts)
      renderer.renderFrame({ tick: 3, players: [{ ...player, playerId: 2 }] })
      expect(contexts.every((context) => !context.destroyed)).toBe(true)
      renderer.updateAppearance({ home: 0x00ff00, away: 0, foreground: 0 })
      expect(contexts.every((context) => context.destroyed)).toBe(true)
      const updated = second.children
        .filter((child): child is Graphics => child instanceof Graphics)
        .map((graphic) => graphic.context)
      renderer.clear()
      expect(updated.every((context) => context.destroyed)).toBe(true)
    } finally {
      renderer.destroy()
    }
  })

  it("releases every marker context across 100 clear and recreate cycles", () => {
    const renderer = motionRenderer()
    try {
      for (let i = 0; i < 100; i++) {
        const { contexts, playerLayer } = addPlayer(renderer, i)
        renderer.clear()
        expect(playerLayer.children).toHaveLength(0)
        expect(contexts.every((context) => context.destroyed)).toBe(true)
      }
      expect(Texture.EMPTY.destroyed).toBe(false)
    } finally {
      renderer.destroy()
    }
  })
})

describe("parallel live overlays", () => {
  it("keeps independent toggles and shares live, playback, suspension and cleanup behavior", () => {
    const layer = () => ({
      setEnabled: vi.fn(),
      renderFrame: vi.fn(),
      clear: vi.fn(),
    })
    const pitchControl = layer()
    const convexHull = layer()
    const playback = {
      active: false,
      updatePlayback: (value: TacticalPlayback | null) => {
        playback.active = value != null
        return true
      },
    }
    // Exercise compositor lifecycle methods without a GPU or live source.
    const renderer: PixiTacticalRenderer = Object.assign(
      Object.create(PixiTacticalRenderer.prototype),
      {
        liveMode: false,
        panelActive: true,
        pitchControlEnabled: false,
        convexHullEnabled: false,
        pitchControlRenderer: pitchControl,
        convexHullRenderer: convexHull,
        playbackRenderer: playback,
        motionRenderer: {
          container: { visible: false },
          clear: vi.fn(),
          renderFrame: vi.fn(),
        },
        markerReveals: new Map(),
        scheduler: {
          removeTask: vi.fn(),
          suspend: vi.fn(),
          invalidate: vi.fn(),
        },
        setBaseLayersVisible: vi.fn(),
        scheduleAnimationFrame: vi.fn(),
      }
    )
    const expectEnabled = (pitch: boolean, hull: boolean) => {
      expect(pitchControl.setEnabled).toHaveBeenLastCalledWith(pitch)
      expect(convexHull.setEnabled).toHaveBeenLastCalledWith(hull)
    }
    renderer.setPitchControlEnabled(true)
    renderer.setConvexHullEnabled(true)
    expectEnabled(false, false)
    renderer.setLiveMode(true)
    expectEnabled(true, true)
    renderer.setPitchControlEnabled(false)
    expectEnabled(false, true)
    renderer.setPitchControlEnabled(true)
    renderer.updatePlayback({
      id: "test",
      team: "home",
      range: { startTick: 0, endTick: 0 },
      frames: [{ tick: 0, players: [] }],
      overlays: [],
    })
    expectEnabled(false, false)
    renderer.setConvexHullEnabled(false)
    renderer.setConvexHullEnabled(true)
    expectEnabled(false, false)
    renderer.updatePlayback(null)
    expectEnabled(true, true)
    const frame = { tick: 1, players: [] }
    renderer.renderMotionFrame(frame)
    expect(pitchControl.renderFrame).toHaveBeenLastCalledWith(frame)
    expect(convexHull.renderFrame).toHaveBeenLastCalledWith(frame)
    renderer.clearLiveOverlays()
    expect(pitchControl.clear).toHaveBeenCalledTimes(1)
    expect(convexHull.clear).toHaveBeenCalledTimes(1)
    renderer.setPanelActive(false)
    expectEnabled(false, false)
    expect(pitchControl.clear).toHaveBeenCalledTimes(2)
    expect(convexHull.clear).toHaveBeenCalledTimes(2)
    renderer.setPanelActive(true)
    expectEnabled(true, true)
    renderer.setLiveMode(false)
    expectEnabled(false, false)
    expect(pitchControl.clear).toHaveBeenCalledTimes(3)
    expect(convexHull.clear).toHaveBeenCalledTimes(3)
  })
})

describe("event reveal suspension", () => {
  it("resumes an interrupted reveal and returns to an idle scheduler", () => {
    let id = 0
    const callbacks = new Map<number, FrameRequestCallback>()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback)
      return id
    })
    vi.stubGlobal("cancelAnimationFrame", (key: number) => {
      callbacks.delete(key)
    })
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) })
    vi.stubGlobal("document", {
      documentElement: { appendChild: vi.fn() },
      createElement: (tag: string) =>
        tag === "canvas"
          ? { getContext: () => ({}) }
          : { style: {}, setAttribute: vi.fn(), remove: vi.fn() },
    })
    vi.stubGlobal("getComputedStyle", () => ({
      color: "",
      fontFamily: "sans-serif",
      getPropertyValue: () => "",
    }))
    const container = new Container()
    const record = {
      container,
      point: { id: "event" },
      revealProgress: 0.4,
      historical: false,
    }
    // Use real Pixi containers and compositor methods, with a fake GPU backend.
    const renderer = Object.assign(
      Reflect.construct(PixiTacticalRenderer, [
        { render: vi.fn(), destroy: vi.fn() },
        { appendChild: vi.fn() },
        100,
        100,
        { homeColor: "red", awayColor: "blue", tokens: {} },
        Texture.EMPTY,
        () => "",
      ]),
      {
        markerReveals: new Map([[record, { startedAt: 0 }]]),
        trajectoryByEventId: new Map(),
        syncShotChainReveal: vi.fn(),
        applyMarkerScale: vi.fn(),
      }
    )
    try {
      renderer.scheduleAnimationFrame()
      expect(callbacks.size).toBe(1)
      renderer.setPanelActive(false)
      expect(callbacks.size).toBe(0)
      expect(record.revealProgress).toBe(0.4)
      renderer.setPanelActive(true)
      renderer.setPanelActive(true)
      renderer.animateMarkerVisibility(record, true)
      expect(callbacks.size).toBe(1)
      const [key, callback] = [...callbacks][0]
      callbacks.delete(key)
      callback(1000)
      expect(record.revealProgress).toBe(1)
      expect(renderer.markerReveals.size).toBe(0)
      expect(callbacks.size).toBe(0)
      expect(renderer.scheduler.activeRAF).toBe(0)
    } finally {
      renderer.destroy()
      container.destroy()
      vi.unstubAllGlobals()
    }
  })
})
