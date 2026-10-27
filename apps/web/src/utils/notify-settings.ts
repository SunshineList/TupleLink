/**
 * Telegram 通知设置。
 *
 * 设计要点：**token 永远不回传前端**。
 *
 * 后端只告诉界面「填没填」，因为一旦把 token 送到浏览器，它就会出现在
 * 前端状态树、React DevTools、截图和任何一次网络抓包里。用户只需要
 * 知道「已配置」，需要改时整段重填——这是安全性和便利性的合理取舍。
 */

export interface NotifySettings {
  enabled: boolean
  /** token 是否已配置；不返回明文。 */
  tokenSet: boolean
  /** chat_id 不敏感，可以回显，方便用户确认推给谁。 */
  chat: string
}

export interface NotifySaveInput {
  enabled?: boolean
  /** 留空表示不修改，避免只改 chat_id 时把 token 冲掉。 */
  token?: string
  chat?: string
  /** 显式清空 token。 */
  clearToken?: boolean
}

export type NotifyTestResult =
  | 'sent'
  | 'disabled'
  | 'not_configured'
  | 'rate_limited'
  | 'no_client'
  | 'send_failed'
  | 'bad_args'

const EMPTY: NotifySettings = { enabled: false, tokenSet: false, chat: '' }

function rpcHost() {
  const host = window.parent as Window & {
    L?: { require: (name: string) => Promise<{ declare: (spec: object) => (...args: unknown[]) => Promise<unknown> }> }
  }
  if (host === window || !host.L?.require) throw new Error('LuCI host unavailable')
  return host.L.require('rpc')
}

export async function readNotifySettings(): Promise<NotifySettings> {
  const rpc = await rpcHost()
  const result = (await rpc.declare({
    object: 'daed-router',
    method: 'notify',
    expect: {},
    reject: true,
    raise: true,
  })()) as Record<string, unknown> | undefined
  if (!result) return EMPTY
  return {
    enabled: result.enabled === true || result.enabled === 1 || result.enabled === '1',
    tokenSet: result.token_set === true || result.token_set === 1 || result.token_set === '1',
    chat: typeof result.chat === 'string' ? result.chat : '',
  }
}

export async function saveNotifySettings(input: NotifySaveInput): Promise<void> {
  const rpc = await rpcHost()
  // LuCI 的 rpc.declare 按 params 名组装载荷：
  //   params[options.params[i]] = args[i]
  // 所以参数名必须与 rpcd 脚本里 json_get_var 读的字段名一致。
  // 之前声明成 params: ['input'] 却让脚本读顶层的 enabled/token，
  // 载荷被包进 input 这一层，脚本全部取空 —— 保存等于什么都没写。
  // undefined 用空串代替：脚本把空串当作「不修改」。
  const result = (await rpc.declare({
    object: 'daed-router',
    method: 'notifysave',
    params: ['enabled', 'token', 'chat', 'clear_token'],
    expect: {},
    raise: true,
  })(
    input.enabled === undefined ? '' : input.enabled ? 1 : 0,
    input.token || '',
    input.chat || '',
    input.clearToken ? 1 : '',
  )) as { success?: boolean; code?: string } | undefined
  if (!result?.success) {
    throw new Error(result?.code || 'state_failed')
  }
}

export async function sendNotifyTest(): Promise<NotifyTestResult> {
  const rpc = await rpcHost()
  const result = (await rpc.declare({
    object: 'daed-router',
    method: 'notifytest',
    expect: {},
    raise: true,
  })()) as { code?: string } | undefined
  const code = result?.code
  switch (code) {
    case 'sent':
    case 'disabled':
    case 'not_configured':
    case 'rate_limited':
    case 'no_client':
    case 'send_failed':
    case 'bad_args':
      return code
    default:
      return 'send_failed'
  }
}

/**
 * token 的本地格式检查。
 *
 * Telegram bot token 形如 `123456789:AAH...`，数字、冒号、base64url。
 * 在前端先挡一道，用户粘错时立刻得到反馈，而不是等推送静默失败。
 * 后端也会独立校验一次——前端校验只是为了体验，不是安全边界。
 */
export function looksLikeBotToken(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/\s/.test(trimmed)) return false
  return /^\d+:[-\w]{20,}$/.test(trimmed)
}

/** chat_id 可以是数字（用户/群组，群组带负号）或 @channelname。 */
export function looksLikeChatId(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^-?\d+$/.test(trimmed)) return true
  return /^@[a-z]\w{3,}$/i.test(trimmed)
}
