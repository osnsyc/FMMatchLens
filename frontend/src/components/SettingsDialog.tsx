import { Fragment, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Dialog } from "@base-ui/react/dialog"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Settings01Icon,
  Cancel01Icon,
  BinocularsIcon,
  FullScreenIcon,
  ArrowShrinkIcon,
  CommandIcon,
  PaletteIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { ThemeSchemeIcon } from "@/components/ThemeToggle"
import { Switch } from "@/components/ui/switch"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { changeLanguage } from "@/i18n"
import {
  appShortcuts,
  bindingError,
  keyboardBinding,
  type AppShortcut,
} from "@/lib/appShortcuts"
import {
  defaultAppSettings,
  toolbarItems,
  updateAppSettings,
  useAppSettings,
} from "@/lib/appSettings"

function ShortcutKeys({ value, empty }: { value: string; empty: string }) {
  const keys = value.endsWith("+")
    ? [...value.slice(0, -1).split("+").filter(Boolean), "+"]
    : value.split("+")
  return (
    <KbdGroup className="flex-wrap justify-center">
      {value ? (
        keys.map((key, index) => (
          <Fragment key={`${key}-${index}`}>
            {index > 0 && (
              <span
                aria-hidden="true"
                className="text-[10px] text-muted-foreground"
              >
                +
              </span>
            )}
            <Kbd>{key}</Kbd>
          </Fragment>
        ))
      ) : (
        <Kbd>{empty}</Kbd>
      )}
    </KbdGroup>
  )
}

