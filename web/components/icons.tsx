const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const HistoryIcon = () => (
  <svg {...base}>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
    <path d="M2.5 2.5V5H5" />
    <path d="M8 5v3l2 1.5" />
  </svg>
)

export const CloseIcon = () => (
  <svg {...base} width={12} height={12}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

export const RefreshIcon = () => (
  <svg {...base}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" />
    <path d="M13 2.5V5h-2.5" />
  </svg>
)

export const ChevronIcon = () => (
  <svg {...base} width={12} height={12}>
    <path d="M6 4l4 4-4 4" />
  </svg>
)

export const FolderIcon = () => (
  <svg {...base}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
)

export const FileIcon = () => (
  <svg {...base}>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
  </svg>
)

export const CopyIcon = () => (
  <svg {...base}>
    <rect x="5" y="5" width="8" height="8" rx="1.5" />
    <path d="M3 10.5V4a1 1 0 0 1 1-1h6.5" />
  </svg>
)
