"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { ICON } from "@/components/icon";

export interface GalleryPicture {
  key: string | number;
  src: string;
  alt: string;
  caption: string | null;
}

/**
 * The screenshots and theme previews of an extension. A click opens one
 * large; the arrows and the arrow keys step through the rest.
 */
export function ScreenshotGallery({ pictures }: { pictures: GalleryPicture[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = pictures.length;
  const step = (by: number) => setOpen((i) => (i === null ? i : (i + by + count) % count));
  const current = open === null ? null : pictures[open];
  const isOpen = open !== null;

  // The arrow keys step from anywhere in the dialog, the close button included.
  useEffect(() => {
    if (!isOpen || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); setOpen((i) => (i === null ? i : (i - 1 + count) % count)); }
      if (e.key === "ArrowRight") { e.preventDefault(); setOpen((i) => (i === null ? i : (i + 1) % count)); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, count]);

  return (
    <>
      <div className="dx-shots">
        {pictures.map((p, i) => (
          <figure key={p.key}>
            <button type="button" className="dx-shot" onClick={() => setOpen(i)} aria-label={`Open ${p.alt} larger`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt={p.alt} loading="lazy" />
            </button>
            {p.caption ? <figcaption>{p.caption}</figcaption> : null}
          </figure>
        ))}
      </div>

      {current ? (
        <Dialog
          id="screenshot"
          wide
          title={count > 1 ? `Screenshot ${open! + 1} of ${count}` : "Screenshot"}
          description={current.caption ?? undefined}
          onClose={() => setOpen(null)}
        >
          <div className="dx-lightbox">
            {count > 1 ? (
              <button type="button" className="bw-iconbtn" onClick={() => step(-1)} aria-label="Previous screenshot">
                <ChevronLeft size={20} {...ICON} />
              </button>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.src} alt={current.alt} />
            {count > 1 ? (
              <button type="button" className="bw-iconbtn" onClick={() => step(1)} aria-label="Next screenshot">
                <ChevronRight size={20} {...ICON} />
              </button>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
