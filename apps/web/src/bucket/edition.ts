// A dedicated HTML entry fixes the edition across reloads and Home Screen launches.
export const ADMIN_TEST =
  !window.desktop && document.documentElement.dataset.edition === "admin-test";
export const EDITION_HOME = ADMIN_TEST
  ? `${import.meta.env.BASE_URL}admin-test/`
  : import.meta.env.BASE_URL;
