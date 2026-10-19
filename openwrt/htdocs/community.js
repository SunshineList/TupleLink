'use strict'
'require baseclass'

return baseclass.extend({
  render: function () {
    var button = function (url, name, symbol, color) {
      return E(
        'a',
        {
          href: url,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': name + '（在新标签页打开）',
          class: 'cbi-button',
          style:
            'display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border-radius:12px;font-weight:600;text-decoration:none',
        },
        [E('span', { 'aria-hidden': 'true', style: 'color:' + color }, symbol), name],
      )
    }
    return E(
      'nav',
      { 'aria-label': '社区频道', style: 'display:flex;flex-wrap:wrap;justify-content:center;gap:10px' },
      [
        button('https://www.youtube.com/@naiyou', 'YouTube', '▶', '#ef4444'),
        button('https://t.me/naiyous', 'Telegram', '➤', '#0ea5e9'),
      ],
    )
  },
})
