import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { settle, spring } from "./motion";

export default function ItemDialog({
  children,
  onClose,
  label = "事项详情",
}: {
  children: ReactNode;
  onClose: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const close = async () => {
    const dialog = ref.current;
    if (!dialog || closing.current) return;
    closing.current = true;
    dialog.dataset.closing = "true";
    dialog.getAnimations().forEach((animation) => animation.cancel());
    try {
      dialog.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 160,
        easing: settle,
        pseudoElement: "::backdrop",
      });
      await dialog.animate(
        [
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0, transform: "translateY(8px) scale(.975)" },
        ],
        { duration: 160, easing: settle, fill: "forwards" },
      ).finished;
    } catch {
      /* Unmount or a new window can cancel an in-flight animation. */
    }
    onClose();
  };
  useEffect(() => {
    const dialog = ref.current!;
    opener.current = document.activeElement as HTMLElement;
    const origin = opener.current
      ?.closest(".result-card")
      ?.getBoundingClientRect();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const cancel = (event: Event) => {
      event.preventDefault();
      void close();
    };
    dialog.addEventListener("cancel", cancel);
    dialog.showModal();
    const target = dialog.getBoundingClientRect();
    const offset = origin
      ? Math.max(
          -40,
          Math.min(
            40,
            (origin.top + origin.height / 2 - target.top - target.height / 2) *
              0.12,
          ),
        )
      : 14;
    dialog.animate(
      [
        {
          opacity: 0,
          transform: `translateY(${offset}px) scale(.95)`,
          filter: "blur(3px)",
        },
        {
          opacity: 1,
          transform: "translateY(0) scale(1)",
          filter: "blur(0px)",
        },
      ],
      { duration: 340, easing: spring },
    );
    dialog.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 220,
      easing: settle,
      pseudoElement: "::backdrop",
    });
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
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
  );
}
