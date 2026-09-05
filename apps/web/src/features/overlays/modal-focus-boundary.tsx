import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface InertLock {
  count: number;
  readonly originalValue: boolean;
}

// Modal boundaries can be nested (for example, the endgame decision dialog can
// open a typed confirmation dialog). Track overlapping locks centrally so the
// order in which React removes those boundaries cannot restore a stale `inert`
// value and leave the dashboard permanently non-interactive.
const inertLocks = new WeakMap<HTMLElement, InertLock>();

interface DocumentScrollLock {
  count: number;
  readonly documentModalOpen: string | null;
  readonly documentOverflow: string;
  readonly documentOverscrollBehavior: string;
  readonly documentScrollbarGutter: string;
  readonly bodyOverflow: string;
  readonly bodyOverscrollBehavior: string;
}

let documentScrollLock: DocumentScrollLock | undefined;

function lockDocumentScroll(): void {
  if (documentScrollLock !== undefined) {
    documentScrollLock.count += 1;
    return;
  }
  const documentElement = document.documentElement;
  const body = document.body;
  documentScrollLock = {
    count: 1,
    documentModalOpen: documentElement.getAttribute("data-modal-open"),
    documentOverflow: documentElement.style.overflow,
    documentOverscrollBehavior: documentElement.style.overscrollBehavior,
    documentScrollbarGutter: documentElement.style.scrollbarGutter,
    bodyOverflow: body.style.overflow,
    bodyOverscrollBehavior: body.style.overscrollBehavior,
  };
  documentElement.setAttribute("data-modal-open", "true");
  documentElement.style.overflow = "hidden";
  documentElement.style.overscrollBehavior = "none";
  documentElement.style.scrollbarGutter = "stable";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
}

function unlockDocumentScroll(): void {
  if (documentScrollLock === undefined) return;
  documentScrollLock.count -= 1;
  if (documentScrollLock.count > 0) return;
  const documentElement = document.documentElement;
  const body = document.body;
  if (documentScrollLock.documentModalOpen === null) {
    documentElement.removeAttribute("data-modal-open");
  } else {
    documentElement.setAttribute("data-modal-open", documentScrollLock.documentModalOpen);
  }
  documentElement.style.overflow = documentScrollLock.documentOverflow;
  documentElement.style.overscrollBehavior =
    documentScrollLock.documentOverscrollBehavior;
  documentElement.style.scrollbarGutter = documentScrollLock.documentScrollbarGutter;
  body.style.overflow = documentScrollLock.bodyOverflow;
  body.style.overscrollBehavior = documentScrollLock.bodyOverscrollBehavior;
  documentScrollLock = undefined;
}

function lockInert(element: HTMLElement): void {
  const existing = inertLocks.get(element);
  if (existing !== undefined) {
    existing.count += 1;
    element.inert = true;
    return;
  }
  inertLocks.set(element, { count: 1, originalValue: element.inert });
  element.inert = true;
}

function unlockInert(element: HTMLElement): void {
  const existing = inertLocks.get(element);
  if (existing === undefined) return;
  existing.count -= 1;
  if (existing.count > 0) return;
  element.inert = existing.originalValue;
  inertLocks.delete(element);
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

function resetModalScroll(boundary: HTMLElement, dialog: HTMLElement): void {
  let element: HTMLElement | null = dialog;
  while (element !== null && boundary.contains(element)) {
    element.scrollTop = 0;
    element.scrollLeft = 0;
    if (element === boundary) break;
    element = element.parentElement;
  }
}

/**
 * Supplies the behaviour promised by aria-modal: initial focus, a keyboard trap,
 * inert background content, Escape handling when allowed, and focus restoration.
 */
export function ModalFocusBoundary({
  children,
  onOpen,
  onEscape,
}: {
  readonly children: ReactNode;
  readonly onOpen?: (() => void) | undefined;
  readonly onEscape?: (() => void) | undefined;
}): ReactElement {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const returnTargetRef = useRef<HTMLElement | undefined>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined,
  );
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    onOpenRef.current?.();
    const boundary = boundaryRef.current;
    const dialog = boundary?.querySelector<HTMLElement>(
      ":is([role='dialog'], [role='alertdialog'])[aria-modal='true']",
    );
    if (
      boundary === null ||
      boundary === undefined ||
      dialog === null ||
      dialog === undefined
    )
      return;

    const syncVisualViewport = (): void => {
      const visualViewport = window.visualViewport;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const viewportWidth = visualViewport?.width ?? window.innerWidth;
      const viewportOffsetTop = visualViewport?.offsetTop ?? 0;
      const viewportOffsetLeft = visualViewport?.offsetLeft ?? 0;
      boundary.style.setProperty(
        "--modal-visual-viewport-height",
        `${String(Math.max(1, Math.round(viewportHeight)))}px`,
      );
      boundary.style.setProperty(
        "--modal-visual-viewport-width",
        `${String(Math.max(1, Math.round(viewportWidth)))}px`,
      );
      boundary.style.setProperty(
        "--modal-visual-viewport-offset-top",
        `${String(Math.max(0, Math.round(viewportOffsetTop)))}px`,
      );
      boundary.style.setProperty(
        "--modal-visual-viewport-offset-left",
        `${String(Math.max(0, Math.round(viewportOffsetLeft)))}px`,
      );
    };
    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);
    lockDocumentScroll();

    const siblings: HTMLElement[] = [];
    let branch: HTMLElement = boundary;
    while (branch.parentElement !== null && branch.parentElement !== document.body) {
      for (const element of branch.parentElement.children) {
        if (element instanceof HTMLElement && element !== branch) siblings.push(element);
      }
      branch = branch.parentElement;
    }
    for (const sibling of siblings) lockInert(sibling);

    resetModalScroll(boundary, dialog);
    const activeElement =
      document.activeElement instanceof HTMLElement &&
      dialog.contains(document.activeElement)
        ? document.activeElement
        : undefined;
    const explicitlyFocusable =
      (dialog.matches("[data-modal-initial-focus]") ? dialog : undefined) ??
      dialog.querySelector<HTMLElement>("[data-modal-initial-focus]") ??
      dialog.querySelector<HTMLElement>("[autofocus]") ??
      activeElement;
    if (explicitlyFocusable === undefined || explicitlyFocusable === null) {
      dialog.tabIndex = -1;
      dialog.focus({ preventScroll: true });
    } else {
      explicitlyFocusable.focus({ preventScroll: true });
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && onEscapeRef.current !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = focusableElements(dialog);
      if (focusables.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables.at(-1);
      if (first === undefined || last === undefined) return;
      if (document.activeElement === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      for (const sibling of siblings) unlockInert(sibling);
      unlockDocumentScroll();
      if (returnTargetRef.current?.isConnected === true) returnTargetRef.current.focus();
    };
  }, []);

  return (
    <div className="modal-focus-boundary" ref={boundaryRef}>
      {children}
    </div>
  );
}
