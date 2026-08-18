# TestToken (Sepolia)

학습/테스트용 ERC-20 (`TTK`). 배포 시 **10,000 TTK**가
`0xe2ECbBa8FC313bcD779A358dbE91a255A8bc071b`로 민팅되고, 같은 주소가 owner라서 이후 언제든 추가 민팅할 수 있습니다.

## 1. `.env` 채우기

`test-token/.env`에 Sepolia RPC URL과 위 지갑의 private key를 넣습니다.
이 지갑에 Sepolia ETH(가스)가 있어야 합니다.

## 2. 설치 · 배포

```bash
cd test-token
npm install
npm run deploy:sepolia
```

출력된 `TEST_TOKEN_ADDRESS=0x...`를 `.env`에 붙여넣습니다.

## 3. 추가 민팅

`.env`의 `MINT_AMOUNT`를 바꾼 뒤:

```bash
npm run mint:sepolia
```
