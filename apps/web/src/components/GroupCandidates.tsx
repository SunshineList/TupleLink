import { useTranslation } from 'react-i18next'
import { useGroupCandidates } from '~/hooks/useGroupCandidates'
import { cn } from '~/lib/utils'
import { activeCandidates, selectionIsRandom } from '~/utils/group-candidates'

/**
 * 群组当前出口。
 *
 * 群组列表只告诉你「这个组里有几个节点、各自延迟多少」，
 * 但**不说现在实际在用哪一个**。自动选路下节点会随时切换，
 * 网一慢就会怀疑「是不是切到差节点了」，而界面上完全看不到。
 *
 * 这里读的是内核实时状态，不是界面猜测。
 */
export function GroupCandidates() {
  const { t } = useTranslation()
  const query = useGroupCandidates()

  // 读不到时不要显示成「没有群组」：这两件事对用户意味着完全不同的动作。
  if (query.isError) {
    return (
      <section className="rounded-2xl border bg-card p-4" aria-label={t('groupCandidates.title')}>
        <h2 className="text-base font-semibold">{t('groupCandidates.title')}</h2>
        <p className="mt-2 text-xs text-muted-foreground">{t('groupCandidates.unavailable')}</p>
      </section>
    )
  }

  const groups = query.data?.groups ?? []
  if (!query.isPending && groups.length === 0) return null

  return (
    <section className="rounded-2xl border bg-card p-4" aria-label={t('groupCandidates.title')}>
      <div className="mb-3">
        <h2 className="text-base font-semibold">{t('groupCandidates.title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('groupCandidates.description')}</p>
      </div>
      <ul className="space-y-1.5">
        {groups.map((group) => {
          const names = activeCandidates(group)
          const random = selectionIsRandom(group.policy)
          return (
            <li
              key={group.name}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border-b border-border/60 px-1 py-1.5 text-sm last:border-0"
            >
              <span className="min-w-0 truncate font-medium" title={group.name}>
                {group.name}
                {group.members !== null && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {t('groupCandidates.members', { count: group.members })}
                  </span>
                )}
              </span>
              <span className="min-w-0 truncate font-mono text-xs">
                {random ? (
                  // 随机策略本来就没有稳定出口，说成「未选中」会像故障。
                  <span className="text-muted-foreground">{t('groupCandidates.random')}</span>
                ) : names.length > 0 ? (
                  <span className={cn('text-emerald-700 dark:text-emerald-400')}>{names.join(' / ')}</span>
                ) : (
                  <span className="text-muted-foreground">{t('groupCandidates.none')}</span>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
