import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

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
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="item-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="item-dialog-content">
        <button
          className="dialog-close"
          aria-label={"关闭" + label}
          onClick={onClose}
        >
          <X size={23} />
        </button>
        {children}
      </div>
    </dialog>
  );
}
