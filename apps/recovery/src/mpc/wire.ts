/** Local wire helpers — keep Recovery free of TS-source workspace imports at runtime. */

export const MPC_PARTIES = 3;
export const MPC_THRESHOLD = 2;
export const MPC_PARTY_B = 1;
export const MPC_PARTY_C = 2;
/** BIP32 chain path used by Silence Laboratories SignSession. */
export const MPC_CHAIN_PATH = 'm';


export type WireMessage = {
  from: number;
  to?: number;
  payloadB64: string;
};

export type MpcMessageLike = {
  free(): void;
  clone(): MpcMessageLike;
  from_id: number;
  to_id?: number;
  readonly payload: Uint8Array;
};

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function publicKeyToHex(publicKey: Uint8Array): string {
  return `0x${Buffer.from(publicKey).toString('hex')}`;
}

export function filterMessages(
  msgs: MpcMessageLike[],
  partyId: number,
): MpcMessageLike[] {
  return msgs.filter((m) => m.from_id !== partyId).map((m) => m.clone());
}

export function selectMessages(
  msgs: MpcMessageLike[],
  partyId: number,
): MpcMessageLike[] {
  return msgs.filter((m) => m.to_id === partyId).map((m) => m.clone());
}

export function encodeWireMessage(msg: MpcMessageLike): WireMessage {
  return {
    from: msg.from_id,
    ...(msg.to_id === undefined ? {} : { to: msg.to_id }),
    payloadB64: bytesToBase64(msg.payload),
  };
}

export function encodeWireMessages(msgs: MpcMessageLike[]): WireMessage[] {
  return msgs.map((m) => encodeWireMessage(m));
}

export function decodeWireMessages(
  MessageCtor: new (
    payload: Uint8Array,
    from: number,
    to?: number,
  ) => MpcMessageLike,
  wires: WireMessage[],
): MpcMessageLike[] {
  return wires.map(
    (w) => new MessageCtor(base64ToBytes(w.payloadB64), w.from, w.to),
  );
}