export function SettingsDialog() {
  const { t, i18n } = useTranslation()
  const currentLanguage = i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en"
  const settings = useAppSettings()
  const reducedMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AppShortcut["id"] | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<AppShortcut["id"] | "reserved" | null>(
    null
  )
  const errorMessage =
    error === "reserved"
      ? t("settings.reservedShortcut")
      : error
        ? t("settings.shortcutConflict", {
            action: t(appShortcuts.find((item) => item.id === error)!.labelKey),
          })
        : ""
  const editorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!editing) return
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !editorRef.current?.contains(event.target)
      ) {
        setEditing(null)
        setError(null)
      }
    }
    document.addEventListener("pointerdown", dismiss, true)
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setEditing(null)
      setError(null)
    }
    document.addEventListener("keydown", dismissOnEscape, true)
    return () => {
      document.removeEventListener("pointerdown", dismiss, true)
      document.removeEventListener("keydown", dismissOnEscape, true)
    }
  }, [editing])
  const labels = {
    tour: t("exploreTour.start"),
    fullscreen: t("shortcuts.fullscreen"),
    shortcuts: t("shortcuts.title"),
    appearance: t("appearance.title"),
    language: t("common.language"),
  }
  const saveBinding = (id: AppShortcut["id"], binding: string) => {
    const conflict = bindingError(binding, id, settings.shortcuts)
    if (conflict) {
      setError(conflict)
      return
    }
    updateAppSettings({
      ...settings,
      shortcuts: { ...settings.shortcuts, [id]: binding },
    })
    setEditing(null)
    setError(null)
  }
  const columns = [appShortcuts.slice(0, 5), appShortcuts.slice(5)]
  const previewIcon = (icon: typeof Settings01Icon, label: string) => (
    <span
      title={label}
      aria-label={label}
      role="img"
      className="grid size-7 shrink-0 place-items-center rounded-md text-foreground"
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.6} />
    </span>
  )
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        setEditing(null)
        setError(null)
      }}
    >
      <Dialog.Trigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t("settings.title")}
            title={t("settings.title")}
          />
        }
      >
        <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.6} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup
          data-app-settings-dialog
          className="fixed top-1/2 left-1/2 z-[121] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[900px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl transition-[opacity,scale] duration-200 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none sm:w-[calc(100%-3rem)]"
        >
          <header className="flex shrink-0 items-center justify-between px-6 pt-5 pb-4">
            <Dialog.Title className="flex items-center gap-2 font-heading text-lg font-semibold">
              <HugeiconsIcon icon={Settings01Icon} size={20} />
              {t("settings.title")}
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("common.close")}
                />
              }
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            {t("settings.description")}
          </Dialog.Description>
          <div className="grid min-h-0 gap-4 overflow-y-auto px-6 pb-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="grid content-start gap-4">
              <section className="space-y-4 rounded-2xl border border-border/60 bg-background/45 p-4">
                <h2 className="font-heading text-sm font-semibold text-foreground">
                  {t("settings.general")}
                </h2>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("settings.interfaceLanguage")}</span>
                  <Select
                    value={currentLanguage}
                    onValueChange={(value) => {
                      if (value === "en" || value === "zh-CN")
                        void changeLanguage(value)
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("common.language")}
                      className="w-28"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent positionerClassName="z-[130]">
                      <SelectItem value="zh-CN">
                        {t("common.chinese")}
                      </SelectItem>
                      <SelectItem value="en">{t("common.english")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>
              <section className="overflow-hidden rounded-2xl border border-border/60 bg-background/45">
                <div className="space-y-3 p-4">
                  <h2 className="font-heading text-sm font-semibold text-foreground">
                    {t("settings.toolbarTitle")}
                  </h2>
                  {toolbarItems.map((id) => (
                    <label
                      key={id}
                      className="flex min-h-7 items-center justify-between gap-3 text-sm"
                    >
                      <span>{labels[id]}</span>
                      <Switch
                        checked={settings.toolbar[id]}
                        onCheckedChange={(checked) =>
                          updateAppSettings({
                            ...settings,
                            toolbar: { ...settings.toolbar, [id]: checked },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="bg-muted/50 px-2 py-1.5">
                  <div
                    className="flex min-h-7 items-center justify-center gap-1 overflow-x-auto"
                    aria-label={t("settings.toolbarPreview")}
                  >
                    {settings.toolbar.tour &&
                      previewIcon(BinocularsIcon, labels.tour)}
                    {settings.toolbar.fullscreen &&
                      previewIcon(
                        document.fullscreenElement
                          ? ArrowShrinkIcon
                          : FullScreenIcon,
                        labels.fullscreen
                      )}
                    {settings.toolbar.shortcuts &&
                      previewIcon(CommandIcon, labels.shortcuts)}
                    {settings.toolbar.appearance && (
                      <>
                        <span
                          role="img"
                          aria-label={t("appearance.scheme.label")}
                          className="grid size-7 shrink-0 place-items-center rounded-md text-foreground"
                        >
                          <span className="size-4">
                            <ThemeSchemeIcon />
                          </span>
                        </span>
                        {previewIcon(PaletteIcon, labels.appearance)}
                      </>
                    )}
                    {settings.toolbar.language && (
                      <span className="flex h-7 shrink-0 items-center rounded-md px-1.5 text-[10px]">
                        {t(
                          currentLanguage === "zh-CN"
                            ? "common.chinese"
                            : "common.english"
                        )}
                      </span>
                    )}
                    {previewIcon(Settings01Icon, t("settings.title"))}
                  </div>
                </div>
              </section>
            </div>
            <div className="relative w-full min-w-0 pb-10 sm:max-w-[562px]">
              <section className="min-w-0 rounded-2xl border border-border/60 bg-background/45 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="font-heading text-sm font-semibold text-foreground">
                    {t("shortcuts.title")}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="bg-primary/5 text-foreground hover:bg-primary/10"
                    onClick={() => {
                      updateAppSettings({ ...settings, shortcuts: {} })
                      setEditing(null)
                      setError(null)
                    }}
                  >
                    <HugeiconsIcon icon={RefreshIcon} size={14} />
                    {t("settings.resetShortcuts")}
                  </Button>
                </div>
                <div className="grid items-start gap-2 sm:grid-cols-2">
                  {columns.map((items, column) => (
                    <div key={column} className="grid content-start gap-2">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          ref={editing === item.id ? editorRef : undefined}
                          className={`relative h-12 min-w-0 rounded-xl border transition-colors ${editing === item.id ? "border-dashed border-primary/40 bg-primary/5" : "border-border/60 bg-card/60"}`}
                        >
                          <div className="h-full overflow-hidden rounded-xl">
                            <AnimatePresence
                              initial={false}
                              mode="wait"
                              custom={editing === item.id}
                            >
                              <motion.div
                                key={editing === item.id ? "editing" : "view"}
                                custom={editing === item.id}
                                variants={{
                                  enter: (active: boolean) => ({
                                    opacity: 0,
                                    y: reducedMotion ? 0 : active ? 10 : -10,
                                  }),
                                  visible: { opacity: 1, y: 0 },
                                  exit: (active: boolean) => ({
                                    opacity: 0,
                                    y: reducedMotion ? 0 : active ? -10 : 10,
                                  }),
                                }}
                                initial="enter"
                                animate="visible"
                                exit="exit"
                                transition={{
                                  duration: reducedMotion ? 0 : 0.14,
                                  ease: "easeOut",
                                }}
                                className="h-full"
                              >
                                {editing === item.id ? (
                                  <div
                                    id={`shortcut-editor-${item.id}`}
                                    className="flex h-full items-center justify-between gap-2 px-2"
                                    aria-label={t(item.labelKey)}
                                  >
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        size="sm"
                                        className="h-6 px-1.5 text-[10px] shadow-none"
                                        onClick={() =>
                                          saveBinding(item.id, draft)
                                        }
                                      >
                                        {t("settings.save")}
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 px-1.5 text-[10px] shadow-none"
                                        onClick={() =>
                                          saveBinding(item.id, item.displayKey)
                                        }
                                      >
                                        {t("settings.default")}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-1.5 text-[10px]"
                                        onClick={() => setEditing(null)}
                                      >
                                        {t("settings.cancel")}
                                      </Button>
                                    </div>
                                    <button
                                      type="button"
                                      autoFocus
                                      className="flex min-h-7 min-w-0 items-center justify-end rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                                      aria-label={t("settings.recordShortcut")}
                                      title={t("settings.recordingHint")}
                                      onKeyDown={(event) => {
                                        if (event.key === "Tab") return
                                        event.preventDefault()
                                        event.stopPropagation()
                                        if (event.key === "Escape") {
                                          setEditing(null)
                                          return
                                        }
                                        if (
                                          [
                                            "Control",
                                            "Meta",
                                            "Alt",
                                            "Shift",
                                          ].includes(event.key)
                                        )
                                          return
                                        setDraft(
                                          ["Delete", "Backspace"].includes(
                                            event.key
                                          )
                                            ? ""
                                            : keyboardBinding(event)
                                        )
                                        setError(null)
                                      }}
                                    >
                                      <ShortcutKeys
                                        value={draft}
                                        empty={t("settings.noShortcut")}
                                      />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={item.handled === false}
                                    aria-expanded={false}
                                    title={
                                      item.handled === false
                                        ? t("settings.nativeShortcut")
                                        : undefined
                                    }
                                    className="flex h-full w-full items-center justify-between gap-2 rounded-xl px-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:cursor-default disabled:hover:bg-transparent"
                                    onClick={() => {
                                      setEditing(item.id)
                                      setDraft(
                                        settings.shortcuts[item.id] ??
                                          item.displayKey
                                      )
                                      setError(null)
                                    }}
                                  >
                                    <span className="min-w-0 text-xs leading-4">
                                      {t(item.labelKey)}
                                    </span>
                                    <span className="shrink-0">
                                      <ShortcutKeys
                                        value={
                                          settings.shortcuts[item.id] ??
                                          item.displayKey
                                        }
                                        empty={t("settings.noShortcut")}
                                      />
                                    </span>
                                  </button>
                                )}
                              </motion.div>
                            </AnimatePresence>
                          </div>
                          {editing === item.id && error && (
                            <p
                              role="alert"
                              className="absolute top-full right-0 left-0 z-10 mt-1 rounded-md border border-destructive/30 bg-card px-2 py-1 text-[10px] text-destructive"
                            >
                              {errorMessage}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
              <div className="absolute right-0 bottom-0 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    updateAppSettings({
                      toolbar: { ...defaultAppSettings.toolbar },
                      shortcuts: {},
                    })
                    void changeLanguage("en")
                    setEditing(null)
                    setError(null)
                  }}
                >
                  <HugeiconsIcon icon={RefreshIcon} size={14} />
                  {t("settings.resetAll")}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
