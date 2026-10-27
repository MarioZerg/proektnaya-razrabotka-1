/** Фон страниц входа: швейный цех со шторами. На телефоне — вертикальный кадр, на ПК — широкий.
 *  Поверх — светлая вуаль, чтобы логотип, кнопки и текст оставались читаемыми. */
const LoginBackground = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    <picture>
      <source media="(min-width: 768px)" srcSet="/assets/login-bg-desktop.webp" />
      <img
        src="/assets/login-bg-mobile.webp"
        alt=""
        className="h-full w-full object-cover"
        decoding="async"
      />
    </picture>
    <div className="absolute inset-0 bg-background/75 backdrop-blur-[2px]" />
    <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/60" />
  </div>
);

export default LoginBackground;
