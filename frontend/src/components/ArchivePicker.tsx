import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type WheelEvent,
} from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  AlertCircleIcon,
  Sad01Icon,
  CheckmarkCircle02Icon,
  FileUploadIcon,
  FolderArchiveIcon,
  HelpCircleIcon,
  Loading03Icon,
  FlushedIcon,
  RadioIcon,
  RefreshIcon,
  Tick02Icon,
  Happy01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import type { ArchiveSummary } from "@/api/archiveTypes"
import {
  archivedAssetUrl,
  graphicsAssetUrl,
  type RealtimeMatchMetadata,
} from "@/api/realtimeMatch"
import type { ReplayArchive } from "@/api/replay/replayTypes"
import { Button } from "@/components/ui/button"
import {
  ARCHIVE_PAGE_SIZE,
  presentArchive,
} from "@/components/archivePresentation"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

type ArchivePickerProps = {
  archives: ArchiveSummary[]
  page: number
  pageCount: number
  totalCount: number
  selectedId: string
  selectedArchive?: ArchiveSummary
  selectedArchivePage: number
  localArchive?: ReplayArchive
  liveMinute: number
  liveSecond: number
  busy: boolean
  refreshing: boolean
  archiveError?: string
  locale: string
  onSelectLive: () => void
  onSelectArchive: (matchId: string) => void
  onSelectLocalArchive: () => void
  onOpenLocalFile: () => void
  onDropLocalFile: (file: File) => void
  onRefresh: () => void
  onPageChange: (page: number) => void
}

