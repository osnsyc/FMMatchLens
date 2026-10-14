import { describe, expect, it, vi } from "vitest"
import { Container, Graphics, Texture } from "pixi.js"
import { MotionRenderer } from "@/components/tactical/shared/renderer/MotionRenderer"
import { PixiTacticalRenderer } from "@/components/tactical/PixiTacticalRenderer"

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
  it.each(["clear", "remove", "replace", "destroy"] as const)(
    "releases owned graphics contexts on %s",
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
        expect(contexts.every((context) => context.destroyed)).toBe(true)
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
      createElement: (tag: string) =>
        tag === "canvas"
          ? { getContext: () => ({}) }
          : { style: {}, setAttribute: vi.fn(), remove: vi.fn() },
    })
    vi.stubGlobal("getComputedStyle", () => ({ color: "" }))
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
