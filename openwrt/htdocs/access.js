'use strict'
'require baseclass'
'require rpc'

var messages = {
  session_expired: ['LuCI 登录已失效', '请退出路由器后台并重新登录，再打开 NaiLink。'],
  session_missing: ['没有取得有效的 LuCI 会话', '请重新加载后台；仍失败时，当前固件的 LuCI 会话接口可能不兼容。'],
  permission_denied: [
    '当前会话没有 NaiLink 管理权限',
    '请使用 root 重新登录；若仍失败，请从安装菜单更新插件以重新部署权限文件。',
  ],
  origin_rejected: [
    '网页来源校验未通过',
    '请使用路由器后台的原始地址打开 NaiLink，检查反向代理的域名、端口和 HTTPS 设置。',
  ],
  rpc_unavailable: ['LuCI 授权服务不可用', '无法连接 ubus/rpcd 或返回格式不兼容，请从安装菜单更新插件并重新登录。'],
  rpc_timeout: ['LuCI 授权服务响应超时', '路由器可能正忙，请稍后重试。'],
  rpc_error: ['无法读取 NaiLink 服务状态', 'LuCI RPC 请求失败；请重新加载，仍失败时检查插件安装和账户权限。'],
  gateway_missing: [
    '没有找到 NaiLink 网页网关',
    '当前固件的网页服务可能未启用 CGI，或插件文件不完整，请更新插件并检查固件的 CGI 支持。',
  ],
  gateway_unavailable: ['NaiLink 网页网关暂时不可用', '请稍后重试；若持续失败，请检查网页服务与插件安装。'],
  gateway_denied: ['网页服务拒绝了授权请求', '未收到插件的具体原因，请检查固件网页服务、反向代理及后台访问限制。'],
  invalid_response: ['网页网关返回内容异常', '可能被登录页面、反向代理或其他网页规则接管，请使用路由器原始地址重试。'],
  invalid_request: ['授权请求格式不兼容', '请重新加载后台，确保页面与安装的插件版本一致。'],
  network_error: ['无法连接 NaiLink 网页网关', '请检查与路由器的连接、浏览器拦截及反向代理设置，然后重试。'],
}

function failure(code, status) {
  return { authorized: false, issue: { code: code, status: status || 0 } }
}

return baseclass.extend({
  authorize: function () {
    // LuCI may replace the RPC session after the page environment was created.
    // Older LuCI releases without the getter still use the environment value.
    var session = typeof rpc.getSessionID === 'function' ? rpc.getSessionID() : L.env.sessionid
    if (typeof session !== 'string' || !/^[a-fA-F0-9]{32}$/.test(session) || /^0{32}$/.test(session))
      return Promise.resolve(failure('session_missing'))
    var controller = new AbortController()
    var timer = setTimeout(function () {
      controller.abort()
    }, 15000)
    return fetch('/cgi-bin/daed-router/session', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: session }),
    })
      .then(function (response) {
        if (response.status === 204 && !response.redirected) return { authorized: true }
        var defaults = {
          400: 'invalid_request',
          401: 'session_expired',
          403: 'gateway_denied',
          404: 'gateway_missing',
          405: 'gateway_missing',
          502: 'gateway_unavailable',
          503: 'gateway_unavailable',
          504: 'rpc_timeout',
        }
        var code = defaults[response.status] || (response.ok ? 'invalid_response' : 'gateway_unavailable')
        if ((response.headers.get('Content-Type') || '').indexOf('application/json') === -1)
          return failure(code, response.status)
        return response.json().then(
          function (body) {
            return failure(
              body && Object.prototype.hasOwnProperty.call(messages, body.code) ? body.code : code,
              response.status,
            )
          },
          function () {
            return failure(code, response.status)
          },
        )
      })
      .catch(function (error) {
        return failure(error && error.name === 'AbortError' ? 'rpc_timeout' : 'network_error')
      })
      .then(function (result) {
        clearTimeout(timer)
        return result
      })
  },
  render: function (issue) {
    issue = issue || { code: 'session_expired' }
    var code = Object.prototype.hasOwnProperty.call(messages, issue.code) ? issue.code : 'invalid_response'
    var message = messages[code]
    return E(
      'section',
      { role: 'alert', style: 'max-width:760px;margin:24px auto;padding:20px;line-height:1.7;overflow-wrap:anywhere' },
      [
        E('h3', {}, message[0]),
        E('p', {}, message[1]),
        E(
          'p',
          { style: 'color:var(--text-color-secondary,#666)' },
          '诊断代码：' + code + (issue.status ? ' · HTTP ' + issue.status : ''),
        ),
        E(
          'button',
          {
            class: 'cbi-button cbi-button-action',
            style: 'min-height:44px',
            click: function () {
              window.location.reload()
            },
          },
          '重新加载',
        ),
        E('p', {}, '此检查不会修改节点、订阅或代理配置。反馈问题时提供上面的诊断代码即可，无需密码或节点链接。'),
      ],
    )
  },
})
