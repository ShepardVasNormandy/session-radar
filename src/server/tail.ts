import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { splitLines } from "./transcript.ts";

export interface TailState {
  offset: number;
  carry: string;
}

export function freshTail(): TailState {
  return { offset: 0, carry: "" };
}

export interface TailResult {
  lines: string[];
  state: TailState;
  reset: boolean;
}

export async function readNewLines(path: string, state: TailState): Promise<TailResult> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return { lines: [], state, reset: false };
  }

  if (size < state.offset) {
    const rereadFrom = await readSlice(path, freshTail(), size);
    return { ...rereadFrom, reset: true };
  }
  if (size === state.offset) return { lines: [], state, reset: false };
  return { ...(await readSlice(path, state, size)), reset: false };
}

async function readSlice(path: string, state: TailState, size: number): Promise<Omit<TailResult, "reset">> {
  const text = await Bun.file(path).slice(state.offset, size).text();
  const { lines, carry } = splitLines(text, state.carry);
  return { lines, state: { offset: size, carry } };
}

export async function streamLines(path: string, onLine: (line: string) => void): Promise<number> {
  const decoder = new TextDecoder();
  let carry = "";
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.byteLength;
    const { lines, carry: next } = splitLines(decoder.decode(chunk, { stream: true }), carry);
    carry = next;
    for (const line of lines) onLine(line);
  }
  const tail = carry + decoder.decode();
  if (tail.length > 0) onLine(tail);
  return bytes;
}
