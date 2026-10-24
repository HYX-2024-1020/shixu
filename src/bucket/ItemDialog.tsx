import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { settle } from "./motion";

const zoomEase = "cubic-bezier(.22,.75,.22,1)";
export default function ItemDialog({
  children,
  onClose,
  label = "事项详情",
  originId,
}: {
  children: ReactNode;
  onClose: () => void;
  label?: string;
  originId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const motion = useRef<Animation | null>(null);
  const shadeMotion = useRef<Animation | null>(null);
  const contentMotion = useRef<Animation | null>(null);
  const closing = useRef(false);
  const mounted = useRef(false);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  function originTransform(dialog: HTMLDialogElement) {
    const target = dialog.getBoundingClientRect();
    const source = origin.current?.isConnected
      ? origin.current.getBoundingClientRect()
      : null;
    if (
      !source ||
      source.bottom < 0 ||
      source.top > innerHeight ||
      !source.width
    )
      return "translateY(10px) scale(.96)";
    // Measure the resting box: an interrupted entrance must not change its destination.
    const { width, height, left, top } = target;
    return `translate(${source.left + source.width / 2 - left - width / 2}px,${source.top + source.height / 2 - top - height / 2}px) scale(${source.width / width},${source.height / height})`;
  }
  async function close() {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    const current = getComputedStyle(dialog).transform;
    const opacity = shade.current
      ? getComputedStyle(shade.current).opacity
      : "1";
    const content = dialog.querySelector<HTMLElement>(".item-dialog-content")!;
    const contentOpacity = getComputedStyle(content).opacity;
    motion.current?.cancel();
    shadeMotion.current?.cancel();
    contentMotion.current?.cancel();
    dialog.dataset.motionState = "closing";
    if (shade.current)
      shadeMotion.current = shade.current.animate(
        [{ opacity }, { opacity: 0 }],
        { duration: 190, easing: settle, fill: "forwards" },
      );
    contentMotion.current = content.animate(
      [{ opacity: contentOpacity }, { opacity: 0 }],
      { duration: 110, easing: settle, fill: "forwards" },
    );
    motion.current = dialog.animate(
      [{ transform: current }, { transform: originTransform(dialog) }],
      { duration: 210, easing: zoomEase, fill: "forwards" },
    );
    try {
      await motion.current.finished;
    } catch {
      return;
    }
    if (mounted.current) closeCallback.current();
  }
  useLayoutEffect(() => {
    const dialog = ref.current!;
    mounted.current = true;
    closing.current = false;
    origin.current =
      dialog.closest<HTMLElement>(".result-card") ||
      (originId
        ? [...document.querySelectorAll<HTMLElement>("[data-motion-id]")].find(
            (el) => el.dataset.motionId === originId && el.checkVisibility(),
          ) || null
        : (document.activeElement as HTMLElement)?.closest<HTMLElement>(
            ".result-card",
          ));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const cancel = (event: Event) => {
      event.preventDefault();
      void close();
    };
    dialog.addEventListener("cancel", cancel);
    dialog.showModal();
    dialog.dataset.motionState = "opening";
    const from = originTransform(dialog);
    origin.current?.setAttribute("data-dialog-origin", "true");
    motion.current = dialog.animate(
      [{ transform: from }, { transform: "translate(0,0) scale(1)" }],
      { duration: 260, easing: zoomEase },
    );
    shadeMotion.current = shade.current!.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 200, easing: settle },
    );
    contentMotion.current = dialog
      .querySelector<HTMLElement>(".item-dialog-content")!
      .animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 150,
        delay: 55,
        easing: settle,
        fill: "backwards",
      });
    motion.current.finished
      .then(() => {
        if (mounted.current && !closing.current)
          delete dialog.dataset.motionState;
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      motion.current?.cancel();
      shadeMotion.current?.cancel();
      contentMotion.current?.cancel();
      origin.current?.removeAttribute("data-dialog-origin");
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <>
      {createPortal(
        <div className="dialog-scrim" ref={shade} aria-hidden="true" />,
        document.body,
      )}
      <dialog
        ref={ref}
        className="item-dialog"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            void close();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) void close();
        }}
      >
        <div className="item-dialog-content">
          <button
            className="dialog-close"
            aria-label={"关闭" + label}
            onClick={() => void close()}
          >
            <X size={23} />
          </button>
          {children}
        </div>
      </dialog>
    </>
  );
}
