import { ConflictException } from '@nestjs/common';
import { MpcErrorCode } from '../common/errors/mpc-error-codes';
import {
  STALE_EMERGENCY_PROCESSING_MS,
  settleOpenEmergencyBcOrThrow,
  signedRawFromMetadata,
} from './emergency-bc-withdraw';

describe('settleOpenEmergencyBcOrThrow', () => {
  const walletId = 'w1';

  function dbWith(rows: any[], updates: any[] = []) {
    return {
      withdrawRequest: {
        findMany: jest.fn(async () => rows),
        update: jest.fn(async ({ where, data }: any) => {
          updates.push({ where, data });
          return { id: where.id, ...data };
        }),
      },
    };
  }

  it('fails stale PROCESSING without txHash so the step can be prepared again', async () => {
    const updates: any[] = [];
    const db = dbWith(
      [
        {
          id: 'wr-stale',
          status: 'PROCESSING',
          txHash: null,
          amount: '1',
          toAddress: '0x2222222222222222222222222222222222222222',
          createdAt: new Date(Date.now() - STALE_EMERGENCY_PROCESSING_MS - 1),
          metadata: { mode: 'EMERGENCY_BC_RELAY', asset: 'ETH' },
        },
      ],
      updates,
    );

    const result = await settleOpenEmergencyBcOrThrow({
      db: db as any,
      walletId,
      getReceipt: async () => null,
    });

    expect(result).toEqual({ action: 'clear' });
    expect(updates[0]).toMatchObject({
      where: { id: 'wr-stale' },
      data: { status: 'FAILED' },
    });
  });

  it('409s on fresh PROCESSING without txHash (do not resign while another request may be signing)', async () => {
    const db = dbWith([
      {
        id: 'wr-live',
        status: 'PROCESSING',
        txHash: null,
        amount: '1',
        toAddress: '0x2222222222222222222222222222222222222222',
        createdAt: new Date(),
        metadata: { mode: 'EMERGENCY_BC_RELAY', asset: 'ERC20' },
      },
    ]);

    await expect(
      settleOpenEmergencyBcOrThrow({
        db: db as any,
        walletId,
        getReceipt: async () => null,
      }),
    ).rejects.toMatchObject({
      response: { code: MpcErrorCode.SIGN_SESSION_BUSY },
    });
    expect(db.withdrawRequest.update).not.toHaveBeenCalled();
  });

  it('returns rebroadcast when BROADCASTED has no receipt and signed raw is stored', async () => {
    const db = dbWith([
      {
        id: 'wr-bc',
        status: 'BROADCASTED',
        txHash: '0xabc',
        amount: '1',
        toAddress: '0x2222222222222222222222222222222222222222',
        createdAt: new Date(),
        metadata: {
          mode: 'EMERGENCY_BC_RELAY',
          asset: 'ETH',
          signedRaw: '0xdead',
        },
      },
    ]);

    const result = await settleOpenEmergencyBcOrThrow({
      db: db as any,
      walletId,
      getReceipt: async () => null,
    });

    expect(result).toEqual({
      action: 'rebroadcast',
      id: 'wr-bc',
      txHash: '0xabc',
      signedRaw: '0xdead',
    });
    expect(ConflictException).toBeDefined();
  });

  it('marks BROADCASTED EXECUTED when receipt succeeded', async () => {
    const updates: any[] = [];
    const db = dbWith(
      [
        {
          id: 'wr-bc',
          status: 'BROADCASTED',
          txHash: '0xabc',
          amount: '1',
          toAddress: '0x2222222222222222222222222222222222222222',
          createdAt: new Date(),
          metadata: { mode: 'EMERGENCY_BC_RELAY', asset: 'ETH' },
        },
      ],
      updates,
    );

    const result = await settleOpenEmergencyBcOrThrow({
      db: db as any,
      walletId,
      getReceipt: async () => ({ status: 1 }),
    });

    expect(result).toEqual({ action: 'clear' });
    expect(updates[0].data.status).toBe('EXECUTED');
  });
});

describe('signedRawFromMetadata', () => {
  it('reads signedRaw from emergency metadata only', () => {
    expect(
      signedRawFromMetadata({
        mode: 'EMERGENCY_BC_RELAY',
        asset: 'ETH',
        signedRaw: '0xabc',
      }),
    ).toBe('0xabc');
    expect(signedRawFromMetadata({ mode: 'NORMAL_AB' })).toBeNull();
  });
});
