'use strict'
'require view'
'require rpc'
'require ui'
'require view.daed-router.community as community'

// Keep a distinct module URL from the pre-gateway dashboard cached by LuCI.
var status = rpc.declare({ object: 'daed-router', method: 'status', expect: {} })
var action = rpc.declare({ object: 'daed-router', method: 'action', params: ['action'], expect: {} })
var panel = '/cgi-bin/daed-router/'

return view.extend({
  handleSave: null,
  handleSaveApply: null,
  handleReset: null,
  load: function () {
    return status().then(function (data) {
      if (!data.running) return data
      return fetch(panel + 'session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: L.env.sessionid }),
      }).then(function (response) {
        data.authorized = response.ok
        return data
      })
    })
  },
  render: function (data) {
    var page = (window.location.pathname || '').split('/').pop()
    var routes = { resources: ['resources', '节点和订阅'], advanced: ['advanced', '高级设置'] }
    var route = routes[page] || ['', '管理面板']
    if (!data.running)
      return E('div', {}, [
        community.render(),
        E('p', {}, 'Daed 服务未运行。'),
        E(
          'button',
          {
            class: 'cbi-button cbi-button-action',
            click: ui.createHandlerFn(this, function () {
              return action('start').then(function (result) {
                if (!result.success) {
                  ui.addNotification(null, E('p', {}, result.message || '启动失败，请查看运行日志。'), 'error')
                  return
                }
                window.location.reload()
              })
            }),
          },
          '启动服务',
        ),
        E('p', {}, '启动失败时可查看“运行日志”。'),
      ])
    if (!data.authorized)
      return E('div', {}, [
        community.render(),
        E('p', {}, '路由器登录已失效或当前账户无管理权限，请刷新后台重新登录。'),
      ])
    return E('iframe', {
      src: panel + (route[0] ? '#/' + route[0] : ''),
      title: 'Daed ' + route[1],
      style:
        'display:block;width:100%;height:calc(100vh - 160px);height:calc(100dvh - 160px);min-height:160px;border:0',
    })
  },
})
