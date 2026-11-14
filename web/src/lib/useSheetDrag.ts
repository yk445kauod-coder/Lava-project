import { useRef, useState, type TouchEvent as ReactTouchEvent } from "react";

/** Drag-to-dismiss for a mobile bottom sheet: tracks the finger on the Y axis
 *  and reports a dismiss once the drag passes `threshold`. A no-op on desktop,
 *  where the sheet is a docked element that never receives touch events. */
export function useSheetDrag(onDismiss: () => void, threshold = 90) {
  const startY = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const handlers = {
    onTouchStart: (e: ReactTouchEvent) => {
      startY.current = e.touches[0].clientY;
    },
    onTouchMove: (e: ReactTouchEvent) => {
      if (startY.current === null) return;
      const d = e.touches[0].clientY - startY.current;
      setDragY(d > 0 ? d : 0);
    },
    onTouchEnd: () => {
      setDragY((y) => {
        if (y > threshold) onDismiss();
        return 0;
      });
      startY.current = null;
    },
  };
  // While dragging, the element follows the finger without easing.
  const dragStyle = dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined;
  return { dragY, handlers, dragStyle };
}
