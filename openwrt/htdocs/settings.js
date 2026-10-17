'use strict'
'require view'
'require form'

return view.extend({
  render: function () {
    var m = new form.Map('daed', 'Daed 服务设置', '这里控制管理服务。节点、订阅、DNS 和分流规则在管理面板中保存。')
    var s = m.section(form.NamedSection, 'main', 'daed')
    s.addremove = false
    var o = s.option(form.Flag, 'enabled', '启用管理服务')
    o.default = '0'
    o.rmempty = false
    o = s.option(form.ListValue, 'listen_host', '监听地址')
    o.value('lan', '自动使用 LAN 地址（推荐）')
    o.value('127.0.0.1', '仅本机（需自行配置反向代理）')
    o.default = 'lan'
    o.rmempty = false
    o = s.option(form.Value, 'lan_network', 'LAN 逻辑网络')
    o.default = 'lan'
    o.rmempty = false
    o.depends('listen_host', 'lan')
    o.validate = function (section, value) {
      return /^[a-zA-Z0-9_]+$/.test(value) || '请输入逻辑网络名称，例如 lan。'
    }
    o.description = '从该网络的运行状态读取 IPv4 地址；不会修改网络接口或防火墙。'
    o = s.option(form.Value, 'listen_port', '管理端口')
    o.datatype = 'port'
    o.default = '2023'
    o.rmempty = false
    return m.render()
  },
})
