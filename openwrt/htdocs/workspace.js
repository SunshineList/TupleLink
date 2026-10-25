'use strict'
'require view'
'require rpc'
'require ui'
'require view.daed-router.community as community'
'require view.daed-router.access as access'

// New module URL for the four-page workspace; panel.js remains a legacy entry.
var status = rpc.declare({ object: 'daed-router', method: 'status', expect: {}, raise: true })
var action = rpc.declare({ object: 'daed-router', method: 'action', params: ['action'], expect: {} })
var panel = '/cgi-bin/daed-router/'

return view.extend({
  handleSave: null,
  handleSaveApply: null,
  handleReset: null,
  load: function () {
    return status()
      .then(function (data) {
        if (!data || typeof data.running !== 'boolean') return { issue: { code: 'rpc_error' } }
        if (!data.running) return data
        return access.authorize().then(function (result) {
          data.authorized = result.authorized
          data.issue = result.issue
          return data
        })
      })
      .catch(function () {
        return { authorized: false, issue: { code: 'rpc_error' } }
      })
  },
  render: function (data) {
    var page = (window.location.pathname || '').split('/').pop()
    var routes = { resources: ['resources', '节点和订阅'], advanced: ['advanced', '高级设置'] }
    var route = routes[page] || ['', '管理面板']
    if (data.issue) return E('div', {}, [community.render(), access.render(data.issue)])
    if (!data.running)
      return E('div', {}, [
        community.render(),
        E('p', {}, 'NaiLink 服务未运行。'),
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
    if (!data.authorized) return E('div', {}, [community.render(), access.render()])
    return E('iframe', {
      src: panel + (route[0] ? '#/' + route[0] : ''),
      title: 'NaiLink ' + route[1],
      style:
        'display:block;width:100%;height:calc(100vh - 160px);height:calc(100dvh - 160px);min-height:160px;border:0',
    })
  },
})
