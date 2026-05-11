/** LRC timestamp line: [mm:ss.xx] text — hundredths optional after dot. */
const LRC_LINE = /^\[(\d+):(\d+)(?:\.(\d+))?\]\s*(.*)$/;

export const isLikelyLrc = (text: string): boolean => {
  const body = text.replace(/^\uFEFF/, '');
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0) {
      continue;
    }
    return LRC_LINE.test(t);
  }
  return false;
};

const msToSrtTime = (ms: number): string => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(milli, 3)}`;
};

const DEFAULT_TAIL_MS = 2000;

export const lrcToSrt = (lrc: string): string => {
  const body = lrc.replace(/^\uFEFF/, '');
  const entries: { startMs: number; text: string }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.trim().match(LRC_LINE);
    if (!match) {
      continue;
    }
    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const centisec =
      match[3] !== undefined
        ? parseInt(match[3].padEnd(2, '0').slice(0, 2), 10)
        : 0;
    const startMs = (min * 60 + sec) * 1000 + centisec * 10;
    const text = (match[4] || '').trim();
    if (text.length > 0) {
      entries.push({ startMs, text });
    }
  }
  entries.sort((a, b) => a.startMs - b.startMs);
  let out = '';
  for (let i = 0; i < entries.length; i++) {
    const start = entries[i].startMs;
    const end =
      i + 1 < entries.length
        ? Math.max(entries[i + 1].startMs, start + 1)
        : start + DEFAULT_TAIL_MS;
    out += `${i + 1}\n`;
    out += `${msToSrtTime(start)} --> ${msToSrtTime(end)}\n`;
    out += `${entries[i].text}\n\n`;
  }
  return out.length > 0 ? out.replace(/\n*$/, '\n') : '';
};

export const normalizeInlineSubtitlesToSrt = (text: string): string =>
  isLikelyLrc(text) ? lrcToSrt(text) : text;
