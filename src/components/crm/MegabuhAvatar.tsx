/**
 * Аватар МЕГАБУХ — живой бухгалтер в чате.
 */
const MegabuhAvatar = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
  <img
    src="/assets/megabuh-avatar.jpg"
    alt="МЕГАБУХ"
    width={size}
    height={size}
    className={`shrink-0 rounded-full object-cover object-top shadow-sm ${className}`}
    style={{ width: size, height: size }}
  />
);

export default MegabuhAvatar;
