import { at } from "../safe.ts";
import {
  attemptSync,
  BOARD,
  buildBlockerMsg,
  buildCostFor,
  groupTiles,
  mortgageBlockerMsg,
  playerProperties,
  sellBlockerMsg,
  sellValue,
  unmortgageBlockerMsg,
  unmortgageCost,
  legalActions,
  type EngineMsg,
  type GameAction,
} from "@poly/engine";
import { engineText } from "../i18n/engine.ts";
import { t } from "../i18n/index.ts";
import { levelNameText, tileKindText } from "../i18n/labels.ts";
import { SecuritiesPanel } from "./Securities.tsx";
import { BoardList } from "./Board.tsx";
import { sendAction } from "../net/ws.ts";
import { set, useApp } from "../net/store.ts";
import {
  asGame,
  money,
  playerName,
  Postmark,
  Swatch,
  useGameState,
  useTheme,
  useThemeText,
} from "./util.tsx";
import { inkOn, paletteFor } from "./palette.ts";
import { useGate } from "./gate.ts";
import { panelProps, tabKeys, tabProps } from "./tabs.ts";

function useTileActions() {
  const state = useGameState();
  const you = useApp((s) => s.you);
  const busy = useApp((s) => s.busy);
  let legal: GameAction["type"][] = [];
  if (you) {
    const r = attemptSync("property:legal", () => legalActions(asGame(state), you));
    if (r.ok) legal = r.value;
  }
  const g = asGame(state);
  const theme = useTheme();
  const gate = useGate();
  const send = (a: GameAction) => {
    sendAction(a);
  };
  /** why `action` is not possible on `tile` right now (null = possible), in the current language */
  const blocker = (
    action: GameAction["type"],
    check: (playerId: string, tile: number) => EngineMsg | null,
    tile: number,
  ): string | null => {
    if (gate.reason) {
      return gate.reason;
    }
    if (busy) {
      return t("prop.blocker.busy");
    }
    if (!you) {
      return t("prop.notNow");
    }
    // the tile's own reason first ("needs the whole colour group"), the turn only when the tile would be fine
    const why = check(you, tile);
    if (why) {
      return engineText(why, theme, playerName);
    }
    if (!legal.includes(action)) {
      return state.players[state.current]?.id === you
        ? t("prop.notNow")
        : t("prop.blocker.notYourTurn");
    }
    return null;
  };
  return {
    state,
    you,
    gate,
    build: (tile: number) => blocker("build", (p, x) => buildBlockerMsg(g, p, x), tile),
    sell: (tile: number) => blocker("sell-building", (p, x) => sellBlockerMsg(g, p, x), tile),
    mortgage: (tile: number) => blocker("mortgage", (p, x) => mortgageBlockerMsg(g, p, x), tile),
    unmortgage: (tile: number) =>
      blocker("unmortgage", (p, x) => unmortgageBlockerMsg(g, p, x), tile),
    send,
  };
}

