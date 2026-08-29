import type { ChartSubtitle, ChartSubtitleLink } from "../charts/types";

export interface ChartSubtitleProps {
  content: ChartSubtitle;
}

export function chartSubtitlePlainText(content: ChartSubtitle): string {
  if (typeof content === "string") return content;
  return content.map((part) => (typeof part === "string" ? part : part.label)).join("");
}

/** Reuse only source links declared by the benchmark subtitle metadata. */
export function chartSubtitleLinks(content: ChartSubtitle): ChartSubtitleLink[] {
  if (typeof content === "string") return [];
  const seen = new Set<string>();
  return content.flatMap((part) => {
    if (typeof part === "string" || seen.has(part.href)) return [];
    seen.add(part.href);
    return [part];
  });
}

function isLinkPart(part: string | ChartSubtitleLink): part is ChartSubtitleLink {
  return typeof part !== "string";
}

/** Renders subtitle descriptors without putting UI nodes in pure adapters. */
export default function ChartSubtitleContent(props: ChartSubtitleProps) {
  const parts: readonly (string | ChartSubtitleLink)[] =
    typeof props.content === "string" ? [props.content] : props.content;

  return (
    <>
      {parts.map((part) =>
        isLinkPart(part) ? (
          <a
            class="link link-hover"
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part.label}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
