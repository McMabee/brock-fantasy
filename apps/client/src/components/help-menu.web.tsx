import { useId, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { HELP_LINKS } from '@/lib/help-navigation';

export function HelpMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useId();
  const panel = useId();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="bf-help-trigger"
        aria-label="Help and support"
        aria-haspopup="dialog"
        aria-controls={panel}
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      <dialog
        ref={dialog}
        id={panel}
        data-bf-help="true"
        className="bf-help-dialog"
        aria-labelledby={title}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            dialog.current?.close();
        }}
      >
        <h2 id={title}>Help and support</h2>
        <button type="button" onClick={() => dialog.current?.close()}>
          Close help options
        </button>
        <nav aria-label="Help and support options">
          {HELP_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => {
                if (
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                )
                  return;
                event.preventDefault();
                dialog.current?.close();
                router.push(link.href);
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </dialog>
    </>
  );
}