export function ArchivePicker({
  archives,
  page,
  pageCount,
  totalCount,
  selectedId,
  selectedArchive,
  selectedArchivePage,
  localArchive,
  liveMinute,
  liveSecond,
  busy,
  refreshing,
  archiveError,
  locale,
  onSelectLive,
  onSelectArchive,
  onSelectLocalArchive,
  onOpenLocalFile,
  onDropLocalFile,
  onRefresh,
  onPageChange,
}: ArchivePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const wheelPageChangedAtRef = useRef(0)

  const selectedPresentation = useMemo(() => {
    if (!selectedId) return undefined
    if (selectedId.startsWith("local:") && localArchive) {
      return presentArchive(
        localArchive.summary,
        localArchive.metadata,
        locale,
        t("timeline.unknownTeam"),
        t("timeline.unknownDate")
      )
    }
    const archive =
      archives.find((candidate) => candidate.matchId === selectedId) ??
      selectedArchive
    return archive
      ? presentArchive(
          archive,
          undefined,
          locale,
          t("timeline.unknownTeam"),
          t("timeline.unknownDate")
        )
      : undefined
  }, [archives, localArchive, locale, selectedArchive, selectedId, t])

  const choose = (callback: () => void) => {
    callback()
    setOpen(false)
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onDropLocalFile(file)
  }

  const rangeStart = archives.length ? page * ARCHIVE_PAGE_SIZE + 1 : 0
  const rangeEnd = page * ARCHIVE_PAGE_SIZE + archives.length

  const changePage = (nextPage: number) => {
    const boundedPage = Math.max(0, Math.min(pageCount - 1, nextPage))
    if (boundedPage !== page) onPageChange(boundedPage)
  }

  const handleListWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) < 8) return
    const nextPage = Math.max(
      0,
      Math.min(pageCount - 1, page + (event.deltaY > 0 ? 1 : -1))
    )
    if (nextPage === page) return
    const now = performance.now()
    if (now - wheelPageChangedAtRef.current < 280) return
    wheelPageChangedAtRef.current = now
    changePage(nextPage)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && selectedId && !selectedId.startsWith("local:")) {
      changePage(selectedArchivePage)
    }
    setOpen(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        className={cn(
          "group flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs shadow-xs transition-colors outline-none hover:bg-input/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          dragging && "border-primary bg-primary/10 ring-2 ring-primary/20"
        )}
        aria-label={t("timeline.sourceLabel")}
        title={t("timeline.openArchiveHint")}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false)
        }}
        onDrop={handleDrop}
      >
        {busy ? (
          <HugeiconsIcon
            icon={Loading03Icon}
            className="size-3.5 shrink-0 animate-spin text-primary"
          />
        ) : selectedId ? (
          <HugeiconsIcon
            icon={FolderArchiveIcon}
            className="size-3.5 shrink-0 text-primary"
          />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-primary ring-2 ring-primary/20" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {dragging
            ? t("timeline.dropArchive")
            : selectedPresentation
              ? `${selectedPresentation.date} · ${selectedPresentation.home} ${selectedPresentation.homeGoals}:${selectedPresentation.awayGoals} ${selectedPresentation.away}`
              : t("timeline.liveMatch")}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="max-h-[min(34rem,calc(100svh-1rem))] w-[21.5rem] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0 shadow-2xl ring-1 ring-primary/25"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-muted/35 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h2 className="shrink-0 text-sm font-semibold">
              {t("timeline.archiveLibrary")}
            </h2>
            <p className="truncate text-[10px] text-muted-foreground">
              {t("timeline.archiveCount", { count: totalCount })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={refreshing}
            aria-label={
              refreshing ? t("timeline.refreshing") : t("timeline.refresh")
            }
            title={
              refreshing ? t("timeline.refreshing") : t("timeline.refresh")
            }
            onClick={onRefresh}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              className={cn(refreshing && "animate-spin")}
            />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("timeline.openLocalArchive")}
            title={t("timeline.openLocalArchive")}
            onClick={onOpenLocalFile}
          >
            <HugeiconsIcon icon={FileUploadIcon} />
          </Button>
        </div>

        <div className="shrink-0 space-y-1.5 border-b border-border/70 p-2">
          <SourceButton
            selected={!selectedId}
            icon={RadioIcon}
            title={t("timeline.liveMatch")}
            subtitle={t("timeline.liveClock", {
              time: `${liveMinute}:${String(liveSecond).padStart(2, "0")}`,
            })}
            onClick={() => choose(onSelectLive)}
          />
          {localArchive ? (
            <ArchiveButton
              archive={localArchive.summary}
              metadata={localArchive.metadata}
              locale={locale}
              selected={selectedId.startsWith("local:")}
              sourceLabel={t("timeline.localArchive")}
              indexLabel="L"
              onClick={() => choose(onSelectLocalArchive)}
            />
          ) : null}
        </div>

        <div
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-1.5"
          onWheel={handleListWheel}
        >
          {archives.length ? (
            archives.map((archive, index) => (
              <ArchiveButton
                key={archive.matchId}
                archive={archive}
                locale={locale}
                indexLabel={String(page * ARCHIVE_PAGE_SIZE + index + 1)}
                selected={selectedId === archive.matchId}
                onClick={() => choose(() => onSelectArchive(archive.matchId))}
              />
            ))
          ) : (
            <div className="px-3 py-7 text-center">
              <p className="font-medium text-foreground">
                {t("timeline.noArchives")}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t("timeline.noArchivesHint")}
              </p>
            </div>
          )}
        </div>

        {archiveError ? (
          <p
            role="alert"
            className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-3 py-1.5 text-[10px] text-destructive"
          >
            {archiveError}
          </p>
        ) : null}

        <div className="flex shrink-0 items-center gap-2 border-t border-border/70 bg-muted/25 px-3 py-2 text-[10px] text-muted-foreground tabular-nums">
          <span>
            {rangeStart}–{rangeEnd} / {totalCount}
          </span>
          <span className="ml-auto">
            {t("timeline.pageStatus", {
              page: page + 1,
              total: pageCount,
            })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={page === 0 || refreshing}
            aria-label={t("timeline.previousPage")}
            title={t("timeline.previousPage")}
            onClick={() => changePage(page - 1)}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={page >= pageCount - 1 || refreshing}
            aria-label={t("timeline.nextPage")}
            title={t("timeline.nextPage")}
            onClick={() => changePage(page + 1)}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SourceButton({
  selected,
  icon,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean
  icon: typeof RadioIcon
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        selected && "border-primary/60 bg-primary/8"
      )}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-[10px] text-muted-foreground tabular-nums">
          {subtitle}
        </span>
      </span>
      {selected ? (
        <HugeiconsIcon icon={Tick02Icon} className="size-4 text-primary" />
      ) : null}
    </button>
  )
}

