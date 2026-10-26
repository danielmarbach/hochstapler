import { useState } from "preact/hooks";
import { tokenEmoji, tokenImageUrl } from "./token-icons.ts";
import { useThemeText } from "./util.tsx";

/**
 * A game piece as a picture: the thumbnail rendered from its 3D model (static file, no WebGL involved), the emoji
 * only if the image cannot be loaded. `name` is the localized piece name (alt text); without it the name from the
 * current theme is used.
 */
export function TokenIcon({ id, size, name }: { id: string; size: number; name?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const texts = useThemeText();
  const label = name ?? texts.tokens.find((tok) => tok.id === id)?.name ?? id;
  if (failed === id) {
    return (
      <span class="tokimg fallback" role="img" aria-label={label} style={{ fontSize: `${size}px` }}>
        {tokenEmoji(id)}
      </span>
    );
  }
  return (
    <img
      class="tokimg"
      src={tokenImageUrl(id)}
      alt={label}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(id)}
    />
  );
}
