/** the bid offered when the auction opens or the highest bid moves: a raise of 10 percent, at least 10 */
export function defaultBid(highest: number): number {
  return highest + Math.max(10, Math.round(highest * 0.1));
}

/** one - / + press: `bid` moved by `delta`, kept between the highest bid plus 1 and what the player may bid */
export function stepBid(bid: number, delta: number, highest: number, maxBid: number): number {
  return Math.min(maxBid, Math.max(highest + 1, bid + delta));
}
