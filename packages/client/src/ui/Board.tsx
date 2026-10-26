// The board as a plain list (UI review T03): every field in board order with colour group, owner, buildings,
// mortgage and the players standing on it. Native buttons open the property inspector, so the board can be read and
// inspected without pointing at the 3D scene and without reading its small labels.
import { BOARD } from "@poly/engine";
import { t } from "../i18n/index.ts";
import { levelNameText, tileKindText } from "../i18n/labels.ts";
import { set, useApp } from "../net/store.ts";
import { TokenIcon } from "./TokenIcon.tsx";
import { useGameState, useTheme, useThemeText } from "./util.tsx";

export function BoardList() {
  const theme = useTheme();
  const texts = useThemeText();
  const state = useGameState();
  const selected = useApp((s) => s.selectedTile);
  return (
    <ol class="boardlist" data-testid="board-list" aria-label={t("board.list")}>
      {BOARD.map((def) => {
        const i = def.index;
        const name = theme.tileNames[i] ?? t("tile.fallback", { n: i });
        const pr = state.properties[i];
        const owner = pr?.owner ? state.players.find((p) => p.id === pr.owner) : undefined;
        const here = state.players.filter((p) => p.position === i && !p.bankrupt);
        const street = def.kind === "street";
        const color = street ? theme.groupColors[def.group ?? 0] : undefined;
        const kind = street ? (texts.groupNames[def.group ?? 0] ?? "") : tileKindText(def.kind);
        const level = pr?.level ?? 0;
        const buyable = def.price !== undefined;
        return (
          <li key={i}>
            <button
              type="button"
              class={`btile ${selected === i ? "on" : ""}`}
              data-testid="board-tile"
              data-tile={i}
              data-tile-name={name}
              aria-current={selected === i ? "true" : undefined}
              onClick={() => set({ selectedTile: i })}
            >
              <span class="bswatch" style={color ? { background: color } : {}} aria-hidden="true" />
              <span class="bmain">
                <span class="bname">{name}</span>
                <span class="bsub">{kind}</span>
                {buyable && (
                  <span class="bowner" data-testid="board-owner">
                    {owner ? (
                      <>
                        <i class="bdot" style={{ background: owner.color }} aria-hidden="true" />
                        {owner.name}
                      </>
                    ) : (
                      t("prop.free")
                    )}
                    {street && level > 0 ? ` · ${levelNameText(level)}` : ""}
                    {pr?.mortgaged ? ` · ${t("prop.mortgagedTag")}` : ""}
                  </span>
                )}
                {here.length > 0 && (
                  <span class="bhere" data-testid="board-here">
                    <span aria-hidden="true">
                      {here.map((p) => (
                        <TokenIcon key={p.id} id={p.tokenId} size={20} />
                      ))}
                    </span>{" "}
                    {t("board.here", { names: here.map((p) => p.name).join(", ") })}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
