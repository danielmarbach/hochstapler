// Chat contract shared by server and client (docs/DESIGN.md #69). The rules (filters, limits) live on the server; this
// file only holds what both sides must agree on: modes, quick messages, reject reasons and the host's settings.
import { z } from "zod";
import type { PlayerId } from "./types.ts";

/** `free`: typed text through the server filters; `quick`: only the predefined messages below; `off`: no chat. */
export const CHAT_MODES = ["free", "quick", "off"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];
export const DEFAULT_CHAT_MODE: ChatMode = "free";

/** Longest typed message in characters (code points) after cleaning. */
export const MAX_CHAT_LENGTH = 200;
/** Chat lines the server keeps (in memory, per game) and replays to seated players. */
export const MAX_CHAT_LINES = 50;
/** Hosts can mute at most as many players as a game has seats. */
export const MAX_MUTED = 8;

/** Predefined phrases; the texts are translated by the client (`chat.quick.<id>`), the server only knows the ids. */
export const QUICK_PHRASE_IDS = [
  "hello",
  "gg",
  "nice",
  "lucky",
  "ohno",
  "thanks",
  "sorry",
  "trade",
  "stillthere",
  "bye",
] as const;
/** A small emoji set; no translation needed. */
export const QUICK_EMOJIS = {
  smile: "🙂",
  laugh: "😂",
  wow: "😮",
  sad: "😢",
  party: "🎉",
  thumbsup: "👍",
} as const;
export const QUICK_EMOJI_IDS = Object.keys(QUICK_EMOJIS) as (keyof typeof QUICK_EMOJIS)[];

export const QUICK_CHAT_IDS = [...QUICK_PHRASE_IDS, ...QUICK_EMOJI_IDS.map((e) => `e-${e}`)] as [
  QuickPhraseId | QuickEmojiChatId,
  ...(QuickPhraseId | QuickEmojiChatId)[],
];
export type QuickPhraseId = (typeof QUICK_PHRASE_IDS)[number];
export type QuickEmojiChatId = `e-${keyof typeof QUICK_EMOJIS}`;
export type QuickChatId = QuickPhraseId | QuickEmojiChatId;

export function isQuickEmoji(id: QuickChatId): id is QuickEmojiChatId {
  return id.startsWith("e-");
}
export function quickEmoji(id: QuickEmojiChatId): string {
  return QUICK_EMOJIS[id.slice(2) as keyof typeof QUICK_EMOJIS];
}

/** Why the server did not publish a message (sent as `chat-rejected`; the client shows a translated hint). */
export const CHAT_REJECT_REASONS = [
  "off", // chat is switched off
  "quick", // only quick messages are allowed right now
  "muted", // the host muted this player
  "link", // link, address or web domain
  "contact", // e-mail, phone number, messenger or similar contact data
  "language", // not family friendly
  "invalid", // empty, invisible or direction-changing characters
  "length", // longer than MAX_CHAT_LENGTH
  "rate", // too many messages in a short time
] as const;
export type ChatRejectReason = (typeof CHAT_REJECT_REASONS)[number];

export interface ChatSettings {
  mode: ChatMode;
  /** players the host muted; they read but cannot write */
  muted: PlayerId[];
}
export const DEFAULT_CHAT_SETTINGS: ChatSettings = { mode: DEFAULT_CHAT_MODE, muted: [] };

const playerId = z.string().min(1).max(16);
export const ChatModeSchema = z.enum(CHAT_MODES);
export const ChatSettingsSchema = z.object({
  mode: ChatModeSchema,
  muted: z.array(playerId).max(MAX_MUTED),
});
export const QuickChatIdSchema = z.enum(QUICK_CHAT_IDS);

/** PATCH /api/games/:id/chat (host only): switch the mode and/or mute or unmute one player. */
export const ChatUpdateRequestSchema = z
  .strictObject({
    mode: ChatModeSchema.optional(),
    mute: z.strictObject({ playerId, muted: z.boolean() }).optional(),
  })
  .refine((v) => v.mode !== undefined || v.mute !== undefined, "nothing to change");
export type ChatUpdateRequest = z.infer<typeof ChatUpdateRequestSchema>;

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type ChatContractChecks = [
  Assert<Equals<z.infer<typeof ChatSettingsSchema>, ChatSettings>>,
  Assert<Equals<z.infer<typeof QuickChatIdSchema>, QuickChatId>>,
];
