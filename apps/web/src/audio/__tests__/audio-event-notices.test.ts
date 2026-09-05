import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AudioEventNotices } from "../audio-event-notices.tsx";

describe("audio event notices", () => {
  it("renders the explanation that gates an event sound", () => {
    const markup = renderToStaticMarkup(
      createElement(AudioEventNotices, {
        notices: [
          {
            cueId: "researcher-departs",
            occurrenceKey: "depart:test",
            notice: {
              title: "Star researcher left the lab",
              detail: "The Lab feed records why the researcher departed.",
              tone: "warning",
            },
          },
        ],
        onDismiss: vi.fn(),
        onDismissAll: vi.fn(),
      }),
    );

    expect(markup).toContain("EVENT CUE // WHAT CHANGED");
    expect(markup).toContain("Star researcher left the lab");
    expect(markup).toContain("The Lab feed records why the researcher departed.");
    expect(markup).not.toContain("Dismiss all");
  });

  it("renders the complete queue with newer notices above the oldest notice", () => {
    const markup = renderToStaticMarkup(
      createElement(AudioEventNotices, {
        notices: [
          {
            cueId: "researcher-departs",
            occurrenceKey: "depart:first",
            notice: {
              title: "Oldest notification",
              detail: "This remains anchored at bottom right.",
              tone: "warning",
            },
          },
          {
            cueId: "paper-discovered",
            occurrenceKey: "paper:second",
            notice: {
              title: "Middle notification",
              detail: "This sits above the oldest notification.",
              tone: "positive",
            },
          },
          {
            cueId: "rival-breakthrough",
            occurrenceKey: "rival:third",
            notice: {
              title: "Newest notification",
              detail: "This is added to the top of the stack.",
              tone: "critical",
            },
          },
        ],
        onDismiss: vi.fn(),
        onDismissAll: vi.fn(),
      }),
    );

    expect(markup.match(/class="audio-event-notice /g)).toHaveLength(3);
    expect(markup).toContain("3 NOTIFICATIONS");
    expect(markup).toContain("Dismiss all");
    expect(markup.indexOf("Newest notification")).toBeLessThan(
      markup.indexOf("Middle notification"),
    );
    expect(markup.indexOf("Middle notification")).toBeLessThan(
      markup.indexOf("Oldest notification"),
    );
  });

  it("renders a real-paper link in a paper notification", () => {
    const markup = renderToStaticMarkup(
      createElement(AudioEventNotices, {
        notices: [
          {
            cueId: "paper-discovered",
            occurrenceKey: "paper:random-forests",
            notice: {
              title: "Random Forests",
              detail: "Your lab has made a research discovery.",
              tone: "positive",
              externalLink: {
                href: "https://doi.org/10.1023/A:1010933404324",
                label: "Read the real paper ↗",
              },
            },
          },
        ],
        onDismiss: vi.fn(),
        onDismissAll: vi.fn(),
      }),
    );

    expect(markup).toContain('href="https://doi.org/10.1023/A:1010933404324"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain("Read the real paper ↗");
  });

  it("renders an internal review action when the shell can handle it", () => {
    const markup = renderToStaticMarkup(
      createElement(AudioEventNotices, {
        notices: [
          {
            cueId: "containment-warning",
            occurrenceKey: "incident:model:critical",
            notice: {
              title: "Containment warning",
              detail: "Open Safety & evaluations to inspect the model evidence.",
              tone: "critical",
              internalAction: {
                destination: "evaluations",
                label: "Review in Safety & evaluations",
              },
            },
          },
        ],
        onDismiss: vi.fn(),
        onDismissAll: vi.fn(),
        onInternalAction: vi.fn(),
      }),
    );

    expect(markup).toContain("Review in Safety &amp; evaluations");
    expect(markup).toContain('class="audio-event-notice-action"');
  });
});
