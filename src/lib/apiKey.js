// 인생 RPG 시스템 — 개인 API 키 관리
// 서버가 없는 베타 단계라, 사용자의 Anthropic API 키를 브라우저에만 저장하고
// 클라이언트에서 직접 api.anthropic.com을 호출합니다.
// (주의: 이 방식은 개인용/로컬 사용 전제입니다. 다른 사람과 공유되는 배포판에는
//  절대 이 방식을 쓰면 안 됩니다 — 반드시 서버리스 프록시 뒤로 API 키를 숨겨야 해요.
//  README의 "서버 붙이기" 단계를 참고하세요.)

const KEY = 'liferpg_api_key';

export function getApiKey() {
  return localStorage.getItem(KEY) || '';
}

export function setApiKey(value) {
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}

export function hasApiKey() {
  return !!getApiKey();
}
