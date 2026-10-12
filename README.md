# TravelPlan 설치 및 실행 가이드

## 1. 사전 준비

| 항목 | 설명 |
|---|---|
| [Node.js](https://nodejs.org) | 18 버전 이상 |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Redis 실행용 |
| [Git](https://git-scm.com) | 저장소 내려받기용 |

> Windows에서는 Docker Desktop 설치 시 **WSL2 설치/업데이트**가 필요합니다.

## 2. Docker 사전 설정 (Windows, 최초 1회)

1. **PowerShell을 관리자 권한으로 실행**합니다.
2. 아래 명령을 순서대로 실행해 가상 머신 플랫폼을 켜고 WSL을 설치합니다.

   ```powershell
   Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
   ```

   ```powershell
   wsl --install
   ```

3. WSL 설치 중 **리눅스 사용자 계정(이름/비밀번호)** 을 만들라는 안내가 나오면 생성합니다.
4. **컴퓨터를 재부팅**합니다.
5. 재부팅 후 **Docker Desktop을 실행**하고, 약관 동의와 계정 생성/로그인을 마칩니다.
   왼쪽 아래에 **Engine running**이 보이면 준비 완료입니다.

## 3. 프로젝트 설치 및 실행

일반 PowerShell(또는 터미널)에서 순서대로 실행합니다.

```powershell
git clone https://github.com/hsy21/TP
cd TP
npm install
copy security\.env.example .env
docker compose up -d
npm start
```

| 명령 | 설명 |
|---|---|
| `git clone` / `cd TP` | 프로젝트 내려받기 |
| `npm install` | 의존성 설치 |
| `copy security\.env.example .env` | 환경 설정 파일(`.env`) 생성 |
| `docker compose up -d` | Redis 컨테이너 실행 (로그인/토큰 저장에 필요) |
| `npm start` | 서버 실행 |

정상적으로 켜졌다면 브라우저에서 **http://localhost:8000** 으로 접속합니다.

## 4. 길찾기 기능 설정 (TMAP 키)

대중교통 길찾기를 쓰려면 TMAP 앱 키가 필요합니다. 키가 없어도 서버는 켜지고, 길찾기 기능만 동작하지 않습니다.

1. https://openapi.sk.com 에서 로그인 후 앱을 만들고 **대중교통 API**를 신청해 App Key를 발급받습니다.
2. 프로젝트 폴더의 `.env` 파일 맨 아래에 추가합니다.

   ```
   TMAP_APP_KEY=발급받은_TMAP_API_키
   ```

3. 서버를 껐다가(`Ctrl + C`) 다시 `npm start`로 실행합니다.

> `.env`는 키가 들어 있는 파일이므로 GitHub에 올리지 마세요. (`.gitignore`에 이미 제외되어 있습니다.)

## 5. 다음 실행부터

Docker Desktop을 켜 둔 상태에서 아래만 실행하면 됩니다.

```powershell
cd TP
npm start
```

Redis 컨테이너는 Docker가 켜지면 자동으로 다시 실행됩니다.

## 6. 문제 해결

| 증상 | 해결 방법 |
|---|---|
| `[redis] 연결 실패` 로그 | Docker Desktop이 켜져 있는지 확인하고 `docker compose up -d`를 다시 실행 |
| `docker` 명령을 찾을 수 없음 | Docker Desktop 설치 후 터미널(또는 PC)을 재시작 |
| 포트 8000이 이미 사용 중 | `.env`에 `PORT=원하는포트`를 추가 |
| DB를 초기화하고 싶음 | 서버를 끄고 `travel.db`를 삭제한 뒤 다시 실행 |
