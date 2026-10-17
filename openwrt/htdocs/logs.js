'use strict'
'require view'
'require rpc'
'require poll'
'require ui'

var logs = rpc.declare({ object: 'daed-router', method: 'logs', expect: {} })

return view.extend({
  handleSave: null,
  handleSaveApply: null,
  handleReset: null,
  render: function () {
    var output = E(
      'pre',
      { style: 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:65vh;overflow:auto' },
      '正在读取日志…',
    )
    poll.add(function () {
      return logs()
        .then(function (data) {
          output.textContent = data.logs || '暂无日志。'
        })
        .catch(function (error) {
          output.textContent = '日志读取失败：' + error.message
        })
    }, 5)
    return E('div', {}, [
      E('h2', {}, 'Daed 运行日志'),
      E(
        'p',
        {},
        '显示最近 120 行（最多读取 32 KB），日志保存在内存目录并限制大小。链接和常见凭据字段已遮盖，分享前仍请检查内容。',
      ),
      output,
    ])
  },
})
