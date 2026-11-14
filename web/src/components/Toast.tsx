import { useEffect, useState } from "react";

interface ToastProps {
  message: string | null;
  onDone?: () => void;
  duration?: number;
}

/** Transient status message (matches the legacy `.toast` element). */
export function Toast({ message, onDone, duration = 2400 }: ToastProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (message === null) return;
    setShown(true);
    const hide = setTimeout(() => setShown(false), duration);
    const done = onDone ? setTimeout(onDone, duration + 300) : undefined;
    return () => {
      clearTimeout(hide);
      if (done) clearTimeout(done);
    };
  }, [message, duration, onDone]);

  return (
    <div className={`toast${shown && message !== null ? " show" : ""}`} role="status">
      {message}
    </div>
  );
}

/** Convenience hook: `const [msg, toast] = useToast()`. */
export function useToast(): [string | null, (m: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const toast = (m: string) => {
    setMessage(m);
    setSeq((n) => n + 1);
  };
  // Re-trigger even when the same string is shown twice.
  return [seq === 0 ? null : message, toast];
}
