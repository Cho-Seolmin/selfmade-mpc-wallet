import { sanitizeAuditData, AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventType } from './audit.constants';

describe('sanitizeAuditData (allow-list)', () => {
  it('keeps only allow-listed keys and truncates long strings', () => {
    const cleaned = sanitizeAuditData({
      toAddress: '0xabc',
      address: '0x1',
      otp: '123456',
      recoveryPin: '999999',
      shareA: 'secret-bytes',
      encryptedShareB: 'cipher',
      note: 'x'.repeat(600),
      scheme: 'dkls23',
      version: 1,
      remainingAttempts: 2,
      locked: false,
    }) as Record<string, unknown>;

    expect(cleaned).toEqual({
      toAddress: '0xabc',
      address: '0x1',
      scheme: 'dkls23',
      version: 1,
      remainingAttempts: 2,
      locked: false,
    });
    expect(cleaned).not.toHaveProperty('otp');
    expect(cleaned).not.toHaveProperty('note');
    expect(cleaned).not.toHaveProperty('shareA');
  });
});

describe('AuditService', () => {
  it('writes sanitized audit rows', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      withdrawalAuditLog: { create },
    };
    const audit = new AuditService(prisma as unknown as PrismaService);

    await audit.write({
      walletId: 'w1',
      userId: 'u1',
      eventType: AuditEventType.RECOVERY_FILE_CREATED,
      message: 'created',
      data: { otp: '123456', address: '0x1' },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        walletId: 'w1',
        eventType: 'RECOVERY_FILE_CREATED',
        data: { address: '0x1' },
      }),
    });
  });

  it('swallows write failures', async () => {
    const prisma = {
      withdrawalAuditLog: {
        create: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };
    const audit = new AuditService(prisma as unknown as PrismaService);
    await expect(
      audit.write({
        walletId: 'w1',
        eventType: AuditEventType.MPC_WALLET_CREATED,
      }),
    ).resolves.toBeUndefined();
  });
});
