-- A+B withdraw: persist txHash as soon as broadcast succeeds (before receipt).
ALTER TYPE "WithdrawStatus" ADD VALUE 'BROADCASTED';
