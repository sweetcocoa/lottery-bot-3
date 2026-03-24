# lottery-bot-3

GitHub Actions 기반 동행복권 자동구매/주간결과 요약 워크플로다.

## 빠른 시작

1. [`config/picks.yaml`](/Users/jonghochoi/workspace/lottery-bot-3/config/picks.yaml)에서 고정/랜덤 구매 전략을 정한다.
2. [`config/local.env.example`](/Users/jonghochoi/workspace/lottery-bot-3/config/local.env.example)를 참고해 `config/local.env`를 만든다.
3. 기본 검증부터 돌린다.

```sh
npm ci
npm test
node --experimental-strip-types src/cli.ts buy --mode=dry-run
node --experimental-strip-types src/cli.ts buy --mode=dry-run --product=lotto
node --experimental-strip-types src/cli.ts buy --mode=dry-run --product=pension
node --experimental-strip-types src/cli.ts summarize --mode=dry-run --purchase-source=local-fixture
```

## 로컬 구매 검증

구매 workflow는 GitHub-hosted `macos-15` runner를 기준으로 동작한다. `act`로 동일 runner를 재현하지 않고, 로컬에서는 runner-native smoke 검증을 사용한다.

Playwright 브라우저가 아직 없으면 먼저 설치한다.

```sh
npx playwright install chromium
```

실사이트 로그인과 구매 페이지 진입만 확인하고, 실제 구매는 하지 않는 smoke 검증:

```sh
scripts/local/buy-smoke.sh
```

실사이트 로그인 + 구매내역 + 결과 조회만으로 `skip` / `would-buy`만 판정하고, 실제 구매는 하지 않는 live-check 검증:

```sh
scripts/local/buy-live-check.sh
```

직접 실행도 가능하다.

```sh
set -a
. ./config/local.env
set +a
node --experimental-strip-types src/cli.ts buy --mode=smoke
node --experimental-strip-types src/cli.ts buy --mode=live-check
```

## 로컬 workflow 검증

`results.yml`은 계속 Ubuntu runner 기준이라 `act`로 검증한다.

```sh
scripts/local/act-results-dry.sh
```

필요하면 live 결과 요약도 `act`로 돌릴 수 있다.

```sh
scripts/local/act-results-live.sh
```

실사이트 구매내역을 직접 읽는 runner-native 실행도 가능하다.

```sh
set -a
. ./config/local.env
set +a
npx playwright install chromium
node --experimental-strip-types src/cli.ts summarize --mode=live
```

## GitHub Actions 운영

- `buy.yml`
  - runner: `macos-15`
  - schedule: 매주 월요일 09:00 KST
  - manual mode: `dry-run`, `smoke`, `live-check`, `live`
  - manual product: `all`, `lotto`, `pension`
- `results.yml`
  - runner: `ubuntu-latest`
  - schedule: 매주 일요일 09:00 KST

운영 전에 권장 순서는 다음이다.

1. `buy.yml`을 `workflow_dispatch mode=dry-run`
2. `buy.yml`을 `workflow_dispatch mode=smoke`
3. `buy.yml`을 `workflow_dispatch mode=live-check`
4. `buy.yml`을 `workflow_dispatch mode=live`

수동 복구가 필요하면 상품만 따로 실행할 수 있다.

1. 로또만: `workflow_dispatch mode=live product=lotto`
2. 연금복권만: `workflow_dispatch mode=live product=pension`

## 랜덤 모드

### 로또

- `fixed`: 같은 번호 세트를 `count`만큼 구매
- `random_same`: 무작위 한 세트를 뽑아 동일하게 `count`만큼 구매
- `random_distinct`: 서로 다른 무작위 세트를 `count`만큼 구매

### 연금복권

- `fixed`: 지정한 조/번호를 구매
- `random`: 조/번호를 실행 시 생성

## 주의

- `dry-run`은 로그인하지 않는다.
- `smoke`는 로그인과 구매 페이지 진입만 확인하고 실제 구매는 하지 않는다.
- `live-check`는 로그인과 구매내역/결과 조회만 수행하고 실제 구매는 하지 않는다.
- `live`만 실제 번호 선택과 구매 확정을 수행한다.
- `results.yml`의 live 모드는 동행복권 구매내역을 직접 파싱해 주간 요약을 만든다.
- `results.yml` live 에도 `DHLOTTERY_USERNAME`, `DHLOTTERY_PASSWORD` secret 이 필요하다.
