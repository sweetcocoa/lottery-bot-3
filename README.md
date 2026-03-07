# lottery-bot-3

GitHub Actions 기반 동행복권 자동구매/주간결과 요약 워크플로 골격이다.

## 빠른 시작

1. [`config/picks.yaml`](/Users/jonghochoi/workspace/lottery-bot-3/config/picks.yaml)에서 고정/랜덤 구매 전략을 정한다.
2. [`config/local.env.example`](/Users/jonghochoi/workspace/lottery-bot-3/config/local.env.example)를 참고해 `config/local.env`를 만든다.
3. `mock dry-run`으로 먼저 검증한다.

```sh
npm test
node --experimental-strip-types src/cli.ts buy --mode=dry-run
node --experimental-strip-types src/cli.ts summarize --mode=dry-run --artifact-source=local-fixture
```

## 로컬 workflow 검증

`act`가 설치되어 있으면 아래 스크립트로 GitHub Actions 자체를 로컬에서 재현할 수 있다.

기본값은 Apple Silicon에서도 프롬프트 없이 돌도록 `linux/amd64`와 `catthehacker/ubuntu:act-latest`를 강제한다.

```sh
scripts/local/act-buy-dry.sh
scripts/local/act-results-dry.sh
```

실사이트 로그인 검증 또는 live 실행은 `config/local.env`가 준비된 뒤에만 사용한다.

```sh
scripts/local/act-buy-live.sh
scripts/local/act-results-live.sh
```

## 랜덤 모드

### 로또

- `fixed`: 같은 번호 세트를 `count`만큼 구매
- `random_same`: 무작위 한 세트를 뽑아 동일하게 `count`만큼 구매
- `random_distinct`: 서로 다른 무작위 세트를 `count`만큼 구매

### 연금복권

- `fixed`: 지정한 조/번호를 구매
- `random`: 조/번호를 실행 시 생성

## 주의

- `mock dry-run`은 로그인하지 않는다.
- `browser/live`는 현재 로그인 smoke test와 artifact 생성까지 구현되어 있다.
- 실제 구매 셀렉터는 사이트 구조 변화에 따라 추가 보강이 필요할 수 있다.
