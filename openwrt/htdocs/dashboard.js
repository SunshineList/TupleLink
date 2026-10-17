'use strict'
'require view'
'require rpc'

var status = rpc.declare({ object: 'daed-router', method: 'status', expect: {} })

return view.extend({
  handleSave: null,
  handleSaveApply: null,
  handleReset: null,
  load: function () {
    return status()
  },
  render: function (data) {
    if (!data.running || !data.listen)
      return E('div', {}, [
        E('h2', {}, 'Daed 管理面板'),
        E('p', {}, '管理服务尚未运行或监听地址不可用，请先查看运行状态和服务设置。'),
      ])
    // Parse a literal address returned by the helper; never inject arbitrary URLs.
    var match = /^(\[[0-9a-fA-F:]+\]|[0-9.]+):([0-9]+)$/.exec(data.listen)
    if (!match) return E('p', {}, '管理地址无效，请检查服务设置。')
    var host = match[1]
    if (host === '127.0.0.1' || host === '[::1]')
      return E('p', {}, '服务仅监听本机，请通过你配置的反向代理访问，或将监听地址改为 LAN。')
    var url = 'http://' + host + ':' + match[2] + '/'
    var children = [
      E('h2', {}, 'Daed 管理面板'),
      E('p', {}, '首次进入需创建 Daed 账户。LuCI 登录和 Daed 登录分别校验。'),
      E(
        'a',
        { class: 'cbi-button cbi-button-action', href: url, target: '_blank', rel: 'noopener noreferrer' },
        '在新窗口打开面板',
      ),
    ]
    if (window.location.protocol === 'https:') {
      children.push(
        E(
          'p',
          { class: 'alert-message warning' },
          '当前 LuCI 使用 HTTPS，Daed 默认提供 HTTP。请使用上方入口在新窗口访问可信 LAN 内的面板；浏览器会阻止直接嵌入 HTTP 页面。',
        ),
      )
    } else {
      children.push(
        E('iframe', {
          src: url,
          title: 'Daed 管理面板',
          style: 'width:100%;height:80vh;min-height:500px;border:0;margin-top:16px',
        }),
      )
    }
    return E('div', {}, children)
  },
})
