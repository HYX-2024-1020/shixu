export const settle = "cubic-bezier(.2,.8,.2,1)";
export const spring =
  "linear(0, .16 8%, .48 19%, .8 34%, .98 51%, 1.025 65%, 1.012 82%, 1)";
const menuMotion = new WeakMap<HTMLDetailsElement, Animation>();
export function setMenuOpen(menu: HTMLDetailsElement, open: boolean) {
  menu.dataset.motionState = open ? "opening" : "closing";
  menuMotion.get(menu)?.cancel();
  const panel = menu.querySelector<HTMLElement>(":scope > div");
  if (!panel || !menu.isConnected) {
    menu.open = open;
    return;
  }
  if (open) menu.open = true;
  if (!menu.open) return;
  panel.style.transformOrigin = "bottom right";
  const animation = panel.animate(
    open
      ? [
          { opacity: 0, transform: "translateY(7px) scale(.94)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ]
      : [
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0, transform: "translateY(4px) scale(.97)" },
        ],
    { duration: open ? 240 : 110, easing: open ? spring : settle },
  );
  menuMotion.set(menu, animation);
  animation.finished
    .then(() => {
      if (menuMotion.get(menu) === animation) {
        menu.open = open;
        menuMotion.delete(menu);
        delete menu.dataset.motionState;
      }
    })
    .catch(() => {});
}
export async function leaveCard(id: string, deleting: boolean) {
  const card = Array.from(
    document.querySelectorAll<HTMLElement>("[data-motion-id]"),
  ).find((el) => el.dataset.motionId === id && el.checkVisibility());
  if (!card || !card.checkVisibility()) return;
  card.dataset.departing = "true";
  try {
    await card.animate(
      [
        {
          opacity: 1,
          transform: "translateY(0) scale(1)",
          filter: "blur(0px)",
        },
        {
          opacity: 0,
          transform: `translateY(${deleting ? 6 : -8}px) scale(.96)`,
          filter: "blur(2px)",
        },
      ],
      { duration: 170, easing: settle, fill: "forwards" },
    ).finished;
  } catch {
    /* A rapid filter change may remove the card before its exit finishes. */
  }
}
export function resetCard(id: string) {
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>("[data-motion-id]"),
  ).filter((el) => el.dataset.motionId === id);
  for (const card of cards) {
    card.getAnimations().forEach((animation) => animation.cancel());
    delete card.dataset.departing;
  }
}
