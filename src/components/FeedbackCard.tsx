import { ExternalLink } from "lucide-solid";
import type { Component } from "solid-js";

/** GitHub issue tracker shown by the feedback card. */
export const GITHUB_ISSUES_URL = "https://github.com/tannerkrewson/bench-bus/issues";

/**
 * Invitation to report bugs and suggestions, placed just above the footer.
 * Uses only semantic theme classes so it stays legible in light and dark.
 */
const FeedbackCard: Component = () => (
  <section class="card mt-6 border border-base-300 bg-base-200 shadow-sm" aria-labelledby="feedback-card-title">
    <div class="card-body gap-3 px-5 py-4">
      <h2 id="feedback-card-title" class="card-title text-lg">Help improve Bench Bus</h2>
      <p class="text-sm text-base-content/70">
        If you spot a bug or have a suggestion for Bench Bus, please tell me about it!
      </p>
      <div class="card-actions">
        <a
          class="link link-hover inline-flex items-center gap-1"
          href={GITHUB_ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="feedback-github-link"
        >
          Open a GitHub issue
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  </section>
);

export default FeedbackCard;
