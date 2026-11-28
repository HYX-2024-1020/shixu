import { settle, spring } from "../bucket/motion";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function animateBoardRemoval(
  card: HTMLElement | null,
  remove: () => void,
) {
  const host = card?.closest<HTMLElement>(".sx-host");
  if (!card || !host || reduced()) {
    remove();
    return;
  }
  const bounds = card.getBoundingClientRect();
  const origin = host.getBoundingClientRect();
  const zoom = host.currentCSSZoom || 1;
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.inert = true;
  ghost.classList.add("sx-motion-ghost");
  ghost.removeAttribute("data-task-id");
  ghost.removeAttribute("data-motion-id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.querySelectorAll("details").forEach((menu) => {
    menu.open = false;
  });
  const style = getComputedStyle(card);
  Object.assign(ghost.style, {
    position: "absolute",
    zIndex: 5,
    pointerEvents: "none",
    top: `${(bounds.top - origin.top) / zoom}px`,
    left: `${(bounds.left - origin.left) / zoom}px`,
    width: `${bounds.width / zoom}px`,
    height: `${bounds.height / zoom}px`,
    background: style.background,
    margin: "0",
  });
  host.append(ghost);
  remove();
  void ghost
    .animate(
      [{ opacity: 1 }, { opacity: 0, transform: "translateY(8px) scale(.96)" }],
      { duration: 175, easing: settle },
    )
    .finished.catch(() => {})
    .finally(() => ghost.remove());
}

export function animateBoardReorder(
  list: HTMLElement | null,
  reorder: () => void,
) {
  const rows = reduced()
    ? []
    : Array.from(list?.querySelectorAll<HTMLElement>("[data-task-id]") ?? []);
  const before = rows.map((row) => row.getBoundingClientRect().top);
  reorder();
  requestAnimationFrame(() => {
    rows.forEach((row, index) => {
      if (!row.isConnected) return;
      const offset =
        (before[index] - row.getBoundingClientRect().top) /
        (row.currentCSSZoom || 1);
      if (Math.abs(offset) < 1) return;
      row.animate([{ translate: `0 ${offset}px` }, { translate: "0 0" }], {
        duration: 260,
        easing: spring,
      });
    });
  });
}
