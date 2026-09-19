"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ICON } from "@/components/icon";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: a square panel with a 1px control border over a dimmed
 * page, no shadow and no blur. Escape and the close button call onClose;
 * Tab stays inside the dialog; focus goes back to what opened it.
 */
export function Dialog({
  id,
  title,
  description,
  onClose,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  // Recorded during the first render, before an autofocused field inside
  // the dialog takes focus, so Escape can hand focus back to the opener.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  );
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      (panel.querySelector<HTMLElement>("[autofocus]") ?? panel.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === "Tab" && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [opener]);

  return (
    <div
      className="dx-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className="dx-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <div className="dx-dialog-head">
          <div>
            <h2 id={`${id}-title`} className="bw-h3">
              {title}
            </h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="bw-iconbtn" onClick={onClose} aria-label="Close">
            <X size={16} {...ICON} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
