'use strict'
'require view'
'require rpc'
'require poll'
'require ui'
'require dom'

var status = rpc.declare({ object: 'daed-router', method: 'status', expect: {} })
var action = rpc.declare({ object: 'daed-router', method: 'action', params: ['action'], expect: {} })

return view.extend({
  handleSave: null,
  handleSaveApply: null,
  handleReset: null,

  renderStatus: function (data) {
    return E('div', {}, [
      E(
        'p',
        {},
        '%s %s · %s · Linux %s · 插件 %s'.format(
          data.firmware,
          data.release,
          data.architecture,
          data.kernel,
          data.version,
        ),
      ),
      E(
        'p',
        {},
        '管理服务：%s　开机自启：%s'.format(data.running ? '运行中' : '已停止', data.autostart ? '已开启' : '已关闭'),
      ),
      E('p', {}, '已保存的服务开关：' + (data.enabled ? '开启' : '关闭')),
      E('p', {}, '服务运行仅表示管理程序启动；代理是否启用、节点与分流状态请在管理面板查看。'),
      E(
        'table',
        { class: 'table' },
        [
          E('tr', { class: 'tr table-titles' }, [E('th', {}, '检查项'), E('th', {}, '结果'), E('th', {}, '说明')]),
        ].concat(
          (data.checks || []).map(function (check) {
            return E('tr', { class: 'tr' }, [
              E('td', { class: 'td' }, check.name),
              E(
                'td',
                { class: 'td' },
                { ok: '通过', warning: '待核验', error: '不满足' }[check.status] || check.status,
              ),
              E('td', { class: 'td' }, check.message),
            ])
          }),
        ),
      ),
    ])
  },

  render: function () {
    var self = this
    var info = E('div', {}, '正在读取运行状态…')
    var update = function () {
      return status()
        .then(function (data) {
          dom.content(info, self.renderStatus(data))
        })
        .catch(function (error) {
          dom.content(info, E('p', { class: 'alert-message warning' }, '状态读取失败：' + error.message))
        })
    }
    var buttons = [
      ['start', '启动服务'],
      ['stop', '停止服务'],
      ['restart', '重启服务'],
      ['boot_enable', '开启自启'],
      ['boot_disable', '关闭自启'],
    ].map(function (item) {
      return E(
        'button',
        {
          class: 'cbi-button cbi-button-action',
          click: ui.createHandlerFn(self, function () {
            return action(item[0])
              .then(function (result) {
                if (!result.success) throw new Error('操作失败，请查看兼容检查和运行日志。')
                return update()
              })
              .catch(function (error) {
                ui.addNotification(null, E('p', {}, error.message), 'error')
              })
          }),
        },
        item[1],
      )
    })
    poll.add(update, 5)
    return E('div', {}, [
      E('h2', {}, 'Daed'),
      E(
        'p',
        {},
        '首次使用：启动管理服务 → 打开管理面板并创建账户 → 导入订阅 → 确认 LAN/WAN 接口和分流规则 → 在面板中启用代理。',
      ),
      E('div', { class: 'cbi-page-actions', style: 'display:flex;gap:8px;flex-wrap:wrap' }, buttons),
      info,
    ])
  },
})
