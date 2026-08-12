export type MessageIconName =
  | 'arrow-left'
  | 'building'
  | 'camera'
  | 'channel'
  | 'check'
  | 'close'
  | 'dm'
  | 'image'
  | 'link'
  | 'message'
  | 'pin'
  | 'reply'
  | 'search'
  | 'send'
  | 'team'
  | 'warning';

export function MessageIcon({ name, size = 20 }: { name: MessageIconName; size?: number }) {
  const common = { vectorEffect: 'non-scaling-stroke' as const };
  const paths: Record<MessageIconName, React.ReactNode> = {
    'arrow-left': <path {...common} d="m15 18-6-6 6-6M9 12h10" />,
    building: (
      <>
        <path {...common} d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4M8 21v-2h4v2M3 21h18" />
      </>
    ),
    camera: (
      <>
        <path {...common} d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z" />
        <circle {...common} cx="12" cy="13" r="3.5" />
      </>
    ),
    channel: (
      <>
        <path {...common} d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.4-4.2A7.8 7.8 0 0 1 3 13.3C3 8.7 7 5 12 5s9 3.7 9 8.3V15Z" />
        <path {...common} d="M8 12h8M8 15h5" />
      </>
    ),
    check: <path {...common} d="m5 12 4 4L19 6" />,
    close: <path {...common} d="m6 6 12 12M18 6 6 18" />,
    dm: (
      <>
        <circle {...common} cx="12" cy="8" r="4" />
        <path {...common} d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </>
    ),
    image: (
      <>
        <rect {...common} x="3" y="4" width="18" height="16" rx="2" />
        <circle {...common} cx="8.5" cy="9" r="1.5" />
        <path {...common} d="m4 17 4.5-4.5 3.3 3.3 2.2-2.2 6 6" />
      </>
    ),
    link: (
      <>
        <path {...common} d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path {...common} d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
      </>
    ),
    message: (
      <>
        <path {...common} d="M21 14a5 5 0 0 1-5 5H8l-5 3 1.3-4A8 8 0 1 1 21 14Z" />
        <path {...common} d="M8 11h8M8 14h5" />
      </>
    ),
    pin: <path {...common} d="m14 4 6 6-3 1-3.5 3.5.5 4.5-1 1-4-5-4-4 1-1 4.5.5L14 7l1-3ZM4 20l5-5" />,
    reply: <path {...common} d="m9 17-5-5 5-5M4 12h9a7 7 0 0 1 7 7" />,
    search: (
      <>
        <circle {...common} cx="11" cy="11" r="7" />
        <path {...common} d="m20 20-4-4" />
      </>
    ),
    send: <path {...common} d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2" />,
    team: (
      <>
        <circle {...common} cx="9" cy="8" r="3" />
        <circle {...common} cx="17" cy="9" r="2.5" />
        <path {...common} d="M3 20a6 6 0 0 1 12 0M14 15.5a5 5 0 0 1 7 4.5" />
      </>
    ),
    warning: (
      <>
        <path {...common} d="M10.4 4.4 2.5 18.2A1.8 1.8 0 0 0 4.1 21h15.8a1.8 1.8 0 0 0 1.6-2.8L13.6 4.4a1.8 1.8 0 0 0-3.2 0Z" />
        <path {...common} d="M12 9v4M12 17h.01" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
