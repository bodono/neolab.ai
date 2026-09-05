import { useEffect, type ReactElement } from "react";

import { useGameStore } from "./runtime-provider.tsx";

const FAVICON_SELECTOR = 'link[rel~="icon"][data-neolab-favicon]';
const LEADER_PORTRAIT_SELECTOR = "svg.leader-header-portrait";

function faviconLink(document: Document): HTMLLinkElement | undefined {
  return document.querySelector<HTMLLinkElement>(FAVICON_SELECTOR) ?? undefined;
}

/**
 * Point the browser-tab icon at the exact pixel portrait already rendered in
 * the game header. The returned cleanup restores the neutral Neolab mark.
 */
export function applyLeaderPortraitFavicon(
  portrait: SVGSVGElement,
  document: Document,
): () => void {
  const link = faviconLink(document);
  if (link === undefined) return () => undefined;

  const fallbackHref = link.dataset["fallbackHref"] ?? link.href;
  link.dataset["fallbackHref"] = fallbackHref;

  const icon = portrait.cloneNode(true) as SVGSVGElement;
  icon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  icon.setAttribute("width", "32");
  icon.setAttribute("height", "32");
  icon.removeAttribute("class");
  icon.removeAttribute("role");
  icon.removeAttribute("aria-label");

  const source = new XMLSerializer().serializeToString(icon);
  link.href = `data:image/svg+xml,${encodeURIComponent(source)}`;

  return () => {
    link.href = fallbackHref;
  };
}

/** Keep the active run recognisable among browser tabs. */
export function LeaderFavicon(): ReactElement | null {
  const leaderId = useGameStore((state) => state.gameView?.identity.leaderId);

  useEffect(() => {
    if (leaderId === undefined) return;
    const portrait = document.querySelector<SVGSVGElement>(LEADER_PORTRAIT_SELECTOR);
    if (portrait === null) return;
    return applyLeaderPortraitFavicon(portrait, document);
  }, [leaderId]);

  return null;
}
