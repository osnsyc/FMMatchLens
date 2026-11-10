import instructionOptions from "./instructionOptions"

// Keys are public resource paths without the file extension.
const tacticIcons = {
  "game-concepts/show-onto-leftfoot": [32, 32, "webp"],
  "game-concepts/show-onto-rightfoot": [32, 32, "webp"],
  "game-concepts/show-onto-unselected": [32, 32, "webp"],
  "game-concepts/show-onto-weakfoot": [32, 32, "webp"],
  "game-concepts/tackling-easy": [32, 32, "webp"],
  "game-concepts/tackling-hard": [32, 32, "webp"],
  "game-concepts/tackling-normal": [32, 32, "webp"],
  "game-concepts/tackling-unselected": [32, 32, "webp"],
  "game-concepts/tight-marking-always": [32, 32, "webp"],
  "game-concepts/tight-marking-never": [32, 32, "webp"],
  "game-concepts/tight-marking-unselected": [32, 32, "webp"],
  "game-concepts/trigger-press-always": [32, 32, "webp"],
  "game-concepts/trigger-press-never": [32, 32, "webp"],
  "game-concepts/trigger-press-unselected": [32, 32, "webp"],
  "tactic_icons/ip-directness-var-Much-shorter": [124, 72, "webp"],
  "tactic_icons/ip-directness-var-Shorter": [124, 72, "webp"],
  "tactic_icons/ip-directness-var-more-direct": [124, 72, "webp"],
  "tactic_icons/ip-directness-var-much-more-direct": [124, 72, "webp"],
  "tactic_icons/ip-directness-var-standard--null": [124, 72, "webp"],
  "tactic_icons/ip-final-third-cross-strat-var-centre": [124, 72, "webp"],
  "tactic_icons/ip-final-third-cross-strat-var-far-post": [124, 72, "webp"],
  "tactic_icons/ip-final-third-cross-strat-var-near-post": [124, 72, "webp"],
  "tactic_icons/ip-final-third-cross-strat-var-standard": [124, 72, "webp"],
  "tactic_icons/ip-final-third-cross-strat-var-target-forward": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-attacking-transition-var-hold-shape": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-attacking-transition-var-press": [124, 72, "webp"],
  "tactic_icons/ip-overview-attacking-transition-var-standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-creative-freedom-Property-1-Standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-creative-freedom-Property-1-more-disciplined": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-creative-freedom-Property-1-more-expressive": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-play-for-set-pieces-var-keep-ball-in-play": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-play-for-set-pieces-var-play-for-set-pieces": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ip-overview-time-wasting-type-frequently": [124, 72, "webp"],
  "tactic_icons/ip-overview-time-wasting-type-never": [124, 72, "webp"],
  "tactic_icons/ip-overview-time-wasting-type-sometimes": [124, 72, "webp"],
  "tactic_icons/ip-team-width-var-more-direct": [124, 72, "webp"],
  "tactic_icons/ip-team-width-var-more-narrow": [124, 72, "webp"],
  "tactic_icons/ip-team-width-var-much-more-direct": [124, 72, "webp"],
  "tactic_icons/ip-team-width-var-much-more-narrow": [124, 72, "webp"],
  "tactic_icons/ip-team-width-var-standard": [124, 72, "webp"],
  "tactic_icons/ip-tempo-var-higher": [124, 72, "webp"],
  "tactic_icons/ip-tempo-var-lower": [124, 72, "webp"],
  "tactic_icons/ip-tempo-var-much-higher": [124, 72, "webp"],
  "tactic_icons/ip-tempo-var-much-lower": [124, 72, "webp"],
  "tactic_icons/ip-tempo-var-standard": [124, 72, "webp"],
  "tactic_icons/pi_ip-cross-from-balanced": [124, 72, "webp"],
  "tactic_icons/pi_ip-cross-from-cross-from-byline": [124, 72, "webp"],
  "tactic_icons/pi_ip-cross-from-cross-from-deep": [124, 72, "webp"],
  "tactic_icons/pi_ip-passing-risk-balanced": [124, 72, "webp"],
  "tactic_icons/pi_ip-passing-risk-take-fewer-risks": [124, 72, "webp"],
  "tactic_icons/pi_ip-passing-risk-take-more-risks": [124, 72, "webp"],
  "tactic_icons/pi_ip-passing-strategy-much-more-direct": [124, 72, "webp"],
  "tactic_icons/pi_ip-passing-strategy-much-shorter": [124, 72, "webp"],
  "tactic_icons/pi_ip-passing-strategy-standard": [124, 72, "webp"],
  "tactic_icons/pi-ip-attacking-width-var-move-into-channels": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/pi-ip-attacking-width-var-sit-narrower": [124, 72, "webp"],
  "tactic_icons/pi-ip-attacking-width-var-standard--null": [124, 72, "webp"],
  "tactic_icons/pi-ip-attacking-width-var-stay-wider": [124, 72, "webp"],
  "tactic_icons/pi-ip-dribbling-direction-var-cut-inside-with-ball": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/pi-ip-dribbling-direction-var-run-wide-with-ball": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/pi-ip-dribbling-direction-var-standard--null": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/pi-ip-dribbling-frequency-var-dribble-less": [124, 72, "webp"],
  "tactic_icons/pi-ip-dribbling-frequency-var-dribble-more": [124, 72, "webp"],
  "tactic_icons/pi-ip-dribbling-frequency-var-standard--null": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/pi-ip-forward-runs-var-make-fewer-runs": [124, 72, "webp"],
  "tactic_icons/pi-ip-forward-runs-var-make-more-runs": [124, 72, "webp"],
  "tactic_icons/pi-ip-forward-runs-var-standard--null": [124, 72, "webp"],
  "tactic_icons/pi-ip-freedom-of-movement-var-follow": [124, 72, "webp"],
  "tactic_icons/pi-ip-freedom-of-movement-var-freedom": [124, 72, "webp"],
  "tactic_icons/pi-ip-hold-up-ball-var-no": [124, 72, "webp"],
  "tactic_icons/pi-ip-hold-up-ball-var-yes": [124, 72, "webp"],
  "tactic_icons/pi-ip-shooting-var-shoot-less-often": [124, 72, "webp"],
  "tactic_icons/pi-ip-shooting-var-shoot-more-often": [124, 72, "webp"],
  "tactic_icons/pi-ip-shooting-var-standard--nul": [124, 72, "webp"],
  "tactic_icons/pi-oop-marking-target-var-mark-specific-player": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/pi-oop-marking-target-var-standard": [124, 72, "webp"],
  "tactic_icons/pi-oop-marking-var-standard": [124, 72, "webp"],
  "tactic_icons/pi-oop-marking-var-tigher": [124, 72, "webp"],
  "tactic_icons/pi-oop-tackling-var-ease-of-tackles": [124, 72, "webp"],
  "tactic_icons/pi-oop-tackling-var-standard": [124, 72, "webp"],
  "tactic_icons/pi-oop-tackling-var-tackle-harder": [124, 72, "webp"],
  "tactic_icons/pi-oop-trigger-press-var-less-often": [124, 72, "webp"],
  "tactic_icons/pi-oop-trigger-press-var-more-often": [124, 72, "webp"],
  "tactic_icons/pi-oop-trigger-press-var-standard--null": [124, 72, "webp"],
  "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute-to--balanced": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---ad078c5e3897": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---7c10f06e5878": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---908d931ee4d0": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---605270296e1d": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---6da04992343d": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---92cede34f3c2": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--speed--var-balanced": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--speed--var-distrbute-quickly": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-gk-distrubition--speed--var-slow-pace-down": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-goal-kicks-var-long": [124, 72, "webp"],
  "tactic_icons/ti-ip-build-up-goal-kicks-var-mixed": [124, 72, "webp"],
  "tactic_icons/ti-ip-build-up-goal-kicks-var-short": [124, 72, "webp"],
  "tactic_icons/ti-ip-build-up-strategy-var-Bypass-press": [124, 72, "webp"],
  "tactic_icons/ti-ip-build-up-strategy-var-Play-through-press": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-build-up-strategy-var-standard": [124, 72, "webp"],
  "tactic_icons/ti-ip-final-third-cross-location-variation-centre": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-cross-location-variation-mixed": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-cross-location-variation-near-post": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-cross-location-variation-pull-back": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-patience-variation-hit-early-crosses": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-patience-variation-standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-patience-variation-work-ball-intothe-box": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-shots-from-distance-variation-discourage": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-shots-from-distance-variation-encourage": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-final-third-shots-from-distance-variation-standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-dribbling-var-discourage": [124, 72, "webp"],
  "tactic_icons/ti-ip-progression-dribbling-var-encourage": [124, 72, "webp"],
  "tactic_icons/ti-ip-progression-dribbling-var-standard": [124, 72, "webp"],
  "tactic_icons/ti-ip-progression-passing-reception-var-pass-into-space": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-passing-reception-var-pass-to-feet": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-passing-reception-var-standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-progress-through-balanced": [124, 72, "webp"],
  "tactic_icons/ti-ip-progression-progress-through-both-flanks": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-progress-through-central": [124, 72, "webp"],
  "tactic_icons/ti-ip-progression-progress-through-left-flank": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-progress-through-right-flank": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-supporting-runs-var-overlap-both-flanks": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-supporting-runs-var-overlap-left": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-supporting-runs-var-overlap-right": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-supporting-runs-var-standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-supporting-runs-var-underlap-both-flanks": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-supporting-runs-var-underlap-left": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-ip-progression-supporting-runs-var-underlap-right": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-crossing-engagement-vari--a68d7c2a6d15": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-crossing-engagement-variation-standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-crossing-engagement-variation-stop-crosses": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-line-secondary-balanced": [
    64,
    52,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-line-secondary-drop-off": [
    64,
    52,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-line-secondary-step-up": [
    64,
    52,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-line-var-higher": [124, 72, "webp"],
  "tactic_icons/ti-oop-overview-defensive-line-var-lower": [124, 72, "webp"],
  "tactic_icons/ti-oop-overview-defensive-line-var-much-higher": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-line-var-much-lower": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-line-var-standard": [124, 72, "webp"],
  "tactic_icons/ti-oop-overview-defensive-transition-var-counter": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-transition-var-regroup": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-defensive-transition-var-standard": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-line-of-engagement-var-high-press": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-line-of-engagement-var-low-block": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-line-of-engagement-var-mid-block": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-pressing-trap-var-standard": [124, 72, "webp"],
  "tactic_icons/ti-oop-overview-pressing-trap-var-trap-inside": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-pressing-trap-var-trap-outside": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-prevent-short-gk-distrubution-var-no": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-prevent-short-gk-distrubution-var-yes": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-tackling-var-ease-of-tackles": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-tackling-var-standard": [124, 72, "webp"],
  "tactic_icons/ti-oop-overview-tackling-var-tackle-harder": [124, 72, "webp"],
  "tactic_icons/ti-oop-overview-trigger-press-var-less-often": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-trigger-press-var-more-often": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-trigger-press-var-much-less-often": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-trigger-press-var-much-more-often": [
    124,
    72,
    "webp",
  ],
  "tactic_icons/ti-oop-overview-trigger-press-var-standard": [124, 72, "webp"],
  "tactic_icons/type-always-far": [124, 72, "webp"],
  "tactic_icons/type-always-near": [124, 72, "webp"],
  "tactic_icons/type-balanced": [124, 72, "webp"],
  "tactic_icons/type-balanced-zone": [124, 72, "webp"],
  "tactic_icons/type-lane-A": [124, 72, "webp"],
  "tactic_icons/type-lane-B": [124, 72, "webp"],
  "tactic_icons/type-lane-C": [124, 72, "webp"],
  "tactic_icons/type-zone-1": [124, 72, "webp"],
  "tactic_icons/type-zone-2": [124, 72, "webp"],
} satisfies Record<string, [number, number, "png" | "webp"]>

export type TacticalIconName = keyof typeof tacticIcons

export function instructionIcon(
  family: "team" | "player",
  id: number | undefined
) {
  const group = instructionOptions.instructionGroups.find(
    (group) =>
      group.family === family &&
      group.choices.some((choice) => choice.id === id)
  )
  return group?.choices.find((choice) => choice.id === id)?.icon as
    TacticalIconName | undefined
}

export function tacticalIcon(name: TacticalIconName) {
  const icon = tacticIcons[name]
  if (!icon) return undefined
  const [width, height, extension] = icon
  const file = `${name}.${extension}`
  return { width, height, file, url: `${import.meta.env.BASE_URL}${file}` }
}