export function PropertyCard({ tile, onClose }: { tile: number; onClose: () => void }) {
  const theme = useTheme();
  const texts = useThemeText();
  const A = useTileActions();
  const def = at(BOARD, tile);
  const pr = A.state.properties[tile];
  const owner = A.state.players.find((p) => p.id === pr?.owner);
  const mine = !!A.you && pr?.owner === A.you;
  const name = theme.tileNames[tile] ?? t("tile.fallback", { n: tile });
  const color = def.kind === "street" ? theme.groupColors[def.group ?? 0] : undefined;
  const lvl = pr?.level ?? 0;
  const cost = def.kind === "street" ? buildCostFor(def, lvl + 1) : 0;
  const bb = mine ? A.build(tile) : null,
    sb = mine ? A.sell(tile) : null,
    mb = mine ? A.mortgage(tile) : null,
    ub = mine ? A.unmortgage(tile) : null;

  const stampColor = color ?? paletteFor(theme.id).deep;
  const label = def.kind === "street" ? texts.groupNames[def.group ?? 0] : tileKindText(def.kind);
  return (
    <div
      class="propcard postcard"
      role="dialog"
      aria-label={name}
      data-testid="property-card"
      data-tile={tile}
      onKeyDown={(e) => {
        // a non-modal inspector: Escape closes it while the focus is inside
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div class="airmail" aria-hidden="true" />
      <button
        class="x close"
        data-testid="close-card"
        aria-label={t("common.close")}
        onClick={onClose}
      >
        ×
      </button>
      <div class="phead">
        <div class="phead-text">
          <small>{t("prop.postcard", { label: label ?? "" })}</small>
          <h3>{name}</h3>
        </div>
        <div
          class="stamp"
          style={{ "--sc": stampColor, "--st": inkOn(stampColor) }}
          aria-hidden="true"
        >
          <span class="stamp-in">
            {def.price !== undefined ? (
              <>
                <b>{def.price}</b>
                <i>{theme.currency.symbol}</i>
              </>
            ) : (
              <b>★</b>
            )}
          </span>
        </div>
        {owner && <Postmark theme={theme} color={owner.color} class="on-card" />}
      </div>
      <div class="pbodyc">
        {def.price !== undefined && (
          <div class="kv">
            <span>{t("prop.price")}</span>
            <b>{money(theme, def.price)}</b>
          </div>
        )}
        {def.kind === "street" && def.rent && (
          <table class="rents" aria-label={t("prop.rentTable")}>
            <tbody>
              {def.rent.map((r, i) => {
                const current = !!pr?.owner && lvl === i;
                return (
                  <tr class={current ? "cur" : ""} aria-current={current ? "true" : undefined}>
                    <th scope="row">
                      {levelNameText(i)}
                      {current && <em class="curtag"> · {t("prop.current")}</em>}
                    </th>
                    <td>{money(theme, r)}</td>
                  </tr>
                );
              })}
              <tr class="dim">
                <th scope="row">{t("prop.groupBonus")}</th>
                <td>{money(theme, (def.rent[0] ?? 0) * 2)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {def.kind === "station" && def.rent && (
          <table class="rents" aria-label={t("prop.rentTable")}>
            <tbody>
              {def.rent.map((r, i) => (
                <tr>
                  <th scope="row">
                    {t(i ? "prop.stations.many" : "prop.stations.one", { n: i + 1 })}
                  </th>
                  <td>{money(theme, r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {def.kind === "utility" && def.rent && (
          <table class="rents" aria-label={t("prop.rentTable")}>
            <tbody>
              {def.rent.map((r, i) => (
                <tr>
                  <th scope="row">
                    {t(i ? "prop.utilities.many" : "prop.utilities.one", { n: i + 1 })}
                  </th>
                  <td>{t("prop.utilityRent", { n: r })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {def.kind === "tax" && (
          <div class="kv">
            <span>{t("prop.tax")}</span>
            <b>{money(theme, def.taxAmount ?? 0)}</b>
          </div>
        )}
        {def.kind === "street" && (
          <div class="kv small">
            <span>{t("prop.houseHotel")}</span>
            <b>{money(theme, def.buildCost ?? 0)}</b>
          </div>
        )}
        {def.kind === "street" && (
          <div class="kv small">
            <span>{levelNameText(6)}</span>
            <b>{money(theme, (def.buildCost ?? 0) * 2)}</b>
          </div>
        )}
        {def.mortgage !== undefined && (
          <div class="kv small">
            <span>{t("prop.mortgage")}</span>
            <b>{money(theme, def.mortgage)}</b>
          </div>
        )}
        {def.price !== undefined && (
          <div class="owner" data-testid="card-owner">
            {owner ? (
              <>
                <Swatch color={owner.color} /> {t("prop.owned")} <b>{owner.name}</b>
                {pr?.mortgaged ? ` · ${t("prop.mortgagedTag")}` : ""}
              </>
            ) : (
              t("prop.free")
            )}
          </div>
        )}
      </div>
      <div class="pfoot">
        {/* UI review F08: the reason of every unavailable action is visible text, not only a tooltip */}
        {mine && A.gate.reason && (
          <p class="why" role="status" data-testid="action-gate">
            {A.gate.reason}
          </p>
        )}
        {mine && def.kind === "street" && (
          <div class="pactions">
            <button
              class="cta slim"
              data-testid="build-button"
              disabled={!!bb}
              title={bb ?? ""}
              aria-describedby={bb && !A.gate.reason ? "why-build" : undefined}
              onClick={() => A.send({ type: "build", tile })}
            >
              {t(
                lvl >= 5
                  ? "prop.buildSkyscraper"
                  : lvl === 4
                    ? "prop.buildHotel"
                    : "prop.buildHouse",
                {
                  cost: money(theme, cost),
                },
              )}
            </button>
            {bb && !A.gate.reason && (
              <p class="why" id="why-build" data-testid="build-blocker">
                {bb}
              </p>
            )}
            <button
              class="ghost"
              data-testid="sell-button"
              disabled={!!sb}
              title={sb ?? ""}
              aria-describedby={sb && !A.gate.reason ? "why-sell" : undefined}
              onClick={() => A.send({ type: "sell-building", tile })}
            >
              {t("prop.sell", { amount: money(theme, sellValue(def, lvl)) })}
            </button>
            {sb && !A.gate.reason && (
              <p class="why" id="why-sell" data-testid="sell-blocker">
                {sb}
              </p>
            )}
          </div>
        )}
        {mine && def.mortgage !== undefined && (
          <div class="pactions">
            {pr?.mortgaged ? (
              <>
                <button
                  class="ghost"
                  data-testid="unmortgage-button"
                  disabled={!!ub}
                  title={ub ?? ""}
                  aria-describedby={ub && !A.gate.reason ? "why-mortgage" : undefined}
                  onClick={() => A.send({ type: "unmortgage", tile })}
                >
                  {t("prop.unmortgage", { cost: money(theme, unmortgageCost(def)) })}
                </button>
                {ub && !A.gate.reason && (
                  <p class="why" id="why-mortgage" data-testid="mortgage-blocker">
                    {ub}
                  </p>
                )}
              </>
            ) : (
              <>
                <button
                  class="ghost"
                  data-testid="mortgage-button"
                  disabled={!!mb}
                  title={mb ?? ""}
                  aria-describedby={mb && !A.gate.reason ? "why-mortgage" : undefined}
                  onClick={() => A.send({ type: "mortgage", tile })}
                >
                  {t("prop.takeMortgage", { amount: money(theme, def.mortgage) })}
                </button>
                {mb && !A.gate.reason && (
                  <p class="why" id="why-mortgage" data-testid="mortgage-blocker">
                    {mb}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {!mine && owner && A.you && owner.id !== A.you && (
          <div class="pactions">
            <button
              class="ghost"
              data-testid="offer-trade-button"
              onClick={() =>
                set({
                  selectedTile: null,
                  tradeOpen: true,
                  tradeDraft: { to: owner.id, wantTiles: [tile] },
                })
              }
            >
              {t("prop.offerTrade")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** own properties grouped by colour group; used in the desktop drawer and in the phone sheet */
export function PropertyList() {
  const theme = useTheme();
  const texts = useThemeText();
  const A = useTileActions();
  const mine = A.you ? playerProperties(asGame(A.state), A.you) : [];
  const groups = new Map<string, number[]>();
  for (const tl of mine) {
    const d = at(BOARD, tl);
    const key = d.kind === "street" ? `g${d.group}` : d.kind;
    groups.set(key, [...(groups.get(key) ?? []), tl]);
  }
  const entries = [...groups.entries()].sort(([a], [b]) =>
    a.startsWith("g") && b.startsWith("g")
      ? Number(a.slice(1)) - Number(b.slice(1))
      : a.startsWith("g")
        ? -1
        : b.startsWith("g")
          ? 1
          : a.localeCompare(b),
  );
  return (
    <>
      {mine.length === 0 && (
        <p class="note" data-testid="no-properties">
          {t("list.empty")}
        </p>
      )}
      <div class="dlist">
        {entries.map(([k, tiles]) => {
          const first = at(BOARD, at(tiles, 0));
          const isStreet = first.kind === "street";
          const group = first.group ?? 0;
          const full = isStreet && groupTiles(group).every((tl) => tiles.includes(tl));
          return (
            <section key={k}>
              <h4>
                {isStreet ? (
                  <>
                    <Swatch color={theme.groupColors[group] ?? "#999"} /> {texts.groupNames[group]}
                    {full && <em class="mono">{t("list.fullSet")}</em>}
                  </>
                ) : first.kind === "station" ? (
                  t("list.stations")
                ) : (
                  t("list.utilities")
                )}
              </h4>
              {tiles.map((tl) => {
                const pr = at(A.state.properties, tl);
                const def = at(BOARD, tl);
                return (
                  <div
                    class={`drow ${pr.mortgaged ? "mort" : ""}`}
                    key={tl}
                    data-testid="property-row"
                    data-tile={tl}
                    data-tile-name={theme.tileNames[tl]}
                    data-level={pr.level}
                    data-mortgaged={pr.mortgaged}
                  >
                    <button class="dname" onClick={() => set({ selectedTile: tl })}>
                      {theme.tileNames[tl]}
                    </button>
                    {isStreet && (
                      <span class="lvl">
                        {pr.level === 6 ? "🏙" : pr.level === 5 ? "🏨" : "🏠".repeat(pr.level)}
                      </span>
                    )}
                    {isStreet && (
                      <button
                        class="sq"
                        data-testid="row-build"
                        aria-label={t("list.buildAria", { tile: theme.tileNames[tl] ?? "" })}
                        title={
                          A.build(tl) ??
                          t("list.buildTitle", {
                            cost: money(theme, buildCostFor(def, pr.level + 1)),
                          })
                        }
                        disabled={!!A.build(tl)}
                        onClick={() => A.send({ type: "build", tile: tl })}
                      >
                        +
                      </button>
                    )}
                    {isStreet && (
                      <button
                        class="sq"
                        data-testid="row-sell"
                        aria-label={t("list.sellAria", { tile: theme.tileNames[tl] ?? "" })}
                        title={A.sell(tl) ?? t("list.sellTitle")}
                        disabled={!!A.sell(tl)}
                        onClick={() => A.send({ type: "sell-building", tile: tl })}
                      >
                        −
                      </button>
                    )}
                    {pr.mortgaged ? (
                      <button
                        class="sq wide"
                        data-testid="row-unmortgage"
                        title={
                          A.unmortgage(tl) ??
                          t("list.unmortgageTitle", { cost: money(theme, unmortgageCost(def)) })
                        }
                        disabled={!!A.unmortgage(tl)}
                        onClick={() => A.send({ type: "unmortgage", tile: tl })}
                      >
                        {t("list.unmortgageShort")}
                      </button>
                    ) : (
                      <button
                        class="sq wide"
                        data-testid="row-mortgage"
                        title={
                          A.mortgage(tl) ??
                          t("list.mortgageTitle", { amount: money(theme, def.mortgage ?? 0) })
                        }
                        disabled={!!A.mortgage(tl)}
                        onClick={() => A.send({ type: "mortgage", tile: tl })}
                      >
                        {t("list.mortgageShort")}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}

export function Drawer() {
  const hasSecurities = useApp((s) => s.state?.market !== undefined);
  const tab = useApp((s) => s.drawerTab);
  const active = tab === "securities" && !hasSecurities ? "props" : tab;
  const ids = hasSecurities
    ? (["props", "board", "securities"] as const)
    : (["props", "board"] as const);
  const title = t(
    active === "securities"
      ? "sec.title"
      : active === "board"
        ? "drawer.titleBoard"
        : "drawer.title",
  );
  return (
    <aside class="drawer panel" data-testid="drawer" data-tab={active} aria-label={title}>
      <div class="dhead">
        <h3>{title}</h3>
        <button class="x" aria-label={t("common.close")} onClick={() => set({ drawerOpen: false })}>
          ×
        </button>
      </div>
      <div
        class="dtabs"
        role="tablist"
        aria-label={t("drawer.title")}
        onKeyDown={tabKeys("drawer", ids, active, (id) =>
          set({
            drawerTab: id === "securities" ? "securities" : id === "board" ? "board" : "props",
          }),
        )}
      >
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            {...tabProps("drawer", id, active)}
            data-testid={`drawer-tab-${id}`}
            class={active === id ? "on" : ""}
            onClick={() => set({ drawerTab: id })}
          >
            {t(
              id === "props"
                ? "drawer.tab.props"
                : id === "board"
                  ? "drawer.tab.board"
                  : "drawer.tab.securities",
            )}
          </button>
        ))}
      </div>
      {/* the panel of the selected tab */}
      <div class="dpanel" {...panelProps("drawer", active)}>
        {active === "securities" ? (
          <SecuritiesPanel />
        ) : active === "board" ? (
          <div class="dlist boardwrap">
            <BoardList />
          </div>
        ) : (
          <PropertyList />
        )}
      </div>
    </aside>
  );
}
