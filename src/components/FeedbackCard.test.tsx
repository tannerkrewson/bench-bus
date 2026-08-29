import { describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import FeedbackCard, { GITHUB_ISSUES_URL } from "./FeedbackCard";

function mount(ui: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(ui, container);
  return { container, dispose: () => { dispose(); container.remove(); } };
}

describe("FeedbackCard", () => {
  it("invites bug reports and suggestions with a safe external link", () => {
    const { container, dispose } = mount(() => <FeedbackCard />);

    expect(container.querySelector("h2#feedback-card-title")?.textContent).toBe(
      "Help improve Bench Bus",
    );
    expect(container.textContent).toContain(
      "If you spot a bug or have a suggestion for Bench Bus, please tell me about it!",
    );

    const link = container.querySelector<HTMLAnchorElement>("[data-testid='feedback-github-link']")!;
    expect(link.textContent).toContain("Open a GitHub issue");
    expect(link.getAttribute("href")).toBe(GITHUB_ISSUES_URL);
    expect(link.href).toBe("https://github.com/tannerkrewson/bench-bus/issues");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    // The lucide icon is decorative; the link text stays self-describing.
    expect(link.querySelector("svg")).not.toBeNull();

    dispose();
  });
});