function ArchiveButton({
  archive,
  metadata,
  locale,
  selected,
  sourceLabel,
  indexLabel,
  onClick,
}: {
  archive: ArchiveSummary
  metadata?: RealtimeMatchMetadata
  locale: string
  selected: boolean
  sourceLabel?: string
  indexLabel: string
  onClick: () => void
}) {
  const { t } = useTranslation()
  const item = presentArchive(
    archive,
    metadata,
    locale,
    t("timeline.unknownTeam"),
    t("timeline.unknownDate")
  )
  const resultLabel =
    item.result === "home-win"
      ? t("timeline.homeWin")
      : item.result === "away-win"
        ? t("timeline.awayWin")
        : t("timeline.draw")
  const homeWon = item.result === "home-win"
  const awayWon = item.result === "away-win"
  const playerResultLabel =
    item.playerResult === "win"
      ? t("timeline.playerWin")
      : item.playerResult === "draw"
        ? t("timeline.playerDraw")
        : item.playerResult === "loss"
          ? t("timeline.playerLoss")
          : t("timeline.resultUnknown")
  const competitionLogoUrl = metadata
    ? archivedAssetUrl(item.competitionLogoPath)
    : item.competitionUid != null
      ? graphicsAssetUrl("comp", item.competitionUid, "logo")
      : archivedAssetUrl(item.competitionLogoPath)
  const competitionPrimary = argbToCssColor(item.competitionPrimaryColour)
  const competitionLogoContent = (
    <>
      <span aria-hidden="true">{item.competitionName?.charAt(0) ?? ""}</span>
      {competitionLogoUrl ? (
        <img
          src={competitionLogoUrl}
          alt=""
          className="absolute inset-0 size-full object-contain"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
      ) : null}
    </>
  )

  return (
    <button
      type="button"
      className={cn(
        "group grid w-full grid-cols-[1.15rem_4.45rem_1.75rem_minmax(0,1fr)_1.25rem_1.5rem] items-center gap-1.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors outline-none hover:border-primary/35 hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        selected && "border-primary/60 bg-accent"
      )}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
    >
      <span className="text-center text-[10px] font-semibold text-muted-foreground tabular-nums group-hover:text-accent-foreground/70">
        {indexLabel}
      </span>

      <span className="min-w-0">
        <span className="block truncate text-[10px] font-medium text-foreground tabular-nums group-hover:text-accent-foreground">
          {item.date}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[9px] text-muted-foreground group-hover:text-accent-foreground/75">
          <HugeiconsIcon
            icon={archive.ended ? CheckmarkCircle02Icon : AlertCircleIcon}
            className={cn(
              "size-3 shrink-0",
              archive.ended ? "text-status-positive" : "text-status-warning"
            )}
          />
          <span className="truncate">
            {sourceLabel
              ? `${sourceLabel} · ${archive.ended ? t("timeline.completeArchive") : t("timeline.incompleteArchive")}`
              : archive.ended
                ? t("timeline.completeArchive")
                : t("timeline.incompleteArchive")}
          </span>
        </span>
      </span>

      {item.competitionName ? (
        <HoverCard>
          <HoverCardTrigger
            render={(
              <span
                className="relative flex size-7 items-center justify-center justify-self-center overflow-hidden text-[10px] font-bold"
                style={{ color: competitionPrimary ?? "var(--foreground)" }}
                aria-label={item.competitionName}
              />
            )}
          >
            {competitionLogoContent}
          </HoverCardTrigger>
          <HoverCardContent
            side="top"
            sideOffset={6}
            className="w-auto whitespace-nowrap px-2.5 py-1.5 font-medium"
          >
            {item.competitionName}
          </HoverCardContent>
        </HoverCard>
      ) : (
        <span className="relative flex size-7 items-center justify-center justify-self-center overflow-hidden text-[10px] font-bold">
          {competitionLogoContent}
        </span>
      )}

      <span className="min-w-0 space-y-0.5">
        <span
          className={cn(
            "flex min-w-0 items-center gap-1",
            item.result !== "draw" && !homeWon && "text-muted-foreground",
            "group-hover:text-accent-foreground"
          )}
        >
          <span className="w-3 shrink-0 text-[8px] text-muted-foreground group-hover:text-accent-foreground/70">
            {t("timeline.home")}
          </span>
          <span
            className={cn("truncate", homeWon && "font-semibold")}
            title={item.home}
          >
            {item.home}
          </span>
        </span>
        <span
          className={cn(
            "flex min-w-0 items-center gap-1",
            item.result !== "draw" && !awayWon && "text-muted-foreground",
            "group-hover:text-accent-foreground"
          )}
        >
          <span className="w-3 shrink-0 text-[8px] text-muted-foreground group-hover:text-accent-foreground/70">
            {t("timeline.away")}
          </span>
          <span
            className={cn("truncate", awayWon && "font-semibold")}
            title={item.away}
          >
            {item.away}
          </span>
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs font-medium text-foreground tabular-nums group-hover:text-accent-foreground">
        <span className={cn(homeWon && "font-bold")}>{item.homeGoals}</span>
        <span className={cn(awayWon && "font-bold")}>{item.awayGoals}</span>
      </span>

      <span
        className="flex items-center justify-center"
        title={playerResultLabel}
        aria-label={playerResultLabel}
        role="img"
      >
        <HugeiconsIcon
          icon={
            item.playerResult === "win"
              ? Happy01Icon
              : item.playerResult === "draw"
                ? FlushedIcon
                : item.playerResult === "loss"
                  ? Sad01Icon
                  : HelpCircleIcon
          }
          className={cn(
            "size-4",
            item.playerResult === "win" && "text-status-positive",
            item.playerResult === "draw" && "text-status-warning",
            item.playerResult === "loss" && "text-status-negative",
            item.playerResult === "unknown" && "text-muted-foreground"
          )}
        />
        <span className="sr-only">{resultLabel}</span>
      </span>
    </button>
  )
}

function argbToCssColor(value?: number) {
  if (value == null || !Number.isFinite(value) || value === 0) return undefined
  return `#${((value >>> 0) & 0x00ffffff).toString(16).padStart(6, "0")}`
}
