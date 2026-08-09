# Selfmade MPC Wallet — API

메인 NestJS API입니다. 프로젝트 전체 설명·로컬 실행·정책은 루트 [`README.md`](../../README.md)를 보세요.

## 역할

- JWT 인증 / 계정별 TOTP
- 2-of-3 DKG 오케스트레이션 (Browser A ↔ API B ↔ Recovery C)
- Share B AES-GCM 저장 (`WALLET_ENCRYPTION_KEY`)
- 비상 OTP + B+C 전액 출금 → `RETIRED`
- 지갑 목록·잔액·출금 이력·Audit

## 실행

```bash
# 루트에서
npm run dev:api
```

필요 env는 `apps/api/.env.example` 및 루트 README 참고.

## 테스트

```bash
npm test
npm run test:integration   # Recovery(:3001) 실행 중이어야 함
```
