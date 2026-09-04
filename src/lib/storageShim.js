// 인생 RPG 시스템 — 로컬 저장소 어댑터
// 클로드 아티팩트의 window.storage API와 동일한 인터페이스를,
// 브라우저 localStorage로 흉내 낸 것입니다.
// 나중에 서버가 생기면 이 파일만 fetch 기반 구현으로 교체하면 됩니다.

const NS = 'liferpg::';

export function installStorageShim() {
  if (window.storage && window.storage.__isLocalShim) return; // 중복 설치 방지

  window.storage = {
    __isLocalShim: true,

    async get(key, _shared) {
      const raw = localStorage.getItem(NS + key);
      if (raw === null) return null;
      return { key, value: raw, shared: false };
    },

    async set(key, value, _shared) {
      localStorage.setItem(NS + key, value);
      return { key, value, shared: false };
    },

    async delete(key, _shared) {
      localStorage.removeItem(NS + key);
      return { key, deleted: true, shared: false };
    },

    async list(prefix, _shared) {
      const p = NS + (prefix || '');
      const keys = Object.keys(localStorage)
        .filter(k => k.startsWith(p))
        .map(k => k.slice(NS.length));
      return { keys, shared: false };
    },
  };
}
