/**
 * Minimal structural types matching Silence Laboratories DKLS WASM bindings.
 * Kept environment-agnostic so Node and Web packages can both satisfy them.
 */

export type MpcMessage = {
  free(): void;
  clone(): MpcMessage;
  from_id: number;
  to_id?: number;
  readonly payload: Uint8Array;
};

export type MpcKeyshare = {
  free(): void;
  toBytes(): Uint8Array;
  readonly partyId: number;
  readonly participants: number;
  readonly threshold: number;
  readonly publicKey: Uint8Array;
};

export type MpcKeygenSession = {
  free(): void;
  createFirstMessage(): MpcMessage;
  calculateChainCodeCommitment(): Uint8Array;
  handleMessages(
    msgs: MpcMessage[],
    commitments?: Array<Uint8Array>,
    seed?: Uint8Array,
  ): MpcMessage[];
  keyshare(): MpcKeyshare;
  error(): Error | undefined;
};

export type MpcSignSession = {
  free(): void;
  createFirstMessage(): MpcMessage;
  handleMessages(msgs: MpcMessage[], seed?: Uint8Array): MpcMessage[];
  lastMessage(messageHash: Uint8Array): MpcMessage;
  /** Returns [r, s] as 32-byte arrays. */
  combine(msgs: MpcMessage[]): Uint8Array[];
  error(): Error | undefined;
};

export type KeygenSessionCtor = new (
  participants: number,
  threshold: number,
  partyId: number,
  seed?: Uint8Array,
) => MpcKeygenSession;

/** Silence Labs SignSession consumes a concrete Keyshare; keep ctor loose for Node/Web dual packages. */
export type SignSessionCtor = new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyshare: any,
  chainPath: string,
  seed?: Uint8Array,
) => MpcSignSession;

export type KeyshareStatic = {
  fromBytes(bytes: Uint8Array): MpcKeyshare;
};

/** Wire format for HTTP / WebSocket transport (never log payload). */
export type MpcWireMessage = {
  from: number;
  to?: number;
  payloadB64: string;
};

export type MpcKeyshareRecord = {
  partyId: number;
  participants: number;
  threshold: number;
  /** Compressed SEC1 public key (33 bytes), hex 0x-prefixed. */
  publicKeyHex: string;
  /** Opaque keyshare bytes, base64. Treat as secret material. */
  shareB64: string;
};

export type MpcEcdsaSignature = {
  r: Uint8Array;
  s: Uint8Array;
  /** Ethereum recovery id (27 or 28). */
  v: number;
};
