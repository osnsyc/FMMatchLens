/** One RAF owns all tactical animations and coalesces dirty renders. */
export class TacticalRenderScheduler {
  private pending: number | null = null
  private tasks = new Map<string, (now: number) => boolean>()
  private dirty = false
  private disposed = false
  private advancing = false
  private render: () => void
  private request: typeof requestAnimationFrame
  private cancel: typeof cancelAnimationFrame
  constructor(
    render: () => void,
    request: typeof requestAnimationFrame = (callback) =>
      requestAnimationFrame(callback),
    cancel: typeof cancelAnimationFrame = (handle) =>
      cancelAnimationFrame(handle)
  ) {
    this.render = render
    this.request = request
    this.cancel = cancel
  }
  invalidate() {
    if (this.disposed) return
    this.dirty = true
    this.wake()
  }
  setTask(id: string, task: (now: number) => boolean) {
    if (this.disposed) return
    this.tasks.set(id, task)
    this.wake()
  }
  removeTask(id: string) {
    this.tasks.delete(id)
    if (!this.tasks.size && !this.dirty && this.pending != null) {
      this.cancel(this.pending)
      this.pending = null
    }
  }
  private wake() {
    if (this.pending == null && !this.disposed && !this.advancing)
      this.pending = this.request(this.advance)
  }
  private advance = (now: number) => {
    this.pending = null
    this.advancing = true
    for (const [id, task] of this.tasks) {
      if (!task(now)) this.tasks.delete(id)
      this.dirty = true
    }
    if (this.dirty) {
      this.dirty = false
      this.render()
    }
    this.advancing = false
    if (this.tasks.size || this.dirty) this.wake()
  }
  suspend() {
    if (this.pending != null) this.cancel(this.pending)
    this.pending = null
    this.tasks.clear()
    this.dirty = false
  }
  dispose() {
    this.suspend()
    this.disposed = true
  }
  get activeRAF() {
    return this.pending != null ? 1 : 0
  }
}
