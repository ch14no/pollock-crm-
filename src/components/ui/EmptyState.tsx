interface EmptyStateProps {
  icon?: React.ReactNode
  imgSrc?: string
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, imgSrc, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {imgSrc ? (
        <img src={imgSrc} alt="" className="w-28 h-28 object-contain mb-4 drop-shadow-sm" />
      ) : icon ? (
        <div className="mb-4 text-gray-300 text-6xl">{icon}</div>
      ) : null}
      <h3 className="text-lg font-bold text-gray-700 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 mb-4 max-w-xs">{description}</p>
      )}
      {action}
    </div>
  )
}
