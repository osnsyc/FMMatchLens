let openPlayerProfileCount = 0

export function setPlayerProfileBackdrop(open: boolean) {
  openPlayerProfileCount = Math.max(0, openPlayerProfileCount + (open ? 1 : -1))
  document.body.classList.toggle("player-profile-open", openPlayerProfileCount > 0)
}

