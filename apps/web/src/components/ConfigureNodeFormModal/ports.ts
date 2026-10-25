// hysteria2 的端口跳跃串看起来随便，实际后端按 "起始-结束,单个端口" 解析。
// 评论里「hy2 节点添加不上」大多是在这里写成了 10000~20000、全角逗号或漏了端口。

const SEGMENT = /^\d{1,5}(?:-\d{1,5})?$/

/**
 * 返回第一个有问题的端口段，没有问题时返回空串。
 *
 * 只做提示用，不参与校验链：写错时后端仍会报错，这里只是让用户在点保存前看见。
 */
export function portsIssue(value: string): string {
  const text = value.trim()
  if (!text) return ''
  const parts = text.split(',')
  for (const raw of parts) {
    const segment = raw.trim()
    // 空段（开头/中间/结尾多写了逗号）返回一个能显示出来的标记，而不是空串——
    // 返回空串会被上层当成「没问题」。
    if (!segment) return ','
    if (!SEGMENT.test(segment)) return segment
    const [start, end] = segment.split('-').map(Number)
    if (start < 1 || start > 65535) return segment
    if (end !== undefined && (end < 1 || end > 65535)) return segment
    if (end !== undefined && end < start) return segment
  }
  return ''
}
