/** 2-of-3 threshold MPC wallet configuration. */
export const MPC_THRESHOLD = 2;
export const MPC_PARTIES = 3;

/** Party role → DKLS party id (0-based). */
export const MPC_PARTY = {
  A: 0, // Browser
  B: 1, // Main server
  C: 2, // Recovery server
} as const;

export type MpcPartyRole = keyof typeof MPC_PARTY;
export type MpcPartyId = (typeof MPC_PARTY)[MpcPartyRole];

/** BIP32 chain path used by Silence Laboratories SignSession examples. */
export const MPC_CHAIN_PATH = 'm';

export const MPC_SCHEME = 'dkls23' as const;
export const MPC_SCHEME_VERSION = 1 as const;
