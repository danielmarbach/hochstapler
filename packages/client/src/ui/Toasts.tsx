import { useApp } from "../net/store.ts";

/** transient messages (copy confirmation, errors, game events); shown in the lobby and in the game */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div class="toasts" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          class={`toast ${t.kind}`}
          style={t.color ? { "--tc": t.color } : {}}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
