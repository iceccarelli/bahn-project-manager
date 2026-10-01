/** Incremental Server-Sent-Events frame parser (fetch streams deliver arbitrary chunk boundaries). */
export interface SseFrame { event: string; data: string; id?: string }

export class SseParser {
  private buf = "";
  feed(chunk: string): SseFrame[] {
    this.buf += chunk;
    const frames: SseFrame[] = [];
    let i: number;
    // frames end with a blank line; tolerate \r\n
    while ((i = this.buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i).replace(/^\r?\n\r?\n/, "");
      let event = "message", id: string | undefined;
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue; // comment / heartbeat
        const c = line.indexOf(":");
        const field = c === -1 ? line : line.slice(0, c);
        const value = c === -1 ? "" : line.slice(c + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
        else if (field === "id") id = value;
      }
      if (data.length || event !== "message") frames.push({ event, data: data.join("\n"), ...(id ? { id } : {}) });
      else if (raw.split(/\r?\n/).every(l => l.startsWith(":") || !l)) frames.push({ event: "comment", data: "" });
    }
    return frames;
  }
}
