import type { MpcMessage, MpcWireMessage } from './types';

/** Broadcast / other-party messages: exclude messages authored by `partyId`. */
export function filterMessages(
  msgs: MpcMessage[],
  partyId: number,
): MpcMessage[] {
  return msgs.filter((m) => m.from_id !== partyId).map((m) => m.clone());
}

/** Point-to-point messages addressed to `partyId`. */
export function selectMessages(
  msgs: MpcMessage[],
  partyId: number,
): MpcMessage[] {
  return msgs.filter((m) => m.to_id === partyId).map((m) => m.clone());
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function encodeWireMessage(msg: MpcMessage): MpcWireMessage {
  return {
    from: msg.from_id,
    ...(msg.to_id === undefined ? {} : { to: msg.to_id }),
    payloadB64: bytesToBase64(msg.payload),
  };
}

export function encodeWireMessages(msgs: MpcMessage[]): MpcWireMessage[] {
  return msgs.map((m) => encodeWireMessage(m));
}

export function decodeWireMessage(
  MessageCtor: new (
    payload: Uint8Array,
    from: number,
    to?: number,
  ) => MpcMessage,
  wire: MpcWireMessage,
): MpcMessage {
  return new MessageCtor(base64ToBytes(wire.payloadB64), wire.from, wire.to);
}

export function decodeWireMessages(
  MessageCtor: new (
    payload: Uint8Array,
    from: number,
    to?: number,
  ) => MpcMessage,
  wires: MpcWireMessage[],
): MpcMessage[] {
  return wires.map((w) => decodeWireMessage(MessageCtor, w));
}
