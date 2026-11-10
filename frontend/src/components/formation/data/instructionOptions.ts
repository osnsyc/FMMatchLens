/** Native UI options; source SHA-256 bc395f970c2bc63b9b666890f3d32d6eac90ef6565d638559c554f54d7c77f94. */
const instructionOptions = {
  opposition: {
    marking: {
      options: [
        {
          value: 0,
          state: "unselected",
          icon: "game-concepts/tight-marking-unselected",
        },
        {
          value: 1,
          state: "never",
          icon: "game-concepts/tight-marking-never",
        },
        {
          value: 2,
          state: "always",
          icon: "game-concepts/tight-marking-always",
        },
      ],
    },
    pressing: {
      options: [
        {
          value: 0,
          state: "unselected",
          icon: "game-concepts/trigger-press-unselected",
        },
        {
          value: 1,
          state: "never",
          icon: "game-concepts/trigger-press-never",
        },
        {
          value: 2,
          state: "always",
          icon: "game-concepts/trigger-press-always",
        },
      ],
    },
    tackling: {
      options: [
        {
          value: 0,
          state: "unselected",
          icon: "game-concepts/tackling-unselected",
        },
        {
          value: 1,
          state: "normal",
          icon: "game-concepts/tackling-normal",
        },
        {
          value: 2,
          state: "easy",
          icon: "game-concepts/tackling-easy",
        },
        {
          value: 3,
          state: "hard",
          icon: "game-concepts/tackling-hard",
        },
      ],
    },
    foot: {
      options: [
        {
          value: 0,
          state: "unselected",
          icon: "game-concepts/show-onto-unselected",
        },
        {
          value: 1,
          state: "leftfoot",
          icon: "game-concepts/show-onto-leftfoot",
        },
        {
          value: 2,
          state: "rightfoot",
          icon: "game-concepts/show-onto-rightfoot",
        },
        {
          value: 3,
          state: "weakfoot",
          icon: "game-concepts/show-onto-weakfoot",
        },
      ],
    },
  },
  instructionGroups: [
    {
      family: "team",
      group: "GoalkeeperDistributionSpeed",
      phase: 1,
      choices: [
        {
          id: 1936095309,
          symbol: "GKDistributionPaceSlow",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--speed--var-slow-pace-down",
        },
        {
          id: 842232368,
          symbol: "GKDistributionPaceNone",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--speed--var-balanced",
        },
        {
          id: 1380137303,
          symbol: "GKDistributionPaceQuick",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--speed--var-distrbute-quickly",
        },
      ],
    },
    {
      family: "team",
      group: "DefensiveLine",
      phase: 4,
      choices: [
        {
          id: 2003456321,
          symbol: "DefensiveLineMuchDeeper",
          icon: "tactic_icons/ti-oop-overview-defensive-line-var-much-lower",
        },
        {
          id: 807423041,
          symbol: "DefensiveLineDeeper",
          icon: "tactic_icons/ti-oop-overview-defensive-line-var-lower",
        },
        {
          id: 894978671,
          symbol: "DefensiveLineStandard",
          icon: "tactic_icons/ti-oop-overview-defensive-line-var-standard",
        },
        {
          id: 1329018200,
          symbol: "DefensiveLineHigherDefensiveLine",
          icon: "tactic_icons/ti-oop-overview-defensive-line-var-higher",
        },
        {
          id: 1735747406,
          symbol: "DefensiveLineMuchHigher",
          icon: "tactic_icons/ti-oop-overview-defensive-line-var-much-higher",
        },
      ],
    },
    {
      family: "team",
      group: "Tempo",
      phase: 0,
      choices: [
        {
          id: 1498756423,
          symbol: "MuchLowerTempo",
          icon: "tactic_icons/ip-tempo-var-much-lower",
        },
        {
          id: 1311996258,
          symbol: "LowerTempo",
          icon: "tactic_icons/ip-tempo-var-lower",
        },
        {
          id: 1496610426,
          symbol: "TempoNone",
          icon: "tactic_icons/ip-tempo-var-standard",
        },
        {
          id: 1345339954,
          symbol: "HigherTempo",
          icon: "tactic_icons/ip-tempo-var-higher",
        },
        {
          id: 543778113,
          symbol: "MuchHigherTempo",
          icon: "tactic_icons/ip-tempo-var-much-higher",
        },
      ],
    },
    {
      family: "team",
      group: "PressingTrap",
      phase: 10,
      choices: [
        {
          id: 1870092139,
          symbol: "PressingTrapIn",
          icon: "tactic_icons/ti-oop-overview-pressing-trap-var-trap-inside",
        },
        {
          id: 844782149,
          symbol: "PressingTrapNone",
          icon: "tactic_icons/ti-oop-overview-pressing-trap-var-standard",
        },
        {
          id: 1381658469,
          symbol: "PressingTrapOut",
          icon: "tactic_icons/ti-oop-overview-pressing-trap-var-trap-outside",
        },
      ],
    },
    {
      family: "team",
      group: "Tackling",
      phase: 4,
      choices: [
        {
          id: 896480825,
          symbol: "StayOnFeet",
          icon: "tactic_icons/ti-oop-overview-tackling-var-ease-of-tackles",
        },
        {
          id: 1297249398,
          symbol: "TacklingNone",
          icon: "tactic_icons/ti-oop-overview-tackling-var-standard",
        },
        {
          id: 1498428227,
          symbol: "GetStuckIn",
          icon: "tactic_icons/ti-oop-overview-tackling-var-tackle-harder",
        },
      ],
    },
    {
      family: "team",
      group: "CrossEngagement",
      phase: 5,
      choices: [
        {
          id: 1684615797,
          symbol: "CrossStop",
          icon: "tactic_icons/ti-oop-overview-crossing-engagement-variation-stop-crosses",
        },
        {
          id: 1097682775,
          symbol: "CrossEngagementNone",
          icon: "tactic_icons/ti-oop-overview-crossing-engagement-variation-standard",
        },
        {
          id: 1280010857,
          symbol: "CrossInvite",
          icon: "tactic_icons/ti-oop-overview-crossing-engagement-vari--a68d7c2a6d15",
        },
      ],
    },
    {
      family: "team",
      group: "AttackingWidth",
      phase: 0,
      choices: [
        {
          id: 1716541542,
          symbol: "SetupMuchNarrowerInPossession",
          icon: "tactic_icons/ip-team-width-var-much-more-narrow",
        },
        {
          id: 1111652208,
          symbol: "SetupNarrowerInPossession",
          icon: "tactic_icons/ip-team-width-var-more-narrow",
        },
        {
          id: 1951095402,
          symbol: "TeamWidthNone",
          icon: "tactic_icons/ip-team-width-var-standard",
        },
        {
          id: 1244744824,
          symbol: "SetupWiderInPossession",
          icon: "tactic_icons/ip-team-width-var-more-direct",
        },
        {
          id: 1347573861,
          symbol: "SetupMuchWiderInPossession",
          icon: "tactic_icons/ip-team-width-var-much-more-direct",
        },
      ],
    },
    {
      family: "team",
      group: "Crossing",
      phase: 3,
      choices: [
        {
          id: 1817334343,
          symbol: "CrossingNone",
          icon: "tactic_icons/ti-ip-final-third-cross-location-variation-mixed",
        },
        {
          id: 1649964405,
          symbol: "FloatCrosses",
          icon: "tactic_icons/ti-ip-final-third-cross-location-variation-near-post",
        },
        {
          id: 1850439286,
          symbol: "WhippedCrosses",
          icon: "tactic_icons/ti-ip-final-third-cross-location-variation-pull-back",
        },
        {
          id: 542589235,
          symbol: "LowCrosses",
          icon: "tactic_icons/ti-ip-final-third-cross-location-variation-centre",
        },
      ],
    },
    {
      family: "team",
      group: "AttackingTransition",
      phase: 0,
      choices: [
        {
          id: 1450726497,
          symbol: "AttackTransitionHoldShape",
          icon: "tactic_icons/ip-overview-attacking-transition-var-press",
        },
        {
          id: 846284410,
          symbol: "AttackingTransitionNone",
          icon: "tactic_icons/ip-overview-attacking-transition-var-standard",
        },
        {
          id: 1734436950,
          symbol: "AttackTransitionCounter",
          icon: "tactic_icons/ip-overview-attacking-transition-var-hold-shape",
        },
      ],
    },
    {
      family: "team",
      group: "PassReception",
      phase: 2,
      choices: [
        {
          id: 1817268034,
          symbol: "PassingReceptionIntoFeet",
          icon: "tactic_icons/ti-ip-progression-passing-reception-var-pass-to-feet",
        },
        {
          id: 1196126273,
          symbol: "PassReceptionNone",
          icon: "tactic_icons/ti-ip-progression-passing-reception-var-standard",
        },
        {
          id: 1987666283,
          symbol: "PassingReceptionIntoSpace",
          icon: "tactic_icons/ti-ip-progression-passing-reception-var-pass-into-space",
        },
      ],
    },
    {
      family: "team",
      group: "Patience",
      phase: 3,
      choices: [
        {
          id: 844190326,
          symbol: "HitEarlyCrosses",
          icon: "tactic_icons/ti-ip-final-third-patience-variation-hit-early-crosses",
        },
        {
          id: 1364668513,
          symbol: "PatienceNone",
          icon: "tactic_icons/ti-ip-final-third-patience-variation-standard",
        },
        {
          id: 1196903216,
          symbol: "WorkBallIntoBox",
          icon: "tactic_icons/ti-ip-final-third-patience-variation-work-ball-intothe-box",
        },
      ],
    },
    {
      family: "team",
      group: "TriggerPress",
      phase: 4,
      choices: [
        {
          id: 1500664391,
          symbol: "PressingIntensityMuchLower",
          icon: "tactic_icons/ti-oop-overview-trigger-press-var-much-less-often",
        },
        {
          id: 1985168495,
          symbol: "PressingIntensityLower",
          icon: "tactic_icons/ti-oop-overview-trigger-press-var-less-often",
        },
        {
          id: 1313689463,
          symbol: "PressingIntensityNone",
          icon: "tactic_icons/ti-oop-overview-trigger-press-var-standard",
        },
        {
          id: 2000905329,
          symbol: "PressingIntensityHigher",
          icon: "tactic_icons/ti-oop-overview-trigger-press-var-more-often",
        },
        {
          id: 1450268022,
          symbol: "PressingIntensityMuchHigher",
          icon: "tactic_icons/ti-oop-overview-trigger-press-var-much-more-often",
        },
      ],
    },
    {
      family: "team",
      group: "BuildUpStrategy",
      phase: 1,
      choices: [
        {
          id: 1365857100,
          symbol: "PlayThroughPress",
          icon: "tactic_icons/ti-ip-build-up-strategy-var-Play-through-press",
        },
        {
          id: 1732331848,
          symbol: "BuildUpStrategyNone",
          icon: "tactic_icons/ti-ip-build-up-strategy-var-standard",
        },
        {
          id: 1702379875,
          symbol: "BypassPress",
          icon: "tactic_icons/ti-ip-build-up-strategy-var-Bypass-press",
        },
      ],
    },
    {
      family: "team",
      group: "SupportingRunsSecondary",
      phase: 8,
      choices: [
        {
          id: 1700947790,
          symbol: "LookForOverlapNone",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-standard",
        },
        {
          id: 1496789296,
          symbol: "LookForOverlapLeft",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-overlap-left",
        },
        {
          id: 1484157235,
          symbol: "LookForOverlapRight",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-overlap-right",
        },
        {
          id: 809924212,
          symbol: "LookForOverlapBoth",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-overlap-both-flanks",
        },
      ],
    },
    {
      family: "team",
      group: "GoalkeeperDistributionTarget",
      phase: 12,
      choices: [
        {
          id: 1398290509,
          symbol: "GKDistributionTargetNone",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute-to--balanced",
        },
        {
          id: 1097811032,
          symbol: "GKDistributionTargetCentrebacks",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---7c10f06e5878",
        },
        {
          id: 1732531317,
          symbol: "GKDistributionTargetFullbacks",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---605270296e1d",
        },
        {
          id: 2001361485,
          symbol: "GKDistributionTargetFlanks",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---908d931ee4d0",
        },
        {
          id: 543316536,
          symbol: "GKDistributionTargetPlaymaker",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---6da04992343d",
        },
        {
          id: 1362654530,
          symbol: "GKDistributionTargetTargetman",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---92cede34f3c2",
        },
        {
          id: 1664119088,
          symbol: "GKDistributionTargetClearOppositionDefence",
          icon: "tactic_icons/ti-ip-build-up-gk-distrubition--distrubute---ad078c5e3897",
        },
      ],
    },
    {
      family: "team",
      group: "ShotsFromDistance",
      phase: 3,
      choices: [
        {
          id: 2021157752,
          symbol: "ShotsFromDistanceStayPatient",
          icon: "tactic_icons/ti-ip-final-third-shots-from-distance-variation-discourage",
        },
        {
          id: 1951290700,
          symbol: "ShotsFromDistanceNone",
          icon: "tactic_icons/ti-ip-final-third-shots-from-distance-variation-standard",
        },
        {
          id: 1799907952,
          symbol: "ShotsFromDistanceShootOnSight",
          icon: "tactic_icons/ti-ip-final-third-shots-from-distance-variation-encourage",
        },
      ],
    },
    {
      family: "team",
      group: "LineOfEngagement",
      phase: 4,
      choices: [
        {
          id: 927550517,
          symbol: "LineOfEngagementLow",
          icon: "tactic_icons/ti-oop-overview-line-of-engagement-var-low-block",
        },
        {
          id: 1196979288,
          symbol: "LineOfEngagementMid",
          icon: "tactic_icons/ti-oop-overview-line-of-engagement-var-mid-block",
        },
        {
          id: 2033537859,
          symbol: "LineOfEngagementHigh",
          icon: "tactic_icons/ti-oop-overview-line-of-engagement-var-high-press",
        },
      ],
    },
    {
      family: "team",
      group: "TimeWasting",
      phase: 0,
      choices: [
        {
          id: 1315850041,
          symbol: "WasteTimeLessOften",
          icon: "tactic_icons/ip-overview-time-wasting-type-never",
        },
        {
          id: 1329030726,
          symbol: "WasteTimeStandard",
          icon: "tactic_icons/ip-overview-time-wasting-type-sometimes",
        },
        {
          id: 1733973351,
          symbol: "WasteTimeMoreOften",
          icon: "tactic_icons/ip-overview-time-wasting-type-frequently",
        },
      ],
    },
    {
      family: "team",
      group: "PlayForSetPieces",
      phase: 0,
      choices: [
        {
          id: 1869829494,
          symbol: "PlayForSetPiecesNone",
          icon: "tactic_icons/ip-overview-play-for-set-pieces-var-keep-ball-in-play",
        },
        {
          id: 896626297,
          symbol: "PlayForSetPieces",
          icon: "tactic_icons/ip-overview-play-for-set-pieces-var-play-for-set-pieces",
        },
      ],
    },
    {
      family: "team",
      group: "DefensiveLineBehaviour",
      phase: 4,
      choices: [
        {
          id: 825575765,
          symbol: "HoldLine",
          icon: "tactic_icons/ti-oop-overview-defensive-line-secondary-step-up",
        },
        {
          id: 1397124971,
          symbol: "DefensiveLineSecondaryStandard",
          icon: "tactic_icons/ti-oop-overview-defensive-line-secondary-balanced",
        },
        {
          id: 1466132292,
          symbol: "DropOff",
          icon: "tactic_icons/ti-oop-overview-defensive-line-secondary-drop-off",
        },
      ],
    },
    {
      family: "team",
      group: "PassingDirectness",
      phase: 0,
      choices: [
        {
          id: 1985571685,
          symbol: "PassingStyleMuchShorter",
          icon: "tactic_icons/ip-directness-var-Much-shorter",
        },
        {
          id: 1146434657,
          symbol: "PassingStyleShorter",
          icon: "tactic_icons/ip-directness-var-Shorter",
        },
        {
          id: 1483944022,
          symbol: "PassingDirectnessNone",
          icon: "tactic_icons/ip-directness-var-standard--null",
        },
        {
          id: 2019653698,
          symbol: "PassingStyleMoreDirect",
          icon: "tactic_icons/ip-directness-var-more-direct",
        },
        {
          id: 1867543624,
          symbol: "PassingStyleMuchMoreDirect",
          icon: "tactic_icons/ip-directness-var-much-more-direct",
        },
      ],
    },
    {
      family: "team",
      group: "PreventShortGKDistribution",
      phase: 7,
      choices: [
        {
          id: 1667524405,
          symbol: "PreventShortGKDistributionNone",
          icon: "tactic_icons/ti-oop-overview-prevent-short-gk-distrubution-var-no",
        },
        {
          id: 1748587383,
          symbol: "PreventShortGKDistribution",
          icon: "tactic_icons/ti-oop-overview-prevent-short-gk-distrubution-var-yes",
        },
      ],
    },
    {
      family: "team",
      group: "DefensiveTransition",
      phase: 4,
      choices: [
        {
          id: 2001753209,
          symbol: "DefenceTransitionRegroup",
          icon: "tactic_icons/ti-oop-overview-defensive-transition-var-regroup",
        },
        {
          id: 1396068403,
          symbol: "DefensiveTransitionNone",
          icon: "tactic_icons/ti-oop-overview-defensive-transition-var-standard",
        },
        {
          id: 928473934,
          symbol: "DefenceTransitionCounterpress",
          icon: "tactic_icons/ti-oop-overview-defensive-transition-var-counter",
        },
      ],
    },
    {
      family: "team",
      group: "CreativeFreedom",
      phase: 0,
      choices: [
        {
          id: 1752052821,
          symbol: "BeMoreDisciplined",
          icon: "tactic_icons/ip-overview-creative-freedom-Property-1-more-disciplined",
        },
        {
          id: 1934574368,
          symbol: "CreativeFreedomNone",
          icon: "tactic_icons/ip-overview-creative-freedom-Property-1-Standard",
        },
        {
          id: 1297429358,
          symbol: "BeMoreExpressive",
          icon: "tactic_icons/ip-overview-creative-freedom-Property-1-more-expressive",
        },
      ],
    },
    {
      family: "team",
      group: "GoalKicks",
      phase: 1,
      choices: [
        {
          id: 1730167140,
          symbol: "GoalKicksShort",
          icon: "tactic_icons/ti-ip-build-up-goal-kicks-var-short",
        },
        {
          id: 1248478788,
          symbol: "GoalKicksNone",
          icon: "tactic_icons/ti-ip-build-up-goal-kicks-var-mixed",
        },
        {
          id: 1749839698,
          symbol: "GoalKicksLong",
          icon: "tactic_icons/ti-ip-build-up-goal-kicks-var-long",
        },
      ],
    },
    {
      family: "team",
      group: "Dribbling",
      phase: 9,
      choices: [
        {
          id: 946684999,
          symbol: "DribbleLess",
          icon: "tactic_icons/ti-ip-progression-dribbling-var-discourage",
        },
        {
          id: 1480870768,
          symbol: "DribblingNone",
          icon: "tactic_icons/ti-ip-progression-dribbling-var-standard",
        },
        {
          id: 1313559094,
          symbol: "RunAtDefence",
          icon: "tactic_icons/ti-ip-progression-dribbling-var-encourage",
        },
      ],
    },
    {
      family: "player",
      group: "0",
      phase: null,
      choices: [
        {
          id: 25,
          symbol: "PI_STAY_WIDER",
          icon: "tactic_icons/pi-ip-attacking-width-var-stay-wider",
        },
        {
          id: 26,
          symbol: "PI_PLAY_NARROW",
          icon: "tactic_icons/pi-ip-attacking-width-var-sit-narrower",
        },
        {
          id: 27,
          symbol: "PI_MOVE_INTO_CHANNELS",
          icon: "tactic_icons/pi-ip-attacking-width-var-move-into-channels",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-ip-attacking-width-var-standard--null",
        },
      ],
    },
    {
      family: "player",
      group: "1",
      phase: null,
      choices: [
        {
          id: 15,
          symbol: "PI_RUN_WIDE_WITH_BALL",
          icon: "tactic_icons/pi-ip-dribbling-direction-var-run-wide-with-ball",
        },
        {
          id: 16,
          symbol: "PI_CUT_INSIDE_WITH_BALL",
          icon: "tactic_icons/pi-ip-dribbling-direction-var-cut-inside-with-ball",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-ip-dribbling-direction-var-standard--null",
        },
      ],
    },
    {
      family: "player",
      group: "2",
      phase: null,
      choices: [
        {
          id: 13,
          symbol: "PI_DRIBBLE_MORE",
          icon: "tactic_icons/pi-ip-dribbling-frequency-var-dribble-more",
        },
        {
          id: 14,
          symbol: "PI_DRIBBLE_LESS",
          icon: "tactic_icons/pi-ip-dribbling-frequency-var-dribble-less",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-ip-dribbling-frequency-var-standard--null",
        },
      ],
    },
    {
      family: "player",
      group: "3",
      phase: null,
      choices: [
        {
          id: 22,
          symbol: "PI_GET_FORWARD_OFTEN",
          icon: "tactic_icons/pi-ip-forward-runs-var-make-more-runs",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-ip-forward-runs-var-standard--null",
        },
        {
          id: 23,
          symbol: "PI_HOLD_POSITION",
          icon: "tactic_icons/pi-ip-forward-runs-var-make-fewer-runs",
        },
      ],
    },
    {
      family: "player",
      group: "4",
      phase: null,
      choices: [
        {
          id: 24,
          symbol: "PI_ROAM_FROM_POSITION",
          icon: "tactic_icons/pi-ip-freedom-of-movement-var-freedom",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-ip-freedom-of-movement-var-follow",
        },
      ],
    },
    {
      family: "player",
      group: "6",
      phase: null,
      choices: [
        {
          id: 18,
          symbol: "PI_SHOOT_MORE",
          icon: "tactic_icons/pi-ip-shooting-var-shoot-more-often",
        },
        {
          id: 19,
          symbol: "PI_SHOOT_LESS",
          icon: "tactic_icons/pi-ip-shooting-var-shoot-less-often",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-ip-shooting-var-standard--nul",
        },
      ],
    },
    {
      family: "player",
      group: "5",
      phase: null,
      choices: [
        {
          id: 17,
          symbol: "PI_HOLD_UP_BALL",
          icon: "tactic_icons/pi-ip-hold-up-ball-var-yes",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-ip-hold-up-ball-var-no",
        },
      ],
    },
    {
      family: "player",
      group: "7",
      phase: null,
      choices: [
        {
          id: 1,
          symbol: "PI_PASS_SHORTER",
          icon: "tactic_icons/pi_ip-passing-strategy-much-shorter",
        },
        {
          id: 2,
          symbol: "PI_PASS_MORE_DIRECT",
          icon: "tactic_icons/pi_ip-passing-strategy-much-more-direct",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi_ip-passing-strategy-standard",
        },
      ],
    },
    {
      family: "player",
      group: "8",
      phase: null,
      choices: [
        {
          id: 3,
          symbol: "PI_TAKE_MORE_RISKS",
          icon: "tactic_icons/pi_ip-passing-risk-take-more-risks",
        },
        {
          id: 4,
          symbol: "PI_TAKE_FEWER_RISKS",
          icon: "tactic_icons/pi_ip-passing-risk-take-fewer-risks",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi_ip-passing-risk-balanced",
        },
      ],
    },
    {
      family: "player",
      group: "9",
      phase: null,
      choices: [
        {
          id: 10,
          symbol: "PI_CROSS_TO_FAR_POST",
          icon: "tactic_icons/ip-final-third-cross-strat-var-far-post",
        },
        {
          id: 11,
          symbol: "PI_CROSS_TO_CENTRE",
          icon: "tactic_icons/ip-final-third-cross-strat-var-centre",
        },
        {
          id: 9,
          symbol: "PI_CROSS_TO_NEAR_POST",
          icon: "tactic_icons/ip-final-third-cross-strat-var-near-post",
        },
        {
          id: 12,
          symbol: "PI_CROSS_TO_TARGET_MAN",
          icon: "tactic_icons/ip-final-third-cross-strat-var-target-forward",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/ip-final-third-cross-strat-var-standard",
        },
      ],
    },
    {
      family: "player",
      group: "10",
      phase: null,
      choices: [
        {
          id: 7,
          symbol: "PI_CROSS_FROM_DEEP",
          icon: "tactic_icons/pi_ip-cross-from-cross-from-deep",
        },
        {
          id: 8,
          symbol: "PI_CROSS_FROM_BYLINE",
          icon: "tactic_icons/pi_ip-cross-from-cross-from-byline",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi_ip-cross-from-balanced",
        },
      ],
    },
    {
      family: "player",
      group: "11",
      phase: null,
      choices: [
        {
          id: 29,
          symbol: "PI_HIGHER_PRESSING_INTENSITY",
          icon: "tactic_icons/pi-oop-trigger-press-var-more-often",
        },
        {
          id: 30,
          symbol: "PI_LOWER_PRESSING_INTENSITY",
          icon: "tactic_icons/pi-oop-trigger-press-var-less-often",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-oop-trigger-press-var-standard--null",
        },
      ],
    },
    {
      family: "player",
      group: "12",
      phase: null,
      choices: [
        {
          id: 33,
          symbol: "PI_MARK_TIGHTER",
          icon: "tactic_icons/pi-oop-marking-var-tigher",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-oop-marking-var-standard",
        },
      ],
    },
    {
      family: "player",
      group: "13",
      phase: null,
      choices: [
        {
          id: 31,
          symbol: "PI_GET_STUCK_IN",
          icon: "tactic_icons/pi-oop-tackling-var-tackle-harder",
        },
        {
          id: 32,
          symbol: "PI_STAY_ON_FEET",
          icon: "tactic_icons/pi-oop-tackling-var-ease-of-tackles",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-oop-tackling-var-standard",
        },
      ],
    },
    {
      family: "player",
      group: "14",
      phase: null,
      choices: [
        {
          id: 34,
          symbol: "PI_MARK_SPECIFIC_PLAYER",
          icon: "tactic_icons/pi-oop-marking-target-var-mark-specific-player",
        },
        {
          id: 35,
          symbol: "PI_MARK_SPECIFIC_POSITION",
          icon: "tactic_icons/pi-oop-marking-target-var-standard",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/pi-oop-marking-target-var-standard",
        },
      ],
    },
    {
      family: "player",
      group: "15",
      phase: null,
      choices: [
        {
          id: 36,
          symbol: "PI_ATTACK_BOX_SIDE_CENTRE",
          icon: "tactic_icons/type-lane-B",
        },
        {
          id: 37,
          symbol: "PI_ATTACK_BOX_SIDE_LEFT",
          icon: "tactic_icons/type-lane-A",
        },
        {
          id: 38,
          symbol: "PI_ATTACK_BOX_SIDE_RIGHT",
          icon: "tactic_icons/type-lane-C",
        },
        {
          id: 39,
          symbol: "PI_ATTACK_BOX_SIDE_NEAR_POST",
          icon: "tactic_icons/type-always-near",
        },
        {
          id: 40,
          symbol: "PI_ATTACK_BOX_SIDE_FAR_POST",
          icon: "tactic_icons/type-always-far",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/type-balanced",
        },
      ],
    },
    {
      family: "player",
      group: "16",
      phase: null,
      choices: [
        {
          id: 41,
          symbol: "PI_ATTACK_FRONT_ZONE",
          icon: "tactic_icons/type-zone-1",
        },
        {
          id: 42,
          symbol: "PI_ATTACK_BACK_ZONE",
          icon: "tactic_icons/type-zone-2",
        },
        {
          id: 0,
          symbol: "PI_NONE",
          icon: "tactic_icons/type-balanced-zone",
        },
      ],
    },
    {
      family: "team",
      group: "ProgressThrough",
      phase: 11,
      choices: [
        {
          id: 1800754547,
          symbol: "ProgressThroughNone",
          icon: "tactic_icons/ti-ip-progression-progress-through-balanced",
        },
        {
          id: 1465200750,
          symbol: "FocusPlayDownTheMiddle",
          icon: "tactic_icons/ti-ip-progression-progress-through-central",
        },
        {
          id: 2001548153,
          symbol: "FocusPlayDownTheLeftFlank",
          icon: "tactic_icons/ti-ip-progression-progress-through-left-flank",
        },
        {
          id: 1299723626,
          symbol: "FocusPlayDownTheRightFlank",
          icon: "tactic_icons/ti-ip-progression-progress-through-right-flank",
        },
        {
          id: 1849981002,
          symbol: "FocusPlayDownBothFlanks",
          icon: "tactic_icons/ti-ip-progression-progress-through-both-flanks",
        },
      ],
    },
    {
      family: "team",
      group: "SupportingRuns",
      phase: 8,
      choices: [
        {
          id: 1128871265,
          symbol: "LookForUnderlapNone",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-standard",
        },
        {
          id: 1246451814,
          symbol: "LookForUnderlapLeft",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-underlap-left",
        },
        {
          id: 894725200,
          symbol: "LookForUnderlapRight",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-underlap-right",
        },
        {
          id: 1848850767,
          symbol: "LookForUnderlapBoth",
          icon: "tactic_icons/ti-ip-progression-supporting-runs-var-underlap-both-flanks",
        },
      ],
    },
  ],
}
export default instructionOptions
