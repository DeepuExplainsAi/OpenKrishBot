import type { Row } from './types.js';

/**
 * The WhatsApp side of a chat with the main Bot, without any socket: who may talk to it, how messages become
 * turns, and how replies and approval cards are written back. The socket (whatsapp.ts) feeds it and sends
 * what it returns, so all of this can be tested.
 */

/** Bot replies start with this invisible mark so the bridge never mistakes its own message for a command. */
export const MARK = '\u200B';

export interface RelayDeps {
  botId: string;
  /** Is this sender allowed to command the Bot? */
  allowed(jid: string, fromMe: boolean, isSelfChat: boolean): boolean;
  send(jid: string, text: string): Promise<void>;
  say(text: string): void;
  interrupt(): void;
  pendingApproval(): string | null;
  answerApproval(approvalId: string, decision: 'allow' | 'always' | 'deny'): void;
}

const YES = /^(1|y|yes|allow|ok|haan|ha)$/i;
const ALWAYS = /^(2|always)$/i;
const NO = /^(3|n|no|deny|nahi|nahin)$/i;

export function createRelay(d: RelayDeps) {
  /** Where the current conversation lives; replies go there. */
  let chat: string | null = null;
  const sent = new Set<number>();

  return {
    async onMessage(jid: string, text: string, fromMe: boolean, isSelfChat: boolean) {
      const t = text.trim();
      if (!t || t.startsWith(MARK)) return;
      if (!d.allowed(jid, fromMe, isSelfChat)) return;
      chat = jid;
      const approval = d.pendingApproval();
      if (approval && (YES.test(t) || ALWAYS.test(t) || NO.test(t))) {
        d.answerApproval(approval, ALWAYS.test(t) ? 'always' : YES.test(t) ? 'allow' : 'deny');
        return;
      }
      if (/^(stop|ruko|cancel)$/i.test(t)) { d.interrupt(); await d.send(jid, `${MARK}Stopped.`); return; }
      d.say(t);
    },

    /** Called for each row change of the Bot's chat. Only conversations that started on WhatsApp are mirrored. */
    async onRow(row: Row) {
      if (!chat || sent.has(row.seq)) return;
      const b = row.body as any;
      if (b.type === 'message' && b.role === 'assistant' && b.streaming === false && b.text) {
        sent.add(row.seq);
        await d.send(chat, `${MARK}${b.text}`);
      } else if (b.type === 'card' && b.card === 'approval' && b.status === 'pending') {
        sent.add(row.seq);
        await d.send(chat, `${MARK}${b.title}\n${b.detail ? b.detail + '\n' : ''}\nReply 1 = allow, 2 = always allow, 3 = deny`);
      } else if (b.type === 'card' && b.card === 'question' && b.status === 'pending') {
        sent.add(row.seq);
        await d.send(chat, `${MARK}${b.question}\n${(b.options ?? []).map((o: string) => `• ${o}`).join('\n')}`);
      } else if (b.type === 'notice' && b.tone === 'error' && b.text) {
        sent.add(row.seq);
        await d.send(chat, `${MARK}⚠️ ${b.text}`);
      }
    },
    forget() { chat = null; sent.clear(); },
  };
}

/** Phone number or jid -> bare digits. */
export const digits = (s: string) => s.replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');

/** WhatsApp text limit is generous but long replies are unreadable: split on paragraph boundaries. */
export function chunk(text: string, max = 3500): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
