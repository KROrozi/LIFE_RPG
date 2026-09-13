# 인생 RPG 시스템 (베타)

인생을 게이미피케이션한 개인용 라이프 트래커입니다. 6개 스탯(활력/지력/창의/소셜/멘탈/자원),
레벨업에 따라 자동으로 어려워지는 루틴, AI 온보딩 설문, 메모→서브퀘스트 변환 기능이 있습니다.

> **베타 단계 안내**: 아직 서버가 없어서, 모든 데이터(캐릭터/퀘스트/기록)와 API 키는
> **이 브라우저(이 기기)에만** 저장됩니다. 다른 기기에서 열면 처음부터 다시 시작해요.
> 여러 명이 같이 쓰는 배포판이 아니라 **개인 로컬 사용**을 전제로 만들어졌습니다.

## 시작하기

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 열면 됩니다.

## API 키 설정 (필수)

AI 온보딩, 메모→서브퀘스트 변환, 루틴 난이도 재조정 기능을 쓰려면 본인의 **Gemini(Google AI) API 키**가 필요해요.
이제는 API 키가 없으면 뜨는 화면 자체에 발급 링크와 입력창이 바로 보여서, 별도로 이 문서를 안 봐도 진행할 수 있어요.
그래도 순서를 정리하면:

### 1. API 키 발급받기

1. https://aistudio.google.com/apikey 접속 (구글 계정으로 로그인)
2. **Get API key** 또는 **Create API key** 버튼 클릭
3. `AIza`로 시작하는 키가 생성됨 — 복사해두기

무료 티어로 충분히 쓸 수 있어요.

### 2. 앱에 등록하기

API 키가 없으면 화면에 아래처럼 바로 뜹니다 — 여기서 Google AI Studio 링크 누르고, 발급받은 키를
그 자리에 있는 입력창에 붙여넣고 "저장하고 계속하기"만 누르면 하던 작업이 이어서 진행돼요.

우측 상단 **"⚙ API 키"** 버튼을 눌러서 미리 등록해둘 수도 있어요.

키는 이 브라우저의 `localStorage`에만 저장되고, Google 서버 외에는 어디로도 전송되지 않습니다.
(개발자 도구 콘솔에서 `localStorage` 확인 가능)

### 키를 바꾸거나 지우고 싶을 때

우측 상단 "⚙ API 키" 버튼을 다시 누르면 현재 저장된 키가 입력창에 미리 채워져 있어요.
- 새 키로 덮어쓰려면 지우고 새로 붙여넣기
- 완전히 지우려면 입력창을 비운 채로 확인

⚠️ **주의**: 이 방식은 API 키가 브라우저 네트워크 요청에 그대로 노출되는 구조라 **개인이 혼자 쓸 때만**
안전합니다. 다른 사람과 같이 쓰는 사이트로 배포하려면 반드시 "서버 붙이기" 섹션을 먼저 진행하세요.

## 관리자 모드

퀘스트 풀 관리(수동 항목 추가/삭제), 주간 퀘스트 수동 추가는 관리자 모드에서만 보여요.
맨 아래 "관리자 모드" 버튼 → 비밀번호 `5951`.

## 프로젝트 구조

```
life-rpg-project/
├─ index.html            뼈대 HTML
├─ src/
│  ├─ main.js              앱 로직 전체 (state, render, 이벤트 핸들러)
│  ├─ style.css            스타일
│  └─ lib/
│     ├─ storageShim.js    localStorage를 window.storage 인터페이스로 흉내
│     └─ apiKey.js         API 키 저장/조회
├─ package.json
└─ vite.config.js
```

## GitHub에 올리기

```bash
git init
git add .
git commit -m "init: life rpg beta"
gh repo create life-rpg --private --source=. --push
# 또는 GitHub 웹에서 저장소 만들고
git remote add origin <저장소 URL>
git push -u origin main
```

## 배포 (정적 호스팅)

서버 없이도 정적 사이트로는 바로 배포할 수 있어요 (Vercel/Netlify/GitHub Pages 아무거나).
Vercel 기준:

```bash
npm i -g vercel
vercel
```

`vercel.com`에서 GitHub 저장소를 연결하면 그다음부터는 push할 때마다 자동 배포됩니다.

**단, 위의 "API 키 브라우저 저장" 방식은 본인 혼자 쓸 도메인일 때만 배포하세요.**
공개 링크로 다른 사람에게 공유하면 각자 자기 API 키를 넣어야 하니 사용성이 떨어지고,
분석/공유 데이터도 기기마다 따로 놀아요.

## 다음 단계 (서버 붙이기) — 나중에

여러 사람이 쓰거나 여러 기기에서 동기화하려면:

1. **AI 프록시**: Vercel Serverless Function(또는 Cloudflare Worker) 하나 추가 →
   서버 환경변수로 `GEMINI_API_KEY` 저장 → 브라우저는 이 함수를 호출,
   함수가 실제 Gemini API를 대신 호출. (`src/lib/apiKey.js`의 역할이 사라지고
   `callClaude()`의 fetch 주소만 이 함수 URL로 바뀌면 됨)
2. **데이터베이스**: Supabase(무료 티어) 추천. `src/lib/storageShim.js`를
   Supabase 호출로 교체하면 나머지 코드는 거의 그대로 재사용 가능.
3. **로그인**: Supabase Auth로 이메일 로그인 정도만 붙이면 충분.

이 단계들은 순서대로, 하나씩 진행하면 됩니다. 원하실 때 말씀해주시면 그때그때 이어서 만들게요.
